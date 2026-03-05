const { verifyToken, R } = require('../utils');
const { validationResult } = require('express-validator');
const logger = require('../config/logger');

// ── JWT auth
const authenticate = (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return R.unauth(res, 'No token provided');
    req.user = verifyToken(header.split(' ')[1]);
    next();
  } catch (e) {
    logger.warn('JWT failed', { err: e.message, ip: req.ip });
    return e.name === 'TokenExpiredError'
      ? R.unauth(res, 'Token expired')
      : R.unauth(res, 'Invalid token');
  }
};

// ── RBAC  (admin=3 > field_officer=2 > viewer=1)
const LEVELS = { viewer: 1, field_officer: 2, admin: 3 };

const requireRole = (...roles) => (req, res, next) => {
  const userLevel = LEVELS[req.user?.role] ?? 0;
  const needed    = Math.min(...roles.map(r => LEVELS[r] ?? 99));
  return userLevel >= needed ? next() : R.forbidden(res);
};

const isAdmin   = requireRole('admin');
const isOfficer = requireRole('field_officer');   // officer + admin
const isViewer  = requireRole('viewer');           // any authenticated user

// ── Validation error handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return R.badRequest(res, 'Validation failed',
      errors.array().map(e => ({ field: e.path, message: e.msg })));
  next();
};

// ── Global error handler
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack, url: req.originalUrl });
  if (err.code === 'ER_DUP_ENTRY')       return R.err(res, 'A record with that value already exists', 409);
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return R.badRequest(res, 'Referenced record does not exist');
  return R.err(res, process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message);
};

module.exports = { authenticate, requireRole, isAdmin, isOfficer, isViewer, validate, errorHandler };
