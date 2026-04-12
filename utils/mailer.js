const nodemailer = require('nodemailer');

const boolFromEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
};

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = boolFromEnv(process.env.SMTP_SECURE, port === 465);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
};

const getFromAddress = () => {
  return process.env.SMTP_FROM || process.env.FROM_EMAIL || process.env.SMTP_USER || 'no-reply@dcim.local';
};

/**
 * Sends an email via SMTP when configured.
 * If SMTP env vars are missing, returns { delivered: false } and logs the message.
 */
const sendMail = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();

  if (!transporter) {
    console.warn('[mailer] SMTP not configured; skipping delivery');
    console.warn('[mailer] To:', to);
    console.warn('[mailer] Subject:', subject);
    console.warn('[mailer] Text:', text);
    return { delivered: false };
  }

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html
  });

  return { delivered: true };
};

module.exports = { sendMail };
