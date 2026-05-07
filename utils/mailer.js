const nodemailer = require('nodemailer');

const boolFromEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
};

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const debug = boolFromEnv(process.env.MAIL_DEBUG, false);

  if (!host || !user || !pass) {
    console.warn('[mailer] Missing SMTP configuration:', {
      hasHost: !!host,
      hasUser: !!user,
      hasPass: !!pass
    });
    return null;
  }

  if (host !== 'smtp.gmail.com') {
    console.warn('[mailer] SMTP_HOST must be smtp.gmail.com for Gmail transport');
    return null;
  }

  console.log('[mailer] Using Gmail service transport');

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    debug,
    logger: debug,
    tls: {
      servername: host
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
};

const getFromAddress = () => {
  return process.env.FROM_EMAIL || process.env.SMTP_USER || 'no-reply@dcim.local';
};

/**
 * Sends an email via SMTP when configured.
 * If SMTP env vars are missing, returns { delivered: false } and logs the message.
 */
const sendMail = async ({ to, subject, text, html }) => {
  console.log('[mailer] ===== DÉBUT ENVOI EMAIL =====');
  console.log('[mailer] Paramètres reçus:', { to, subject, hasText: !!text, hasHtml: !!html });

  const transporter = createTransporter();

  if (!transporter) {
    console.error('[mailer] ❌ ÉCHEC: SMTP non configuré');
    console.error('[mailer] To:', to);
    console.error('[mailer] Subject:', subject);
    console.error('[mailer] Text:', text);
    return { delivered: false, error: 'SMTP not configured' };
  }

  try {
    // Verify connection before sending
    console.log('[mailer] 🔍 Vérification connexion SMTP...');
    const verification = await transporter.verify();
    console.log('[mailer] ✅ Connexion SMTP vérifiée:', verification);

    const fromAddress = process.env.SMTP_USER || getFromAddress();
    if (fromAddress !== process.env.SMTP_USER) {
      console.warn('[mailer] FROM_EMAIL must match SMTP_USER; forcing Gmail sender');
    }

    const safeText = text
      ? String(text)
      : (html ? String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
    const fallbackText = safeText || 'Password reset request.';
    console.log('[mailer] 📧 Envoi email:', {
      from: fromAddress,
      to,
      subject
    });

    const mailOptions = {
      from: `"${process.env.FROM_NAME || 'DCIM'}" <${fromAddress}>`,
      to,
      subject,
      text: fallbackText
    };

    console.log('[mailer] 📨 Options email complètes:', JSON.stringify({
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      hasText: !!mailOptions.text,
      hasHtml: !!mailOptions.html
    }, null, 2));

    const result = await transporter.sendMail(mailOptions);

    console.log('[mailer] ✅ EMAIL ENVOYÉ AVEC SUCCÈS!');
    console.log('[mailer] 📧 Détails complets:', {
      messageId: result.messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected,
      envelope: result.envelope,
      envelopeTime: result.envelopeTime,
      messageTime: result.messageTime
    });

    return {
      delivered: true,
      messageId: result.messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected
    };

  } catch (error) {
    console.error('[mailer] ❌ ERREUR CRITIQUE lors de l\'envoi d\'email:');
    console.error('[mailer] Code erreur:', error.code);
    console.error('[mailer] Message:', error.message);
    console.error('[mailer] Commande:', error.command);
    console.error('[mailer] Response:', error.response);
    console.error('[mailer] ResponseCode:', error.responseCode);
    console.error('[mailer] Stack:', error.stack);

    return {
      delivered: false,
      error: error.message,
      code: error.code,
      response: error.response,
      responseCode: error.responseCode
    };
  }
};

module.exports = { sendMail };
