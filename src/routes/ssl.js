const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const jobQueue = require('../jobs/jobQueue');
const acmeService = require('../services/acmeService');

// List all certificates
router.get('/', requirePermission('ssl:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let certs;
    if (isAdmin) {
      certs = await database('ssl_certificates').orderBy('expires_at', 'asc');
    } else {
      certs = await database('ssl_certificates')
        .join('domains', 'domains.id', 'ssl_certificates.domain_id')
        .where('domains.user_id', req.user.id)
        .orderBy('expires_at', 'asc')
        .select('ssl_certificates.*');
    }

    // Annotate with days until expiry
    const now = Date.now();
    const enriched = certs.map(cert => ({
      ...cert,
      days_until_expiry: cert.expires_at
        ? Math.ceil((new Date(cert.expires_at) - now) / 86400000)
        : null,
      is_expired: cert.expires_at ? new Date(cert.expires_at) < new Date() : false
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error('Error listing SSL certs:', err);
    res.status(500).json({ success: false, message: 'Failed to list certificates' });
  }
});

// Get single certificate
router.get('/:id', requirePermission('ssl:read'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const cert = await database('ssl_certificates').where('id', req.params.id).first();
      if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
      if (!(await canAccessCert(cert, req)))
        return res.status(403).json({ success: false, message: 'Access denied' });
      // Strip private key from response
      const { private_key, ...safe } = cert;
      res.json({ success: true, data: safe });
    } catch (err) {
      logger.error('Error getting SSL cert:', err);
      res.status(500).json({ success: false, message: 'Failed to get certificate' });
    }
  }
);

// Issue Let's Encrypt certificate (dispatched as background job)
router.post('/issue', requirePermission('ssl:write'),
  [
    body('domain').isFQDN().withMessage('Invalid domain name'),
    body('auto_renew').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { domain, auto_renew = true } = req.body;

      const domainRow = await resolveOwnedDomain(domain, req);
      if (!domainRow) return res.status(404).json({ success: false, message: 'Domain not found or not owned by you' });

      const existing = await database('ssl_certificates').where({ domain, status: 'active' }).first();
      if (existing) return res.status(409).json({ success: false, message: 'Active certificate already exists for this domain' });

      // Create a pending record
      const [certId] = await database('ssl_certificates').insert({
        domain,
        domain_id: domainRow.id,
        issuer: "Let's Encrypt",
        status: 'pending',
        source: 'letsencrypt',
        auto_renew,
        created_at: new Date(),
        updated_at: new Date()
      });

      // Dispatch as background job
      const job = jobQueue.createJob('ssl_issue', `Issue SSL for ${domain}`, req.user.id);

      res.status(202).json({
        success: true,
        message: `SSL certificate issuance started for ${domain}`,
        certId,
        jobId: job.id
      });

      // Background: real ACME HTTP-01 issuance via acmeService. This only
      // succeeds if `domain` genuinely resolves to this server and port 80
      // reaches it for /.well-known/acme-challenge/ — Let's Encrypt
      // validates from the public internet, not from this process.
      setImmediate(async () => {
        jobQueue.updateJob(job.id, { status: 'running', progress: 5 });
        try {
          const { certificate, privateKey } = await acmeService.issueCertificate({
            domain,
            email: req.user.email,
            onProgress: (progress) => jobQueue.updateJob(job.id, { progress })
          });

          const x509 = new crypto.X509Certificate(certificate);
          const issued = new Date(x509.validFrom);
          const expires = new Date(x509.validTo);

          await database('ssl_certificates').where('id', certId).update({
            status: 'active',
            certificate,
            private_key: privateKey,
            issued_at: issued,
            expires_at: expires,
            last_renewed_at: issued,
            error_message: null,
            updated_at: new Date()
          });

          jobQueue.updateJob(job.id, { status: 'completed', progress: 100, result: { certId } });
          logger.info(`SSL certificate issued for ${domain} (expires ${expires.toISOString()})`);
        } catch (err) {
          await database('ssl_certificates').where('id', certId).update({
            status: 'failed',
            error_message: err.message,
            updated_at: new Date()
          });
          jobQueue.updateJob(job.id, { status: 'failed', error: err.message });
          logger.error(`SSL issuance failed for ${domain}:`, err);
        }
      });
    } catch (err) {
      logger.error('Error issuing SSL cert:', err);
      res.status(500).json({ success: false, message: 'Failed to start certificate issuance' });
    }
  }
);

// Upload manual certificate
router.post('/upload', requirePermission('ssl:write'),
  [
    body('domain').isFQDN().withMessage('Invalid domain name'),
    body('certificate').isString().notEmpty().withMessage('Certificate is required'),
    body('private_key').isString().notEmpty().withMessage('Private key is required'),
    body('chain').optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { domain, certificate, private_key, chain } = req.body;

      const domainRow = await resolveOwnedDomain(domain, req);
      if (!domainRow) return res.status(404).json({ success: false, message: 'Domain not found or not owned by you' });

      // Basic PEM format check
      if (!certificate.includes('-----BEGIN CERTIFICATE-----'))
        return res.status(400).json({ success: false, message: 'Invalid certificate format (expected PEM)' });
      if (!private_key.includes('-----BEGIN'))
        return res.status(400).json({ success: false, message: 'Invalid private key format (expected PEM)' });

      let x509;
      try {
        x509 = new crypto.X509Certificate(certificate);
      } catch (parseErr) {
        return res.status(400).json({ success: false, message: `Could not parse certificate: ${parseErr.message}` });
      }

      if (!x509.checkHost(domain) && !x509.checkHost(`www.${domain}`)) {
        return res.status(400).json({
          success: false,
          message: `Certificate does not cover ${domain} (subject/SAN mismatch)`
        });
      }

      const expires = new Date(x509.validTo);
      if (expires < new Date()) {
        return res.status(400).json({ success: false, message: `Certificate already expired on ${expires.toISOString()}` });
      }
      const issuedAt = new Date(x509.validFrom);

      const [certId] = await database('ssl_certificates').insert({
        domain,
        domain_id: domainRow.id,
        issuer: 'Manual Upload',
        status: 'active',
        source: 'manual',
        certificate,
        private_key,
        chain: chain || null,
        auto_renew: false,
        issued_at: issuedAt,
        expires_at: expires,
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.info(`Manual SSL certificate uploaded for ${domain} by ${req.user.username}`);
      res.status(201).json({ success: true, message: 'Certificate uploaded', data: { id: certId, domain } });
    } catch (err) {
      logger.error('Error uploading SSL cert:', err);
      res.status(500).json({ success: false, message: 'Failed to upload certificate' });
    }
  }
);

// Renew certificate
router.post('/:id/renew', requirePermission('ssl:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const cert = await database('ssl_certificates').where('id', req.params.id).first();
      if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
      if (!(await canAccessCert(cert, req)))
        return res.status(403).json({ success: false, message: 'Access denied' });
      if (cert.source !== 'letsencrypt')
        return res.status(400).json({ success: false, message: 'Only Let\'s Encrypt certificates can be renewed automatically' });

      const job = jobQueue.createJob('ssl_renew', `Renew SSL for ${cert.domain}`, req.user.id);

      res.status(202).json({ success: true, message: 'Certificate renewal started', jobId: job.id });

      setImmediate(async () => {
        jobQueue.updateJob(job.id, { status: 'running', progress: 5 });
        try {
          const { certificate, privateKey } = await acmeService.issueCertificate({
            domain: cert.domain,
            email: req.user.email,
            onProgress: (progress) => jobQueue.updateJob(job.id, { progress })
          });

          const x509 = new crypto.X509Certificate(certificate);
          const renewed = new Date(x509.validFrom);
          const expires = new Date(x509.validTo);

          await database('ssl_certificates').where('id', cert.id).update({
            status: 'active',
            certificate,
            private_key: privateKey,
            issued_at: renewed,
            expires_at: expires,
            last_renewed_at: renewed,
            error_message: null,
            updated_at: new Date()
          });

          jobQueue.updateJob(job.id, { status: 'completed', progress: 100 });
          logger.info(`SSL certificate renewed for ${cert.domain} (expires ${expires.toISOString()})`);
        } catch (err) {
          await database('ssl_certificates').where('id', cert.id).update({
            status: 'active',
            error_message: `Renewal failed: ${err.message}`,
            updated_at: new Date()
          });
          jobQueue.updateJob(job.id, { status: 'failed', error: err.message });
          logger.error(`SSL renewal failed for ${cert.domain}:`, err);
        }
      });
    } catch (err) {
      logger.error('Error renewing SSL cert:', err);
      res.status(500).json({ success: false, message: 'Failed to start renewal' });
    }
  }
);

// Delete certificate
router.delete('/:id', requirePermission('ssl:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const cert = await database('ssl_certificates').where('id', req.params.id).first();
      if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
      if (!(await canAccessCert(cert, req)))
        return res.status(403).json({ success: false, message: 'Access denied' });

      await database('ssl_certificates').where('id', req.params.id).delete();
      logger.info(`SSL certificate for ${cert.domain} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Certificate deleted' });
    } catch (err) {
      logger.error('Error deleting SSL cert:', err);
      res.status(500).json({ success: false, message: 'Failed to delete certificate' });
    }
  }
);

// Admins can access any cert. Non-admins may only access a cert whose
// domain_id resolves to a domain they own; certs with no resolvable owner
// are admin-only.
async function canAccessCert(cert, req) {
  if (req.user.role === 'admin') return true;
  if (!cert.domain_id) return false;
  const domainRow = await database('domains').where('id', cert.domain_id).first();
  return !!domainRow && domainRow.user_id === req.user.id;
}

// Resolves the domains row the requester owns for the given domain name.
// Returns null (and the caller should 403/404) if it doesn't exist or the
// requester isn't its owner (admins bypass ownership).
async function resolveOwnedDomain(domainName, req) {
  const domainRow = await database('domains').where('domain', domainName).first();
  if (!domainRow) return null;
  if (req.user.role !== 'admin' && domainRow.user_id !== req.user.id) return null;
  return domainRow;
}

module.exports = router;
