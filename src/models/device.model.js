const db = require("../config/db");
const { encrypt, decrypt } = require("../utils");

const BASE = `
  SELECT
    d.id, d.serial_number, d.imei, d.model, d.asset_tag, d.ip_address,
    d.cover_condition, d.cover_notes, d.date_issued, d.assigned_to,
    d.status, d.notes, d.has_sim, d.locked, d.created_at, d.updated_at,
    -- facility
    f.id AS facility_id, f.mfl_code, f.name AS facility_name,
    c.name AS county, sc.name AS sub_county,
    -- affiliation
    a.id AS affiliation_id, a.name AS affiliation,
    -- sim
    s.id AS sim_id, s.sim_serial, s.phone_number, s.pin AS pin_enc,
    s.puk AS puk_enc, s.network,
    -- users
    cu.full_name AS created_by_name,
    -- last verification
    lv.verified_at AS last_verified_at, lv.overall_status AS last_verification_status,
    lv_u.full_name AS last_verified_by
  FROM devices d
  JOIN facilities f   ON f.id = d.facility_id
  JOIN counties c     ON c.id = f.county_id
  LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
  JOIN affiliations a  ON a.id = d.affiliation_id
  LEFT JOIN sim_cards s ON s.id = d.sim_card_id
  LEFT JOIN users cu   ON cu.id = d.created_by
  LEFT JOIN (
    SELECT device_id, verified_at, overall_status, verified_by,
           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY verified_at DESC) AS rn
    FROM verifications
  ) lv ON lv.device_id = d.id AND lv.rn = 1
  LEFT JOIN users lv_u ON lv_u.id = lv.verified_by
`;

const decryptSim = (row) => {
  if (!row) return null;
  return {
    ...row,
    pin: decrypt(row.pin_enc),
    puk: decrypt(row.puk_enc),
    pin_enc: undefined,
    puk_enc: undefined,
  };
};

const applyZone = (user, conds, params) => {
  if (!user || user.role === "admin" || user.zone_type === "all") return;
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

const list = async ({
  page = 1,
  limit = 20,
  search = "",
  status = "",
  facilityId = "",
  affiliationId = "",
  countyId = "",
  user = null,
}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const conds = ["1=1"];
  const params = [];

  applyZone(user, conds, params);

  if (search) {
    conds.push(
      "(d.serial_number LIKE ? OR d.imei LIKE ? OR d.asset_tag LIKE ? OR d.model LIKE ? OR f.mfl_code LIKE ? OR f.name LIKE ? OR s.phone_number LIKE ?)",
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status) {
    conds.push("d.status = ?");
    params.push(status);
  }
  if (facilityId) {
    conds.push("d.facility_id = ?");
    params.push(parseInt(facilityId));
  }
  if (affiliationId) {
    conds.push("d.affiliation_id = ?");
    params.push(parseInt(affiliationId));
  }
  if (countyId) {
    conds.push("f.county_id = ?");
    params.push(parseInt(countyId));
  }

  const where = `WHERE ${conds.join(" AND ")}`;

  const [rows] = await db.query(
    `${BASE} ${where} ORDER BY d.created_at DESC LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM devices d
     JOIN facilities f ON f.id = d.facility_id
     LEFT JOIN sim_cards s ON s.id = d.sim_card_id
     ${where}`,
    params,
  );

  return { rows: rows.map(decryptSim), total };
};

const getById = async (id) => {
  const [[row]] = await db.query(`${BASE} WHERE d.id = ? LIMIT 1`, [
    parseInt(id),
  ]);
  return decryptSim(row ?? null);
};

const getBySerial = async (serial) => {
  const [[row]] = await db.query(`${BASE} WHERE d.serial_number = ? LIMIT 1`, [
    serial,
  ]);
  return decryptSim(row ?? null);
};

const create = async (fields, createdBy) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let simCardId = null;
    if (fields.hasSim && (fields.simSerial || fields.phoneNumber)) {
      const [sr] = await conn.query(
        `INSERT INTO sim_cards (sim_serial, phone_number, pin, puk, network)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sim_serial   = sim_serial,
           phone_number = COALESCE(VALUES(phone_number), phone_number),
           pin          = COALESCE(VALUES(pin), pin),
           puk          = COALESCE(VALUES(puk), puk),
           network      = COALESCE(VALUES(network), network)`,
        [
          fields.simSerial || null,
          fields.phoneNumber || null,
          fields.pin ? encrypt(fields.pin) : null,
          fields.puk ? encrypt(fields.puk) : null,
          fields.network || null,
        ],
      );
      simCardId =
        sr.insertId ||
        (await (async () => {
          const [[existing]] = await conn.query(
            `SELECT id FROM sim_cards WHERE phone_number = ? LIMIT 1`,
            [fields.phoneNumber],
          );
          return existing?.id || null;
        })());
    }

    const [dr] = await conn.query(
      `INSERT INTO devices
        (facility_id, affiliation_id, sim_card_id, has_sim, serial_number, imei, model,
         asset_tag, ip_address, cover_condition, cover_notes, date_issued, assigned_to,
         status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parseInt(fields.facilityId),
        parseInt(fields.affiliationId),
        simCardId,
        fields.hasSim ? 1 : 0,
        fields.serialNumber,
        fields.imei || null,
        fields.model || null,
        fields.assetTag || null,
        fields.ipAddress || null,
        fields.coverCondition || "good",
        fields.coverNotes || null,
        fields.dateIssued || null,
        fields.assignedTo || null,
        fields.status || "active",
        fields.notes || null,
        createdBy,
      ],
    );

    await conn.commit();
    return dr.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const update = async (id, fields, updatedBy) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[current]] = await conn.query(
      `SELECT sim_card_id, has_sim FROM devices WHERE id = ?`,
      [parseInt(id)],
    );

    if (fields.hasSim) {
      if (current.sim_card_id) {
        const simSets = [],
          simVals = [];
        const simMap = {
          simSerial: "sim_serial",
          phoneNumber: "phone_number",
          network: "network",
        };
        for (const [k, col] of Object.entries(simMap)) {
          if (fields[k] !== undefined) {
            simSets.push(`${col} = ?`);
            simVals.push(fields[k]);
          }
        }
        if (fields.pin !== undefined) {
          simSets.push("pin = ?");
          simVals.push(encrypt(fields.pin));
        }
        if (fields.puk !== undefined) {
          simSets.push("puk = ?");
          simVals.push(encrypt(fields.puk));
        }
        if (simSets.length) {
          simVals.push(current.sim_card_id);
          await conn.query(
            `UPDATE sim_cards SET ${simSets.join(", ")} WHERE id = ?`,
            simVals,
          );
        }
      } else if (fields.simSerial || fields.phoneNumber) {
        const [sr] = await conn.query(
          `INSERT INTO sim_cards (sim_serial, phone_number, pin, puk, network)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             sim_serial = VALUES(sim_serial),
             pin        = COALESCE(VALUES(pin), pin),
             puk        = COALESCE(VALUES(puk), puk),
             network    = COALESCE(VALUES(network), network)`,
          [
            fields.simSerial || null,
            fields.phoneNumber || null,
            fields.pin ? encrypt(fields.pin) : null,
            fields.puk ? encrypt(fields.puk) : null,
            fields.network || null,
          ],
        );
        const simId = sr.insertId
          ? sr.insertId
          : (
              await conn.query(
                `SELECT id FROM sim_cards WHERE phone_number = ? LIMIT 1`,
                [fields.phoneNumber],
              )
            )[0][0]?.id;
        if (simId)
          await conn.query(`UPDATE devices SET sim_card_id = ? WHERE id = ?`, [
            simId,
            parseInt(id),
          ]);
      }
    } else if (!fields.hasSim && current.sim_card_id) {
      await conn.query(`UPDATE devices SET sim_card_id = NULL WHERE id = ?`, [
        parseInt(id),
      ]);
    }

    const devSets = [],
      devVals = [];
    const devMap = {
      facilityId: "facility_id",
      affiliationId: "affiliation_id",
      serialNumber: "serial_number",
      imei: "imei",
      model: "model",
      assetTag: "asset_tag",
      ipAddress: "ip_address",
      coverCondition: "cover_condition",
      coverNotes: "cover_notes",
      dateIssued: "date_issued",
      assignedTo: "assigned_to",
      status: "status",
      notes: "notes",
      locked: "locked",
    };
    for (const [k, col] of Object.entries(devMap)) {
      if (fields[k] !== undefined) {
        const val = k === "locked" ? (fields[k] ? 1 : 0) : fields[k] || null;
        devSets.push(`${col} = ?`);
        devVals.push(val);
      }
    }
    if (fields.hasSim !== undefined) {
      devSets.push("has_sim = ?");
      devVals.push(fields.hasSim ? 1 : 0);
    }
    devSets.push("updated_by = ?");
    devVals.push(updatedBy, parseInt(id));
    await conn.query(
      `UPDATE devices SET ${devSets.join(", ")} WHERE id = ?`,
      devVals,
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const transfer = async (id, toFacilityId, reason, userId) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[dev]] = await conn.query(
      `SELECT facility_id FROM devices WHERE id = ?`,
      [parseInt(id)],
    );
    await conn.query(
      `UPDATE devices SET facility_id = ?, updated_by = ? WHERE id = ?`,
      [parseInt(toFacilityId), userId, parseInt(id)],
    );
    await conn.query(
      `INSERT INTO facility_transfers (device_id, from_facility_id, to_facility_id, transferred_by, reason) VALUES (?, ?, ?, ?, ?)`,
      [
        parseInt(id),
        dev.facility_id,
        parseInt(toFacilityId),
        userId,
        reason || null,
      ],
    );
    await conn.commit();
    return dev.facility_id;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const remove = (id) =>
  db.query(`DELETE FROM devices WHERE id = ?`, [parseInt(id)]);

const getTransfers = async (deviceId) => {
  const [rows] = await db.query(
    `SELECT ft.*, ff.name AS from_facility, ff.mfl_code AS from_mfl,
            tf.name AS to_facility, tf.mfl_code AS to_mfl,
            u.full_name AS transferred_by_name
     FROM facility_transfers ft
     JOIN facilities ff ON ff.id = ft.from_facility_id
     JOIN facilities tf ON tf.id = ft.to_facility_id
     JOIN users u ON u.id = ft.transferred_by
     WHERE ft.device_id = ? ORDER BY ft.transferred_at DESC`,
    [parseInt(deviceId)],
  );
  return rows;
};

const getDashboardStats = async (user = null) => {
  const zoneConds = ["1=1"];
  const zoneParams = [];
  applyZone(user, zoneConds, zoneParams);
  const zoneWhere = zoneConds.join(" AND ");

  const [[stats]] = await db.query(
    `
    SELECT
      COUNT(*)                                AS total_devices,
      SUM(d.status = 'active')                AS active_devices,
      SUM(d.has_sim = 1)                      AS devices_with_sim,
      SUM(d.has_sim = 0)                      AS wifi_only,
      SUM(d.cover_condition != 'good')        AS cover_issues,
      SUM(d.status = 'lost')                  AS lost_devices,
      SUM(d.status = 'under_repair')          AS under_repair,
      (SELECT COUNT(DISTINCT v.device_id)
       FROM verifications v
       JOIN devices dv ON dv.id = v.device_id
       JOIN facilities fv ON fv.id = dv.facility_id
       WHERE YEAR(v.verified_at) = YEAR(CURDATE())
       AND dv.status = 'active'
       AND ${zoneWhere.replace(/d\./g, "dv.").replace(/f\./g, "fv.")}) AS verified_this_year
    FROM devices d
    JOIN facilities f ON f.id = d.facility_id
    WHERE ${zoneWhere}`,
    [...zoneParams, ...zoneParams],
  );

  const [[verifiedCount]] = await db.query(
    `
    SELECT
      COUNT(DISTINCT vd.device_id)                                          AS verified_this_year,
      SUM(CASE WHEN dv.status = 'active'   THEN 1 ELSE 0 END)              AS verified_and_active,
      SUM(CASE WHEN dv.status != 'active'  THEN 1 ELSE 0 END)              AS verified_no_longer_active
    FROM (
      SELECT DISTINCT device_id FROM verifications
      WHERE YEAR(verified_at) = YEAR(CURDATE())
    ) vd
    JOIN devices dv    ON dv.id  = vd.device_id
    JOIN facilities fv ON fv.id  = dv.facility_id
    WHERE ${zoneWhere.replace(/d\./g, "dv.").replace(/f\./g, "fv.")}`,
    zoneParams,
  );

  const [unverified] = await db.query(
    `
    SELECT d.id, d.serial_number, d.model, f.name AS facility, f.mfl_code
    FROM devices d
    JOIN facilities f ON f.id = d.facility_id
    WHERE d.id NOT IN (
      SELECT DISTINCT device_id FROM verifications
      WHERE YEAR(verified_at) = YEAR(CURDATE())
    )
    AND d.status = 'active'
    AND ${zoneWhere}
    ORDER BY d.created_at ASC
    LIMIT 5`,
    zoneParams,
  );

  const [recentVerifications] = await db.query(
    `
    SELECT v.*, d.serial_number, d.model, f.name AS facility, u.full_name AS verified_by_name
    FROM verifications v
    JOIN devices d ON d.id = v.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN users u ON u.id = v.verified_by
    WHERE ${zoneWhere}
    ORDER BY v.verified_at DESC LIMIT 5`,
    zoneParams,
  );

  return {
    ...stats,
    verified_this_year: verifiedCount.verified_this_year,
    verified_and_active: verifiedCount.verified_and_active,
    verified_no_longer_active: verifiedCount.verified_no_longer_active,
    unverified_count: Math.max(
      0,
      (parseInt(stats.active_devices) || 0) -
        (parseInt(verifiedCount.verified_and_active) || 0),
    ),
    unverified_this_year: unverified,
    recent_verifications: recentVerifications,
  };
};

const listSims = async ({ page = 1, limit = 20, search = "", user = null }) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const zoneConds = ["1=1"];
  const zoneParams = [];
  applyZone(user, zoneConds, zoneParams);

  const searchCond = search
    ? `AND (s.sim_serial LIKE ? OR s.phone_number LIKE ? OR s.network LIKE ?)`
    : "";
  const searchParams = search
    ? [`%${search}%`, `%${search}%`, `%${search}%`]
    : [];

  const [rows] = await db.query(
    `
    SELECT s.id, s.sim_serial, s.phone_number, s.network, s.created_at,
           d.id AS device_id, d.serial_number AS device_serial, d.model,
           f.id AS facility_id, f.name AS facility_name, f.mfl_code
    FROM sim_cards s
    LEFT JOIN devices d ON d.sim_card_id = s.id AND d.status != 'decommissioned'
    LEFT JOIN facilities f ON f.id = d.facility_id
    WHERE s.id IN (
      SELECT MIN(id) FROM sim_cards WHERE phone_number IS NOT NULL GROUP BY phone_number
      UNION SELECT id FROM sim_cards WHERE phone_number IS NULL
    )
    ${searchCond}
    AND (f.id IS NULL OR ${zoneConds.join(" AND ")})
    ORDER BY s.created_at DESC
    LIMIT ${lim} OFFSET ${off}`,
    [...searchParams, ...zoneParams],
  );

  const [[{ total }]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM sim_cards s
    LEFT JOIN devices d ON d.sim_card_id = s.id AND d.status != 'decommissioned'
    LEFT JOIN facilities f ON f.id = d.facility_id
    WHERE s.id IN (
      SELECT MIN(id) FROM sim_cards WHERE phone_number IS NOT NULL GROUP BY phone_number
      UNION SELECT id FROM sim_cards WHERE phone_number IS NULL
    )
    ${searchCond}
    AND (f.id IS NULL OR ${zoneConds.join(" AND ")})`,
    [...searchParams, ...zoneParams],
  );

  return { rows, total };
};

const updateSim = async (id, { simSerial, phoneNumber, network, pin, puk }) => {
  const sets = [],
    vals = [];
  if (simSerial !== undefined) {
    sets.push("sim_serial = ?");
    vals.push(simSerial);
  }
  if (phoneNumber !== undefined) {
    sets.push("phone_number = ?");
    vals.push(phoneNumber);
  }
  if (network !== undefined) {
    sets.push("network = ?");
    vals.push(network);
  }
  if (pin !== undefined) {
    sets.push("pin = ?");
    vals.push(encrypt(pin));
  }
  if (puk !== undefined) {
    sets.push("puk = ?");
    vals.push(encrypt(puk));
  }
  if (!sets.length) return;
  vals.push(parseInt(id));
  await db.query(`UPDATE sim_cards SET ${sets.join(", ")} WHERE id = ?`, vals);
};

const unlinkSim = async (simId) => {
  await db.query(
    `UPDATE devices SET sim_card_id = NULL, has_sim = 0 WHERE sim_card_id = ?`,
    [parseInt(simId)],
  );
};

const linkSim = async (simId, deviceId) => {
  await db.query(
    `UPDATE devices SET sim_card_id = NULL, has_sim = 0 WHERE sim_card_id = ?`,
    [parseInt(simId)],
  );
  await db.query(
    `UPDATE devices SET sim_card_id = ?, has_sim = 1 WHERE id = ?`,
    [parseInt(simId), parseInt(deviceId)],
  );
};

const exportSims = async (user = null) => {
  const zoneConds = ["1=1"];
  const zoneParams = [];
  applyZone(user, zoneConds, zoneParams);
  const [rows] = await db.query(
    `
    SELECT s.sim_serial, s.phone_number, s.network, s.created_at,
           d.serial_number AS device_serial, d.model,
           f.name AS facility_name, f.mfl_code
    FROM sim_cards s
    LEFT JOIN devices d ON d.sim_card_id = s.id
    LEFT JOIN facilities f ON f.id = d.facility_id
    WHERE s.id IN (
      SELECT MIN(id) FROM sim_cards WHERE phone_number IS NOT NULL GROUP BY phone_number
      UNION SELECT id FROM sim_cards WHERE phone_number IS NULL
    )
    AND (f.id IS NULL OR ${zoneConds.join(" AND ")})
    ORDER BY s.created_at DESC`,
    zoneParams,
  );
  return rows;
};

const listUnverified = async ({ page = 1, limit = 20, user = null } = {}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const zoneConds = ["d.status = 'active'"];
  const zoneParams = [];
  applyZone(user, zoneConds, zoneParams);
  const where = `WHERE ${zoneConds.join(" AND ")}
    AND d.id NOT IN (
      SELECT DISTINCT device_id FROM verifications WHERE YEAR(verified_at) = YEAR(CURDATE())
    )`;
  const [rows] = await db.query(
    `
    SELECT d.id, d.serial_number, d.model, d.status,
           f.name AS facility, f.mfl_code,
           sc.name AS sub_county, c.name AS county
    FROM devices d
    JOIN facilities f    ON f.id = d.facility_id
    JOIN counties c      ON c.id = f.county_id
    LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
    ${where}
    ORDER BY f.name ASC, d.serial_number ASC
    LIMIT ${lim} OFFSET ${off}`,
    zoneParams,
  );
  const [[{ total }]] = await db.query(
    `
    SELECT COUNT(*) AS total FROM devices d
    JOIN facilities f ON f.id = d.facility_id
    ${where}`,
    zoneParams,
  );
  return { rows, total };
};

module.exports = {
  list,
  getById,
  getBySerial,
  create,
  update,
  transfer,
  remove,
  getTransfers,
  getDashboardStats,
  listSims,
  updateSim,
  unlinkSim,
  linkSim,
  exportSims,
  listUnverified,
};
