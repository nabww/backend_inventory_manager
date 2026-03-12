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
            u.zone_type, u.zone_county_id, u.zone_sub_county_id,
            r.id AS role_id, r.name AS role, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1`,
    [parseInt(id)],
  );
  return row ?? null;
};

// Get facility ids assigned to a user (for zone_type = 'facility')
const getFacilityIds = async (userId) => {
  const [rows] = await db.query(
    `SELECT facility_id FROM user_facilities WHERE user_id = ?`,
    [parseInt(userId)],
  );
  return rows.map((r) => r.facility_id);
};

// Replace all facility assignments for a user
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

const create = async ({
  roleId,
  fullName,
  email,
  passwordHash,
  zoneType,
  zoneCountyId,
  zoneSubCountyId,
  facilityIds = [],
}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, zone_type, zone_county_id, zone_sub_county_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        roleId || 1,
        fullName,
        email,
        passwordHash,
        zoneType || "all",
        zoneCountyId || null,
        zoneSubCountyId || null,
      ],
    );
    const userId = r.insertId;
    if (zoneType === "facility" && facilityIds.length) {
      await setFacilities(userId, facilityIds, conn);
    }
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
            u.zone_type, u.zone_county_id, u.zone_sub_county_id,
            r.id AS role_id, r.name AS role, r.label AS role_label,
            co.name AS zone_county_name,
            sc.name AS zone_sub_county_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN counties co     ON co.id = u.zone_county_id
     LEFT JOIN sub_counties sc ON sc.id = u.zone_sub_county_id
     WHERE u.full_name LIKE ? OR u.email LIKE ?
     ORDER BY u.created_at DESC LIMIT ${lim} OFFSET ${off}`,
    [like, like],
  );

  // Attach facility list for facility-zoned users
  for (const u of rows) {
    if (u.zone_type === "facility") {
      const [facs] = await db.query(
        `SELECT f.id, f.name, f.mfl_code FROM user_facilities uf
         JOIN facilities f ON f.id = uf.facility_id
         WHERE uf.user_id = ? ORDER BY f.name ASC`,
        [u.id],
      );
      u.zone_facilities = facs;
    } else {
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
      zone_sub_county_id: fields.zoneSubCountyId ?? null,
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

    // Always sync facilities when zone_type is provided
    if (fields.zoneType === "facility") {
      await setFacilities(id, fields.facilityIds || [], conn);
    } else if (fields.zoneType && fields.zoneType !== "facility") {
      // Cleared to non-facility zone — remove all facility assignments
      await conn.query(`DELETE FROM user_facilities WHERE user_id = ?`, [
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
  setFacilities,
};
