const db = require("../config/db");

const create = async ({
  deviceId,
  reportedBy,
  dateLost,
  circumstances,
  lastKnownLocation,
  reportedByName,
  policeAbstract,
  incidentReportPath,
  policeObPath,
}) => {
  const [r] = await db.query(
    `INSERT INTO device_loss_reports
      (device_id, reported_by, date_lost, circumstances, last_known_location, reported_by_name, police_abstract, incident_report_path, police_ob_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceId,
      reportedBy,
      dateLost,
      circumstances,
      lastKnownLocation,
      reportedByName,
      policeAbstract,
      incidentReportPath || null,
      policeObPath || null,
    ],
  );
  return r.insertId;
};

const getByDevice = async (deviceId) => {
  const [rows] = await db.query(
    `SELECT lr.*, u.full_name AS reviewer_name
     FROM device_loss_reports lr
     LEFT JOIN users u ON u.id = lr.reviewed_by
     WHERE lr.device_id = ?
     ORDER BY lr.created_at DESC
     LIMIT 1`,
    [deviceId],
  );
  return rows[0] || null;
};

const review = async (id, { status, adminNotes, reviewedBy }) => {
  await db.query(
    `UPDATE device_loss_reports
     SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
     WHERE id = ?`,
    [status, adminNotes || null, reviewedBy, id],
  );
};

const recover = async (id, { adminNotes, reviewedBy }) => {
  await db.query(
    `UPDATE device_loss_reports
     SET status = 'recovered', admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
     WHERE id = ?`,
    [adminNotes, reviewedBy, id],
  );
};

module.exports = { create, getByDevice, review, recover };
