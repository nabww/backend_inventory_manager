// ── JWT ─────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const SECRET     = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
if (!SECRET) { console.error('JWT_SECRET not set'); process.exit(1); }

const signToken   = (payload) => jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
const verifyToken = (token)   => jwt.verify(token, SECRET);

// ── AES Encryption (PIN / PUK) ───────────────────────────────────
const crypto    = require('crypto');
const ALGORITHM = 'aes-256-cbc';
const ENC_KEY   = Buffer.from((process.env.ENCRYPTION_KEY || '0'.repeat(64)), 'hex');

const encrypt = (text) => {
  if (!text) return null;
  const iv  = crypto.randomBytes(16);
  const c   = crypto.createCipheriv(ALGORITHM, ENC_KEY, iv);
  return iv.toString('hex') + ':' + Buffer.concat([c.update(String(text), 'utf8'), c.final()]).toString('hex');
};

const decrypt = (cipher) => {
  if (!cipher) return null;
  try {
    const [ivHex, encHex] = cipher.split(':');
    const d = crypto.createDecipheriv(ALGORITHM, ENC_KEY, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
};

// ── Response helpers ─────────────────────────────────────────────
const R = {
  ok:         (res, data, msg = 'Success')  => res.status(200).json({ success: true,  message: msg, data }),
  created:    (res, data, msg = 'Created')  => res.status(201).json({ success: true,  message: msg, data }),
  paginated:  (res, rows, total, page, limit) =>
    res.status(200).json({ success: true, data: rows,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } }),
  err:        (res, msg, code = 500, errors) =>
    res.status(code).json({ success: false, message: msg, ...(errors && { errors }) }),
  badRequest: (res, msg, errors) => R.err(res, msg, 400, errors),
  notFound:   (res, msg = 'Not found')      => R.err(res, msg, 404),
  forbidden:  (res, msg = 'Access denied')  => R.err(res, msg, 403),
  unauth:     (res, msg = 'Unauthorized')   => R.err(res, msg, 401),
};

const getErrMsg = (error, fallback = 'Something went wrong') => {
  if (!error?.response) return 'Network error';
  const { data } = error.response;
  if (data?.errors?.length) return data.errors.map(e => e.message).join(', ');
  return data?.message || fallback;
};

module.exports = { signToken, verifyToken, encrypt, decrypt, R, getErrMsg };
