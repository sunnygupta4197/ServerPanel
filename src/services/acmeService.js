const acme = require('acme-client');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../config/logger');

const ACCOUNT_KEY_PATH = path.join(config.PATHS.CERTIFICATES, 'acme-account-key.pem');

// token -> keyAuthorization, read by the public /.well-known/acme-challenge/:token
// route mounted in app.js. In-memory only: a challenge is only ever relevant
// for the few seconds an issuance is in flight, so it doesn't need to survive
// a restart, and every panel process behind a load balancer would need to
// share this anyway for HTTP-01 to work multi-instance — out of scope for the
// single-instance-per-customer deployment this panel targets.
const pendingChallenges = new Map();

function getChallengeResponse(token) {
  return pendingChallenges.get(token) || null;
}

// Defaults to Let's Encrypt's staging directory, which issues certificates
// browsers don't trust but has no meaningful rate limits — production ACME
// has tight per-domain rate limits that are easy to burn through by accident
// while testing a panel feature, so staging is the safe default until an
// operator deliberately opts in.
function getDirectoryUrl() {
  return process.env.ACME_ENV === 'production'
    ? acme.directory.letsencrypt.production
    : acme.directory.letsencrypt.staging;
}

async function getAccountKey() {
  try {
    return await fs.readFile(ACCOUNT_KEY_PATH);
  } catch {
    const key = await acme.crypto.createPrivateKey();
    await fs.mkdir(config.PATHS.CERTIFICATES, { recursive: true });
    await fs.writeFile(ACCOUNT_KEY_PATH, key);
    return key;
  }
}

async function getClient() {
  const accountKey = await getAccountKey();
  return new acme.Client({ directoryUrl: getDirectoryUrl(), accountKey });
}

// Issues a real certificate via ACME HTTP-01 domain validation. This only
// succeeds if `domain` actually resolves to this server and port 80 reaches
// this app for the /.well-known/acme-challenge/ path — Let's Encrypt fetches
// the challenge from the public internet, not from this process, so there
// is no way to satisfy it without a real, publicly reachable domain pointed
// at this instance.
async function issueCertificate({ domain, email, onProgress }) {
  onProgress?.(10, `Connecting to ${getDirectoryUrl()}`);
  const client = await getClient();

  onProgress?.(25, 'Generating certificate key and CSR');
  const [certKey, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });

  onProgress?.(40, `Requesting HTTP-01 validation for ${domain}`);
  const certificate = await client.auto({
    csr,
    email,
    termsOfServiceAgreed: true,
    challengePriority: ['http-01'],
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      if (challenge.type !== 'http-01') return;
      pendingChallenges.set(challenge.token, keyAuthorization);
      logger.info(`ACME: serving HTTP-01 challenge for ${authz.identifier.value}`);
    },
    challengeRemoveFn: async (authz, challenge) => {
      pendingChallenges.delete(challenge.token);
    }
  });

  onProgress?.(90, 'Certificate issued');
  return { certificate: certificate.toString(), privateKey: certKey.toString() };
}

module.exports = { issueCertificate, getChallengeResponse, getDirectoryUrl };
