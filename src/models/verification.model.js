const db = require("../config/db");

// Shared zone filter builder (mirrors device_model applyZone)
const applyZone = (user, conds, params) => {
  if (!user || user.id === 1 || user.zone_type === "all") return;
  if (user.zone_type === "facility") {
    conds.push(
      "d.facility_id IN (SELECT facility_id FROM user_facilities WHERE user_id = ?)",
    );
    params.push(parseInt(user.id));
  } else if (user.zone_type === "sub_county") {
    conds.push(
      "f.sub_county_id IN (SELECT sub_county_id FROM user_sub_counties WHERE user_id = ?)",
    );
    params.push(parseInt(user.id));
  } else if (user.zone_type === "county" && user.zone_county_id) {
    conds.push("f.county_id = ?");
    params.push(parseInt(user.zone_county_id));
  }
};

const create = async ({
  deviceId,
  verifiedBy,
  overallStatus,
  devicePresent,
  simPaired,
  coverOk,
  powersOn,
  emrWorking,
  notes,
}) => {
  const [r] = await db.query(
    `INSERT INTO verifications
      (device_id, verified_by, overall_status, device_present, sim_paired,
       cover_ok, powers_on, emr_working, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceId,
      verifiedBy,
      overallStatus || "pass",
      devicePresent ? 1 : 0,
      simPaired ? 1 : 0,
      coverOk ? 1 : 0,
      powersOn ? 1 : 0,
      emrWorking ? 1 : 0,
      notes || null,
    ],
  );
  return r.insertId;
};

const getByDevice = async (deviceId, { page = 1, limit = 20 } = {}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const [rows] = await db.query(
    `SELECT v.*, u.full_name AS verified_by_name
     FROM verifications v
     JOIN users u ON u.id = v.verified_by
     WHERE v.device_id = ?
     ORDER BY v.verified_at DESC
     LIMIT ${lim} OFFSET ${off}`,
    [deviceId],
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM verifications WHERE device_id = ?`,
    [deviceId],
  );
  return { rows, total };
};

const listAll = async ({ page = 1, limit = 20, year = "", user = null }) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;

  const conds = ["1=1"];
  const params = [];

  applyZone(user, conds, params);

  if (year) {
    conds.push("YEAR(v.verified_at) = ?");
    params.push(parseInt(year));
  }

  const where = `WHERE ${conds.join(" AND ")}`;

  const [rows] = await db.query(
    `
    SELECT v.*, d.serial_number, d.model,
           f.name AS facility, f.mfl_code,
           c.name AS county, sc.name AS sub_county,
           u.full_name AS verified_by_name
    FROM verifications v
    JOIN devices d    ON d.id = v.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN counties c   ON c.id = f.county_id
    LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
    JOIN users u      ON u.id = v.verified_by
    ${where}
    ORDER BY v.verified_at DESC
    LIMIT ${lim} OFFSET ${off}`,
    params,
  );

  const [[{ total }]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM verifications v
    JOIN devices d    ON d.id = v.device_id
    JOIN facilities f ON f.id = d.facility_id
    ${where}`,
    params,
  );

  return { rows, total };
};

module.exports = { create, getByDevice, listAll };
