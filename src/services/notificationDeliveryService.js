// Real outbound delivery for system alerts. Until this file existed,
// sendAlertNotifications() in monitoringService.js only ever wrote an
// in-app `notifications` row — the email/webhook/SMS channels were three
// TODO comments and nothing ever left the process. Each channel here is
// independently best-effort: a missing/unreachable config degrades to a
// logged warning, never a thrown error, so one broken channel can't stop
// the others or the in-app notification that already succeeded.
const nodemailer = require('nodemailer');
const config = require('../config/config');
const logger = require('../config/logger');

let cachedTransporter = null;

// nodemailer has been a listed dependency since before this file existed
// (see settings.js's removed-settings comment) but was never actually
// require()'d anywhere — this is the first real use of it.
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: config.EMAIL.HOST,
    port: config.EMAIL.PORT,
    secure: config.EMAIL.SECURE,
    auth: config.EMAIL.USER ? { user: config.EMAIL.USER, pass: config.EMAIL.PASS } : undefined
  });
  return cachedTransporter;
}

async function sendEmailAlert(toEmail, alert) {
  if (!toEmail) return { delivered: false, reason: 'No recipient email address' };
  try {
    await getTransporter().sendMail({
      from: config.EMAIL.FROM,
      to: toEmail,
      subject: `[ServerPanel] ${alert.severity?.toUpperCase() || 'ALERT'}: ${alert.title}`,
      text: `${alert.title}\n\n${alert.description || ''}\n\nSeverity: ${alert.severity}\nType: ${alert.alert_type}\nTime: ${new Date().toISOString()}`
    });
    return { delivered: true };
  } catch (error) {
    logger.warn(`Alert email delivery failed (to ${toEmail}):`, error.message);
    return { delivered: false, reason: error.message };
  }
}

async function sendWebhookAlert(webhookUrl, alert) {
  if (!webhookUrl) return { delivered: false, reason: 'No webhook URL configured' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: alert.title,
        description: alert.description,
        severity: alert.severity,
        alert_type: alert.alert_type,
        timestamp: new Date().toISOString()
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      return { delivered: false, reason: `Webhook endpoint returned HTTP ${response.status}` };
    }
    return { delivered: true };
  } catch (error) {
    logger.warn(`Alert webhook delivery failed (${webhookUrl}):`, error.message);
    return { delivered: false, reason: error.message };
  }
}

// SMS needs a real third-party gateway account — there's no such thing as
// "just send an SMS" from a server without one. Twilio's REST API is
// plain HTTPS + HTTP Basic Auth, so this needs no SDK dependency: if
// TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are all
// present, this actually sends a real SMS; otherwise it honestly reports
// why it didn't, the same way FTP/mail/DNS report "not detected" instead
// of silently pretending to succeed.
async function sendSmsAlert(toPhoneNumber, alert) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { delivered: false, reason: 'SMS requires TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER — none configured' };
  }
  if (!toPhoneNumber) return { delivered: false, reason: 'No recipient phone number' };

  try {
    const body = new URLSearchParams({
      To: toPhoneNumber,
      From: TWILIO_FROM_NUMBER,
      Body: `[${alert.severity?.toUpperCase() || 'ALERT'}] ${alert.title}`.slice(0, 1600)
    });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
      },
      body
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { delivered: false, reason: `Twilio returned HTTP ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { delivered: true };
  } catch (error) {
    logger.warn('Alert SMS delivery failed:', error.message);
    return { delivered: false, reason: error.message };
  }
}

module.exports = { sendEmailAlert, sendWebhookAlert, sendSmsAlert };
