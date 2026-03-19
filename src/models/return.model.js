const db = require("../config/db");

const create = async ({ deviceId, requestedBy, reason }) => {
  const [r] = await db.query(
    `INSERT INTO return_requests (device_id, requested_by, reason) VALUES (?, ?, ?)`,
    [deviceId, requestedBy, reason],
  );
  await db.query(`UPDATE devices SET status = 'returned' WHERE id = ?`, [
    deviceId,
  ]);
  return r.insertId;
};

const getByDevice = async (deviceId) => {
  const [rows] = await db.query(
    `
    SELECT rr.*,
           u1.full_name AS requested_by_name,
           u2.full_name AS reviewed_by_name,
           u3.full_name AS reissued_by_name,
           f.name AS reissued_to_facility_name, f.mfl_code
    FROM return_requests rr
    JOIN users u1 ON u1.id = rr.requested_by
    LEFT JOIN users u2 ON u2.id = rr.reviewed_by
    LEFT JOIN users u3 ON u3.id = rr.reissued_by
    LEFT JOIN facilities f ON f.id = rr.reissued_to_facility
    WHERE rr.device_id = ?
    ORDER BY rr.created_at DESC`,
    [deviceId],
  );
  return rows;
};

const list = async ({ page = 1, limit = 20, status = "" } = {}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const conds = status ? ["rr.status = ?"] : [];
  const params = status ? [status] : [];
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
    SELECT rr.*, d.serial_number, d.model,
           f.name AS facility_name, f.mfl_code,
           u1.full_name AS requested_by_name,
           u2.full_name AS reviewed_by_name
    FROM return_requests rr
    JOIN devices d ON d.id = rr.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN users u1 ON u1.id = rr.requested_by
    LEFT JOIN users u2 ON u2.id = rr.reviewed_by
    ${where}
    ORDER BY rr.created_at DESC
    LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM return_requests rr ${where}`,
    params,
  );
  return { rows, total };
};

const review = async (
  id,
  { status, adminNotes, reviewedBy, storageLocation, receivedDate, receivedBy },
) => {
  await db.query(
    `UPDATE return_requests SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW(),
     storage_location = ?, received_date = ?, received_by = ? WHERE id = ?`,
    [
      status,
      adminNotes || null,
      reviewedBy,
      storageLocation || null,
      receivedDate || null,
      receivedBy || null,
      parseInt(id),
    ],
  );
  // Update device status
  if (status === "approved") {
    const [[rr]] = await db.query(
      `SELECT device_id FROM return_requests WHERE id = ?`,
      [parseInt(id)],
    );
    await db.query(`UPDATE devices SET status = 'returned' WHERE id = ?`, [
      rr.device_id,
    ]);
  } else if (status === "rejected") {
    const [[rr]] = await db.query(
      `SELECT device_id FROM return_requests WHERE id = ?`,
      [parseInt(id)],
    );
    await db.query(`UPDATE devices SET status = 'active' WHERE id = ?`, [
      rr.device_id,
    ]);
  }
};

const reissue = async (
  id,
  { reissuedBy, reissuedDate, reissuedToFacility },
) => {
  const [[rr]] = await db.query(
    `SELECT device_id FROM return_requests WHERE id = ?`,
    [parseInt(id)],
  );
  await db.query(
    `UPDATE return_requests SET status = 'reissued', reissued_by = ?, reissued_date = ?, reissued_to_facility = ? WHERE id = ?`,
    [reissuedBy, reissuedDate, reissuedToFacility, parseInt(id)],
  );
  await db.query(
    `UPDATE devices SET status = 'active', facility_id = ? WHERE id = ?`,
    [reissuedToFacility, rr.device_id],
  );
  return rr.device_id;
};

const getById = async (id) => {
  const [[row]] = await db.query(
    `
    SELECT rr.*,
           d.serial_number, d.model,
           f.name AS facility_name, f.mfl_code,
           u1.full_name AS requested_by_name, u1.email AS requested_by_email,
           u2.full_name AS reviewed_by_name,
           u3.full_name AS reissued_by_name,
           f2.name AS reissued_to_facility_name
    FROM return_requests rr
    JOIN devices d ON d.id = rr.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN users u1 ON u1.id = rr.requested_by
    LEFT JOIN users u2 ON u2.id = rr.reviewed_by
    LEFT JOIN users u3 ON u3.id = rr.reissued_by
    LEFT JOIN facilities f2 ON f2.id = rr.reissued_to_facility
    WHERE rr.id = ? LIMIT 1`,
    [parseInt(id)],
  );
  return row ?? null;
};

module.exports = { create, getByDevice, list, review, reissue, getById };
