const db = require('../config/db');

const create = async ({ deviceId, verifiedBy, devicePresent, simPaired, coverOk, powersOn, emrWorking, overallStatus, notes }) => {
  const [r] = await db.query(
    `INSERT INTO verifications (device_id, verified_by, device_present, sim_paired, cover_ok, powers_on, emr_working, overall_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [parseInt(deviceId), parseInt(verifiedBy),
     devicePresent ? 1 : 0, simPaired ? 1 : 0, coverOk ? 1 : 0, powersOn ? 1 : 0, emrWorking ? 1 : 0,
     overallStatus || 'pass', notes || null]
  );
  return r.insertId;
};

const getByDevice = async (deviceId, { page = 1, limit = 20 } = {}) => {
  const p   = parseInt(page)  || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const [rows]      = await db.query(
    `SELECT v.*, u.full_name AS verified_by_name FROM verifications v
     JOIN users u ON u.id = v.verified_by WHERE v.device_id = ?
     ORDER BY v.verified_at DESC LIMIT ${lim} OFFSET ${off}`, [parseInt(deviceId)]);
  const [[{total}]] = await db.query(
    `SELECT COUNT(*) AS total FROM verifications WHERE device_id = ?`, [parseInt(deviceId)]);
  return { rows, total };
};

const listAll = async ({ page = 1, limit = 20, year = '' }) => {
  const p   = parseInt(page)  || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const where = year ? `WHERE YEAR(v.verified_at) = ${parseInt(year)}` : '';
  const [rows]      = await db.query(
    `SELECT v.*, d.serial_number, d.model, f.name AS facility, f.mfl_code, u.full_name AS verified_by_name
     FROM verifications v
     JOIN devices d ON d.id = v.device_id
     JOIN facilities f ON f.id = d.facility_id
     JOIN users u ON u.id = v.verified_by
     ${where} ORDER BY v.verified_at DESC LIMIT ${lim} OFFSET ${off}`);
  const [[{total}]] = await db.query(`SELECT COUNT(*) AS total FROM verifications v ${where}`);
  return { rows, total };
};

module.exports = { create, getByDevice, listAll };
