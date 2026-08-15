const crypto = require('crypto');
const { query, withTransaction } = require('../config/db');
const env = require('../config/env');
const { hasSmtpConfig } = require('../config/mail');
const { sendMail } = require('./email.service');

const ACCOUNT_ACTIVATION_PURPOSE = 'ACCOUNT_ACTIVATION';
const ACTIVATION_CODE_TTL_MINUTES = 15;
const MAX_ACTIVATION_ATTEMPTS = 5;

const normalizeActivationCode = (code) => String(code || '').trim();

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const generateActivationCode = () => String(crypto.randomInt(100000, 1000000));

const hashActivationCode = ({ userId, code, purpose = ACCOUNT_ACTIVATION_PURPOSE }) =>
  crypto
    .createHmac('sha256', env.jwt.refreshSecret)
    .update(`${purpose}:${userId}:${normalizeActivationCode(code)}`)
    .digest('hex');

const timingSafeHexCompare = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const createAccountActivationCode = async ({ userId, db = { query } }) => {
  const code = generateActivationCode();
  const codeHash = hashActivationCode({ userId, code });

  await db.query(
    `UPDATE email_verification_codes
     SET consumed_at = NOW()
     WHERE user_id = $1
       AND purpose = $2
       AND consumed_at IS NULL`,
    [userId, ACCOUNT_ACTIVATION_PURPOSE],
  );

  await db.query(
    `INSERT INTO email_verification_codes (user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 minute'))`,
    [userId, ACCOUNT_ACTIVATION_PURPOSE, codeHash, ACTIVATION_CODE_TTL_MINUTES],
  );

  return code;
};

const buildActivationEmail = ({ firstName = '', code }) => {
  const safeFirstName = String(firstName || '').trim();
  const textGreeting = safeFirstName ? `Hola ${safeFirstName},` : 'Hola,';
  const htmlGreeting = safeFirstName ? `Hola ${escapeHtml(safeFirstName)},` : 'Hola,';

  return {
    subject: 'Código de activación - Computron',
    text: `${textGreeting}\n\nTu código de activación es: ${code}\nEste código vence en ${ACTIVATION_CODE_TTL_MINUTES} minutos.\n\nSi no solicitaste esta cuenta, ignora este mensaje.`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#172b2b;line-height:1.5">
        <p>${htmlGreeting}</p>
        <p>Tu código de activación para ingresar al sistema Computron es:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
        <p>Este código vence en ${ACTIVATION_CODE_TTL_MINUTES} minutos.</p>
        <p style="color:#64748b;font-size:13px">Si no solicitaste esta cuenta, ignora este mensaje.</p>
      </div>
    `,
  };
};

const createAndSendAccountActivationCode = async ({ user, db = { query } }) => {
  const code = await createAccountActivationCode({ userId: user.id, db });
  const email = buildActivationEmail({ firstName: user.first_name, code });
  const result = await sendMail({
    to: user.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });

  return {
    email_sent: !result.simulated,
    simulated: Boolean(result.simulated),
    expires_in_minutes: ACTIVATION_CODE_TTL_MINUTES,
    activation_code_preview: env.nodeEnv === 'production' || !result.simulated ? null : code,
  };
};

const consumeAccountActivationCode = async ({ userId, code, transactionRunner = withTransaction }) =>
  transactionRunner(async (tx) => {
    const codeResult = await tx.query(
      `SELECT id, code_hash, attempts
       FROM email_verification_codes
       WHERE user_id = $1
         AND purpose = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [userId, ACCOUNT_ACTIVATION_PURPOSE],
    );

    if (codeResult.rowCount === 0) {
      return { ok: false, reason: 'missing_or_expired' };
    }

    const codeRow = codeResult.rows[0];
    if (Number(codeRow.attempts || 0) >= MAX_ACTIVATION_ATTEMPTS) {
      await tx.query(
        `UPDATE email_verification_codes
         SET consumed_at = NOW()
         WHERE id = $1`,
        [codeRow.id],
      );
      return { ok: false, reason: 'max_attempts' };
    }

    const expectedHash = hashActivationCode({ userId, code });
    const matches = timingSafeHexCompare(codeRow.code_hash, expectedHash);

    if (!matches) {
      const nextAttempts = Number(codeRow.attempts || 0) + 1;
      await tx.query(
        `UPDATE email_verification_codes
         SET attempts = $2,
             consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END
         WHERE id = $1`,
        [codeRow.id, nextAttempts, MAX_ACTIVATION_ATTEMPTS],
      );
      return { ok: false, reason: nextAttempts >= MAX_ACTIVATION_ATTEMPTS ? 'max_attempts' : 'invalid' };
    }

    await tx.query(
      `UPDATE email_verification_codes
       SET consumed_at = NOW()
       WHERE id = $1`,
      [codeRow.id],
    );

    return { ok: true };
  });

module.exports = {
  ACTIVATION_CODE_TTL_MINUTES,
  ACCOUNT_ACTIVATION_PURPOSE,
  createAccountActivationCode,
  createAndSendAccountActivationCode,
  consumeAccountActivationCode,
  hasSmtpConfig,
};
