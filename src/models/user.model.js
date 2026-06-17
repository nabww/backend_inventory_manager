const db = require("../config/db");

const findByEmail = async (email) => {
  const [[row]] = await db.query(
    `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? AND u.is_active = 1 LIMIT 1`,
    [email],
  );
  return row ?? null;
};

const findById = async (id) => {
  const [[row]] = await db.query(
    `SELECT u.id, u.full_name, u.email, u.is_active, u.last_login, u.created_at,
            u.zone_type, u.zone_county_id,
            r.id AS role_id, r.name AS role, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1`,
    [parseInt(id)],
  );
  return row ?? null;
};

const getFacilityIds = async (userId) => {
  const [rows] = await db.query(
    `SELECT facility_id FROM user_facilities WHERE user_id = ?`,
    [parseInt(userId)],
  );
  return rows.map((r) => r.facility_id);
};

const getSubCountyIds = async (userId) => {
  const [rows] = await db.query(
    `SELECT sub_county_id FROM user_sub_counties WHERE user_id = ?`,
    [parseInt(userId)],
  );
  return rows.map((r) => r.sub_county_id);
};

const setFacilities = async (userId, facilityIds = [], conn = db) => {
  await conn.query(`DELETE FROM user_facilities WHERE user_id = ?`, [
    parseInt(userId),
  ]);
  if (facilityIds.length) {
    const vals = facilityIds.map((fid) => [parseInt(userId), parseInt(fid)]);
    await conn.query(
      `INSERT INTO user_facilities (user_id, facility_id) VALUES ?`,
      [vals],
    );
  }
};

const setSubCounties = async (userId, subCountyIds = [], conn = db) => {
  await conn.query(`DELETE FROM user_sub_counties WHERE user_id = ?`, [
    parseInt(userId),
  ]);
  if (subCountyIds.length) {
    const vals = subCountyIds.map((sid) => [parseInt(userId), parseInt(sid)]);
    await conn.query(
      `INSERT INTO user_sub_counties (user_id, sub_county_id) VALUES ?`,
      [vals],
    );
  }
};

const create = async ({
  roleId,
  fullName,
  email,
  passwordHash,
  zoneType,
  zoneCountyId,
  subCountyIds = [],
  facilityIds = [],
}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, zone_type, zone_county_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        roleId || 1,
        fullName,
        email,
        passwordHash,
        zoneType || "all",
        zoneCountyId || null,
      ],
    );
    const userId = r.insertId;
    if (zoneType === "sub_county" && subCountyIds.length)
      await setSubCounties(userId, subCountyIds, conn);
    if (zoneType === "facility" && facilityIds.length)
      await setFacilities(userId, facilityIds, conn);
    await conn.commit();
    return userId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const updateLastLogin = (id) =>
  db.query(`UPDATE users SET last_login = NOW() WHERE id = ?`, [id]);

const list = async ({ page = 1, limit = 20, search = "" }) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const like = `%${search}%`;
  const [rows] = await db.query(
    `SELECT u.id, u.full_name, u.email, u.is_active, u.last_login, u.created_at,
            u.zone_type, u.zone_county_id,
            r.id AS role_id, r.name AS role, r.label AS role_label,
            co.name AS zone_county_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN counties co ON co.id = u.zone_county_id
     WHERE u.full_name LIKE ? OR u.email LIKE ?
     ORDER BY u.created_at DESC LIMIT ${lim} OFFSET ${off}`,
    [like, like],
  );

  // Attach sub-county and facility lists
  for (const u of rows) {
    if (u.zone_type === "sub_county") {
      const [scs] = await db.query(
        `SELECT sc.id, sc.name FROM user_sub_counties usc
         JOIN sub_counties sc ON sc.id = usc.sub_county_id
         WHERE usc.user_id = ? ORDER BY sc.name ASC`,
        [u.id],
      );
      u.zone_sub_counties = scs;
      u.zone_facilities = [];
    } else if (u.zone_type === "facility") {
      const [facs] = await db.query(
        `SELECT f.id, f.name, f.mfl_code FROM user_facilities uf
         JOIN facilities f ON f.id = uf.facility_id
         WHERE uf.user_id = ? ORDER BY f.name ASC`,
        [u.id],
      );
      u.zone_facilities = facs;
      u.zone_sub_counties = [];
    } else {
      u.zone_sub_counties = [];
      u.zone_facilities = [];
    }
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM users u WHERE u.full_name LIKE ? OR u.email LIKE ?`,
    [like, like],
  );
  return { rows, total };
};

const update = async (id, fields) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const allowed = {
      full_name: fields.fullName,
      email: fields.email,
      role_id: fields.roleId,
      is_active: fields.isActive,
      password_hash: fields.passwordHash,
      zone_type: fields.zoneType,
      zone_county_id: fields.zoneCountyId ?? null,
    };
    const sets = [],
      vals = [];
    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }
    if (sets.length) {
      vals.push(parseInt(id));
      await conn.query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
        vals,
      );
    }

    if (fields.zoneType === "sub_county") {
      await setSubCounties(id, fields.subCountyIds || [], conn);
      await conn.query(`DELETE FROM user_facilities WHERE user_id = ?`, [
        parseInt(id),
      ]);
    } else if (fields.zoneType === "facility") {
      await setFacilities(id, fields.facilityIds || [], conn);
      await conn.query(`DELETE FROM user_sub_counties WHERE user_id = ?`, [
        parseInt(id),
      ]);
    } else if (
      fields.zoneType &&
      !["sub_county", "facility"].includes(fields.zoneType)
    ) {
      await conn.query(`DELETE FROM user_facilities WHERE user_id = ?`, [
        parseInt(id),
      ]);
      await conn.query(`DELETE FROM user_sub_counties WHERE user_id = ?`, [
        parseInt(id),
      ]);
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const deactivate = (id) =>
  db.query(`UPDATE users SET is_active = 0 WHERE id = ?`, [parseInt(id)]);

const getByRole = async (roleName) => {
  const [rows] = await db.query(
    `SELECT u.id, u.full_name, u.email, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = ? AND u.is_active = 1`,
    [roleName],
  );
  return rows;
};

const getByMinRole = async () => {
  const [rows] = await db.query(
    `SELECT u.id, u.full_name, u.email, r.name AS role, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name IN ('field_officer','admin') AND u.is_active = 1
     ORDER BY u.full_name ASC`,
  );
  return rows;
};

// Get all active admins whose zone covers a specific facility
const getAdminsByFacility = async (facilityId) => {
  const db = require("../config/db");   // adjust path if your db config is elsewhere
  const [[fac]] = await db.query(
    `SELECT id, county_id, sub_county_id FROM facilities WHERE id = ?`,
    [parseInt(facilityId)]
  );
  if (!fac) return [];

  const [rows] = await db.query(`
    SELECT DISTINCT u.id, u.full_name, u.email, r.name AS role
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'admin'
      AND u.is_active = 1
      AND (
        -- super admin or zone_type = all
        u.id = 1
        OR u.zone_type = 'all'
        -- county match
        OR (u.zone_type = 'county' AND u.zone_county_id = ?)
        -- sub_county match via junction
        OR (u.zone_type = 'sub_county' AND EXISTS (
          SELECT 1 FROM user_sub_counties usc
          WHERE usc.user_id = u.id AND usc.sub_county_id = ?
        ))
        -- facility match via junction
        OR (u.zone_type = 'facility' AND EXISTS (
          SELECT 1 FROM user_facilities uf
          WHERE uf.user_id = u.id AND uf.facility_id = ?
        ))
      )
  `, [fac.county_id, fac.sub_county_id, parseInt(facilityId)]);

  return rows;
};


module.exports = {
  findByEmail,
  findById,
  create,
  updateLastLogin,
  list,
  update,
  deactivate,
  getByRole,
  getByMinRole,
  getFacilityIds,
  getSubCountyIds,
  setFacilities,
  setSubCounties,
  getAdminsByFacility,
};
