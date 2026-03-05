const db     = require('../config/db');
const logger = require('../config/logger');

const write = async ({ userId, action, entityType, entityId, oldValues, newValues, req }) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, action, entityType, entityId,
       oldValues ? JSON.stringify(oldValues) : null,
       newValues ? JSON.stringify(newValues) : null,
       req?.ip ?? null]
    );
  } catch (e) { logger.error('Audit write failed', { e: e.message }); }
};

const list = async ({ entityType, entityId, page = 1, limit = 20, search = '', action = '' }) => {
  const p   = parseInt(page)  || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const conds = ['1=1'];
  const params = [];
  if (entityType) { conds.push(`al.entity_type = '${entityType}' AND al.entity_id = ${parseInt(entityId)}`); }
  if (action)     { conds.push('al.action = ?'); params.push(action); }
  if (search)     { conds.push('u.full_name LIKE ?'); params.push(`%${search}%`); }
  const where = `WHERE ${conds.join(' AND ')}`;
  const [rows]      = await db.query(
    `SELECT al.*, u.full_name AS actor FROM audit_logs al JOIN users u ON u.id = al.user_id ${where} ORDER BY al.created_at DESC LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const [[{total}]] = await db.query(`SELECT COUNT(*) AS total FROM audit_logs al JOIN users u ON u.id = al.user_id ${where}`, params);
  return { rows, total };
};

module.exports = { write, list };
