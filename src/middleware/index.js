const { verifyToken, R } = require("../utils");
const { validationResult } = require("express-validator");
const logger = require("../config/logger");
const db = require("../config/db");

// ── JWT auth + zone hydration
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      return R.unauth(res, "No token provided");
    const payload = verifyToken(header.split(" ")[1]);

    // Hydrate zone fields from DB so zone changes take effect immediately
    const [[user]] = await db.query(
      `SELECT u.id, u.email, u.zone_type, u.zone_county_id, u.zone_sub_county_id,
              r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
      [payload.id],
    );
    if (!user) return R.unauth(res, "Account not found or deactivated");

    // For facility-zoned users, attach their facility id list
    if (user.zone_type === "facility") {
      const [facs] = await db.query(
        `SELECT facility_id FROM user_facilities WHERE user_id = ?`,
        [user.id],
      );
      user.zone_facility_ids = facs.map((f) => f.facility_id);
      user.zone_sub_county_ids = [];
    } else if (user.zone_type === "sub_county") {
      const [scs] = await db.query(
        `SELECT sub_county_id FROM user_sub_counties WHERE user_id = ?`,
        [user.id],
      );
      user.zone_sub_county_ids = scs.map((s) => s.sub_county_id);
      user.zone_facility_ids = [];
    } else {
      user.zone_facility_ids = [];
      user.zone_sub_county_ids = [];
    }

    req.user = user;
    next();
  } catch (e) {
    logger.warn("JWT failed", { err: e.message, ip: req.ip });
    return e.name === "TokenExpiredError"
      ? R.unauth(res, "Token expired")
      : R.unauth(res, "Invalid token");
  }
};

// ── RBAC  (admin=3 > field_officer=2 > viewer=1)
const LEVELS = { viewer: 1, field_officer: 2, admin: 3 };

const requireRole =
  (...roles) =>
  (req, res, next) => {
    const userLevel = LEVELS[req.user?.role] ?? 0;
    const needed = Math.min(...roles.map((r) => LEVELS[r] ?? 99));
    return userLevel >= needed ? next() : R.forbidden(res);
  };

const isAdmin = requireRole("admin");
const isOfficer = requireRole("field_officer");
const isViewer = requireRole("viewer");

// ── Validation error handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return R.badRequest(
      res,
      "Validation failed",
      errors.array().map((e) => ({ field: e.path, message: e.msg })),
    );
  next();
};

// ── Global error handler
const errorHandler = (err, req, res, next) => {
  logger.error("Unhandled error", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
  });
  if (err.code === "ER_DUP_ENTRY")
    return R.err(res, "A record with that value already exists", 409);
  if (err.code === "ER_NO_REFERENCED_ROW_2")
    return R.badRequest(res, "Referenced record does not exist");
  return R.err(
    res,
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  );
};

module.exports = {
  authenticate,
  requireRole,
  isAdmin,
  isOfficer,
  isViewer,
  validate,
  errorHandler,
};
