const db = require('../config/db');

const findByEmail = async (email) => {
  const [[row]] = await db.query(
    `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? AND u.is_active = 1 LIMIT 1`,
    [email]
  );
  return row ?? null;
};

const findById = async (id) => {
  const [[row]] = await db.query(
    `SELECT u.id, u.full_name, u.email, u.is_active, u.last_login, u.created_at, r.id AS role_id, r.name AS role, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1`,
    [parseInt(id)]
  );
  return row ?? null;
};

const create = async ({ roleId, fullName, email, passwordHash }) => {
  const [r] = await db.query(
    `INSERT INTO users (role_id, full_name, email, password_hash) VALUES (?, ?, ?, ?)`,
    [roleId, fullName, email, passwordHash]
  );
  return r.insertId;
};

const updateLastLogin = (id) => db.query(`UPDATE users SET last_login = NOW() WHERE id = ?`, [id]);

const list = async ({ page = 1, limit = 20, search = '' }) => {
  const p   = parseInt(page)  || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const like = `%${search}%`;
  const [rows]      = await db.query(
    `SELECT u.id, u.full_name, u.email, u.is_active, u.last_login, u.created_at, r.name AS role, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.full_name LIKE ? OR u.email LIKE ?
     ORDER BY u.created_at DESC LIMIT ${lim} OFFSET ${off}`, [like, like]);
  const [[{total}]] = await db.query(
    `SELECT COUNT(*) AS total FROM users u WHERE u.full_name LIKE ? OR u.email LIKE ?`, [like, like]);
  return { rows, total };
};

const update = async (id, fields) => {
  const allowed = { full_name: fields.fullName, email: fields.email, role_id: fields.roleId, is_active: fields.isActive, password_hash: fields.passwordHash };
  const sets = [], vals = [];
  for (const [col, val] of Object.entries(allowed)) {
    if (val !== undefined) { sets.push(`${col} = ?`); vals.push(val); }
  }
  if (!sets.length) return;
  vals.push(parseInt(id));
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
};

const deactivate = (id) => db.query(`UPDATE users SET is_active = 0 WHERE id = ?`, [parseInt(id)]);

module.exports = { findByEmail, findById, create, updateLastLogin, list, update, deactivate };
