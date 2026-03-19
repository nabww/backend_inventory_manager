const db = require("../config/db");

// Create — stays pending until admin approves
const create = async ({
  deviceId,
  initiatedBy,
  failureCause,
  sentTo,
  sentDate,
  signedOffBy,
}) => {
  const [r] = await db.query(
    `INSERT INTO repair_requests (device_id, initiated_by, failure_cause, sent_to, sent_date, signed_off_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      deviceId,
      initiatedBy,
      failureCause,
      sentTo || null,
      sentDate || null,
      signedOffBy || null,
    ],
  );
  return r.insertId;
};

// Admin approves (sets under_repair) or rejects
const review = async (
  id,
  { status, adminNotes, reviewedBy, sentTo, sentDate, signedOffBy },
) => {
  const [[rp]] = await db.query(
    `SELECT device_id FROM repair_requests WHERE id = ?`,
    [parseInt(id)],
  );
  await db.query(
    `UPDATE repair_requests SET status = ?, admin_notes = ?,
     sent_to = COALESCE(?, sent_to), sent_date = COALESCE(?, sent_date),
     signed_off_by = COALESCE(?, signed_off_by)
     WHERE id = ?`,
    [
      status,
      adminNotes || null,
      sentTo || null,
      sentDate || null,
      signedOffBy || null,
      parseInt(id),
    ],
  );
  if (status === "under_repair") {
    await db.query(`UPDATE devices SET status = 'under_repair' WHERE id = ?`, [
      rp.device_id,
    ]);
  }
  // rejected — device stays active
};

const getByDevice = async (deviceId) => {
  const [rows] = await db.query(
    `
    SELECT rp.*,
           u1.full_name AS initiated_by_name,
           u2.full_name AS reissued_by_name,
           f.name AS reissued_to_facility_name, f.mfl_code
    FROM repair_requests rp
    JOIN users u1 ON u1.id = rp.initiated_by
    LEFT JOIN users u2 ON u2.id = rp.reissued_by
    LEFT JOIN facilities f ON f.id = rp.reissued_to_facility
    WHERE rp.device_id = ?
    ORDER BY rp.created_at DESC`,
    [deviceId],
  );
  return rows;
};

const list = async ({ page = 1, limit = 20, status = "" } = {}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const conds = status ? ["rp.status = ?"] : [];
  const params = status ? [status] : [];
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
    SELECT rp.*, d.serial_number, d.model,
           f.name AS facility_name, f.mfl_code,
           u1.full_name AS initiated_by_name
    FROM repair_requests rp
    JOIN devices d ON d.id = rp.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN users u1 ON u1.id = rp.initiated_by
    ${where}
    ORDER BY rp.created_at DESC
    LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM repair_requests rp ${where}`,
    params,
  );
  return { rows, total };
};

const markReturned = async (
  id,
  { returnedDate, returnCondition, adminNotes },
) => {
  const [[rp]] = await db.query(
    `SELECT device_id FROM repair_requests WHERE id = ?`,
    [parseInt(id)],
  );
  await db.query(
    `UPDATE repair_requests SET status = 'repair_return_pending', returned_date = ?, return_condition = ?, admin_notes = ? WHERE id = ?`,
    [
      returnedDate || new Date().toISOString().split("T")[0],
      returnCondition || null,
      adminNotes || null,
      parseInt(id),
    ],
  );
  await db.query(
    `UPDATE devices SET status = 'repair_return_pending' WHERE id = ?`,
    [rp.device_id],
  );
  return rp.device_id;
};

const reissue = async (
  id,
  { reissuedBy, reissuedDate, reissuedToFacility },
) => {
  const [[rp]] = await db.query(
    `SELECT device_id FROM repair_requests WHERE id = ?`,
    [parseInt(id)],
  );
  await db.query(
    `UPDATE repair_requests SET status = 'reissued', reissued_by = ?, reissued_date = ?, reissued_to_facility = ? WHERE id = ?`,
    [reissuedBy, reissuedDate, reissuedToFacility, parseInt(id)],
  );
  await db.query(
    `UPDATE devices SET status = 'active', facility_id = ? WHERE id = ?`,
    [reissuedToFacility, rp.device_id],
  );
  return rp.device_id;
};

const getById = async (id) => {
  const [[row]] = await db.query(
    `
    SELECT rp.*,
           d.serial_number, d.model,
           f.name AS facility_name, f.mfl_code,
           u1.full_name AS initiated_by_name, u1.email AS initiated_by_email,
           u2.full_name AS reissued_by_name,
           f2.name AS reissued_to_facility_name
    FROM repair_requests rp
    JOIN devices d ON d.id = rp.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN users u1 ON u1.id = rp.initiated_by
    LEFT JOIN users u2 ON u2.id = rp.reissued_by
    LEFT JOIN facilities f2 ON f2.id = rp.reissued_to_facility
    WHERE rp.id = ? LIMIT 1`,
    [parseInt(id)],
  );
  return row ?? null;
};

module.exports = {
  create,
  getByDevice,
  list,
  review,
  markReturned,
  reissue,
  getById,
};
