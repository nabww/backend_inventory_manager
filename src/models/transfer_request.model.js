const db = require("../config/db");

const create = async ({
  deviceId,
  initiatedBy,
  destinationFacilityId,
  reason,
}) => {
  const [r] = await db.query(
    `INSERT INTO transfer_requests (device_id, requested_by, destination_facility_id, reason)
     VALUES (?, ?, ?, ?)`,
    [deviceId, initiatedBy, destinationFacilityId, reason || null],
  );

  await db.query(
    `UPDATE devices SET status = 'pending_transfer' WHERE id = ?`,
    [deviceId],
  );

  return r.insertId;
};

const getByDevice = async (deviceId) => {
  const [rows] = await db.query(
    `
    SELECT tr.*,
           u1.full_name AS initiated_by_name,
           u2.full_name AS reviewed_by_name,
           f.name AS destination_facility_name, f.mfl_code
    FROM transfer_requests tr
    JOIN users u1 ON u1.id = tr.requested_by
    LEFT JOIN users u2 ON u2.id = tr.reviewed_by
    JOIN facilities f ON f.id = tr.destination_facility_id
    WHERE tr.device_id = ?
    ORDER BY tr.created_at DESC`,
    [deviceId],
  );
  return rows;
};

const list = async ({ page = 1, limit = 20, status = "" } = {}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const conds = status ? ["tr.status = ?"] : [];
  const params = status ? [status] : [];
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
    SELECT tr.*, d.serial_number, d.model,
           f1.name AS current_facility_name, f1.mfl_code AS current_mfl,
           f2.name AS destination_facility_name, f2.mfl_code AS destination_mfl,
           u1.full_name AS initiated_by_name,
           u2.full_name AS reviewed_by_name
    FROM transfer_requests tr
    JOIN devices d ON d.id = tr.device_id
    JOIN facilities f1 ON f1.id = d.facility_id
    JOIN facilities f2 ON f2.id = tr.destination_facility_id
    JOIN users u1 ON u1.id = tr.requested_by
    LEFT JOIN users u2 ON u2.id = tr.reviewed_by
    ${where}
    ORDER BY tr.created_at DESC
    LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM transfer_requests tr ${where}`,
    params,
  );
  return { rows, total };
};

const review = async (id, { status, adminNotes, reviewedBy }) => {
  const [[tr]] = await db.query(
    `SELECT device_id, destination_facility_id FROM transfer_requests WHERE id = ?`,
    [parseInt(id)],
  );
  await db.query(
    `UPDATE transfer_requests SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
    [status, adminNotes || null, reviewedBy, parseInt(id)],
  );
  if (status === "approved") {
    // Record in facility_transfers and update device facility
    const [[device]] = await db.query(
      `SELECT facility_id FROM devices WHERE id = ?`,
      [tr.device_id],
    );
    await db.query(
      `INSERT INTO facility_transfers (device_id, from_facility_id, to_facility_id, transferred_by, reason)
VALUES (?, ?, ?, ?,?)`,
      [
        tr.device_id,
        device.facility_id,
        tr.destination_facility_id,
        reviewedBy,
        adminNotes,
      ],
    );
    await db.query(
      `UPDATE devices SET status = 'active', facility_id = ? WHERE id = ?`,
      [tr.destination_facility_id, tr.device_id],
    );
  } else if (status === "rejected") {
    await db.query(`UPDATE devices SET status = 'active' WHERE id = ?`, [
      tr.device_id,
    ]);
  }
};

const getById = async (id) => {
  const [[row]] = await db.query(
    `
    SELECT tr.*,
           d.serial_number, d.model,
           f1.name AS current_facility_name, f1.mfl_code AS current_mfl,
           f2.name AS destination_facility_name, f2.mfl_code AS destination_mfl,
           u1.full_name AS requested_by_name, u1.email AS requested_by_email,
           u2.full_name AS reviewed_by_name
    FROM transfer_requests tr
    JOIN devices d ON d.id = tr.device_id
    JOIN facilities f1 ON f1.id = d.facility_id
    JOIN facilities f2 ON f2.id = tr.destination_facility_id
    JOIN users u1 ON u1.id = tr.requested_by
    LEFT JOIN users u2 ON u2.id = tr.reviewed_by
    WHERE tr.id = ? LIMIT 1`,
    [parseInt(id)],
  );
  return row ?? null;
};

module.exports = { create, getByDevice, list, review, getById };
