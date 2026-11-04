import 'dotenv/config';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import nodemailer from 'nodemailer';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production';
const appOrigin = process.env.APP_ORIGIN;
const otpSecret = process.env.OTP_SECRET;
const sessionSecret = process.env.SESSION_SECRET;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
const otpLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;
const ipWindows = new Map();

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

const jsonError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hashValue = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('hex');
const digestEqual = (left, right) => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const secureCookie = isProduction ? '; Secure' : '';
const setSessionCookie = (res, token) => res.set('Set-Cookie', `loom_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secureCookie}`);
const clearSessionCookie = (res) => res.set('Set-Cookie', `loom_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie}`);

function requireConfiguration() {
  const missing = [];
  for (const key of ['DATABASE_URL', 'OTP_SECRET', 'SESSION_SECRET']) if (!process.env[key]) missing.push(key);
  if (!mailer) missing.push('SMTP_HOST');
  if (!process.env.SMTP_FROM) missing.push('SMTP_FROM');
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
}

function requireSameOrigin(req, res, next) {
  if (!appOrigin) return jsonError(res, 503, 'SERVER_NOT_CONFIGURED', 'Signup is not configured yet.');
  if (req.get('origin') !== appOrigin) return jsonError(res, 403, 'INVALID_ORIGIN', 'Request origin could not be verified.');
  next();
}

function limitAuthByIp(maximum, durationMs) {
  return (req, res, next) => {
    const now = Date.now();
    for (const [ip, window] of ipWindows) if (now - window.startedAt >= durationMs) ipWindows.delete(ip);
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const window = ipWindows.get(key);
    if (!window || now - window.startedAt >= durationMs) {
      ipWindows.set(key, { startedAt: now, count: 1 });
      return next();
    }
    if (window.count >= maximum) return jsonError(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
    window.count += 1;
    return next();
  };
}

function getCookie(req, name) {
  const prefix = `${name}=`;
  return (req.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
}

async function getSession(req) {
  const token = getCookie(req, 'loom_session');
  if (!token || !sessionSecret) return null;
  const tokenHash = hashValue(token, sessionSecret);
  const result = await pool.query(
    'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [tokenHash],
  );
  return result.rows[0] || null;
}

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/v1/auth/signup/request-otp', requireSameOrigin, limitAuthByIp(10, 15 * 60 * 1000), async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return jsonError(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
    const locked = await client.query('SELECT * FROM otp_challenges WHERE email = $1 FOR UPDATE', [email]);
    const current = locked.rows[0];
    const now = Date.now();
    if (current && now - new Date(current.last_sent_at).getTime() < 60_000) {
      await client.query('ROLLBACK');
      return res.status(202).json({ message: 'If this address can receive a code, it will arrive shortly.' });
    }
    const sameWindow = current && now - new Date(current.window_started_at).getTime() < 60 * 60 * 1000;
    if (sameWindow && current.sent_in_window >= 5) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many codes requested. Try again in an hour.' } });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashValue(`${email}:${code}`, otpSecret);
    await client.query(
      `INSERT INTO otp_challenges (email, code_hash, expires_at, attempts, last_sent_at, sent_in_window, window_started_at)
       VALUES ($1, $2, now() + interval '10 minutes', 0, now(), 1, now())
       ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at, attempts = 0, last_sent_at = now(),
         sent_in_window = CASE WHEN $3 THEN otp_challenges.sent_in_window + 1 ELSE 1 END,
         window_started_at = CASE WHEN $3 THEN otp_challenges.window_started_at ELSE now() END`,
      [email, codeHash, Boolean(sameWindow)],
    );
    await mailer.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Your ClientoraHQ verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#20212a"><h1>Verify your email</h1><p>Enter this code to finish creating your ClientoraHQ account:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
    });
    await client.query('COMMIT');
    return res.status(202).json({ message: 'If this address can receive a code, it will arrive shortly.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Could not request signup code:', error);
    return jsonError(res, 503, 'EMAIL_UNAVAILABLE', 'We could not send a code right now. Please try again shortly.');
  } finally {
    client.release();
  }
});

app.post('/api/v1/auth/signup/verify-otp', requireSameOrigin, limitAuthByIp(30, 15 * 60 * 1000), async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return jsonError(res, 400, 'INVALID_CODE', 'Enter the six digit code sent to your email.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM otp_challenges WHERE email = $1 FOR UPDATE', [email]);
    const challenge = result.rows[0];
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= 5) {
      await client.query('ROLLBACK');
      return jsonError(res, 400, 'CODE_INVALID_OR_EXPIRED', 'That code is invalid or expired. Request a new code and try again.');
    }
    const submittedHash = hashValue(`${email}:${code}`, otpSecret);
    if (!digestEqual(challenge.code_hash, submittedHash)) {
      await client.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE email = $1', [email]);
      await client.query('COMMIT');
      return jsonError(res, 400, 'CODE_INVALID_OR_EXPIRED', 'That code is invalid or expired. Request a new code and try again.');
    }

    const userResult = await client.query(
      `INSERT INTO users(email, email_verified_at) VALUES ($1, now())
       ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(users.email_verified_at, now())
       RETURNING id, email`, [email],
    );
    await client.query('DELETE FROM otp_challenges WHERE email = $1', [email]);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashValue(token, sessionSecret);
    await client.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [tokenHash, userResult.rows[0].id]);
    await client.query('COMMIT');
    setSessionCookie(res, token);
    return res.json({ user: userResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Could not verify signup code:', error);
    return jsonError(res, 503, 'VERIFICATION_UNAVAILABLE', 'We could not verify that code right now. Please try again.');
  } finally {
    client.release();
  }
});

app.get('/api/v1/auth/me', async (req, res) => {
  try {
    const user = await getSession(req);
    if (!user) return jsonError(res, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
    return res.json({ user });
  } catch (error) {
    console.error('Could not read session:', error);
    return jsonError(res, 503, 'SESSION_UNAVAILABLE', 'Your session could not be checked right now.');
  }
});

app.post('/api/v1/auth/logout', requireSameOrigin, async (req, res) => {
  const token = getCookie(req, 'loom_session');
  if (token && sessionSecret) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashValue(token, sessionSecret)]).catch(() => {});
  clearSessionCookie(res);
  return res.status(204).end();
});

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
try {
  requireConfiguration();
  await pool.query(await readFile(schemaPath, 'utf8'));
  app.listen(port, () => console.log(`ClientoraHQ auth API listening on port ${port}`));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
