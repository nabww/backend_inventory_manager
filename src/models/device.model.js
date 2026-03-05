const db      = require('../config/db');
const { encrypt, decrypt } = require('../utils');

const BASE = `
  SELECT
    d.id, d.serial_number, d.imei, d.model, d.asset_tag, d.ip_address,
    d.cover_condition, d.cover_notes, d.date_issued, d.assigned_to,
    d.status, d.notes, d.has_sim, d.created_at, d.updated_at,
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
  return { ...row, pin: decrypt(row.pin_enc), puk: decrypt(row.puk_enc), pin_enc: undefined, puk_enc: undefined };
};

const list = async ({ page = 1, limit = 20, search = '', status = '', facilityId = '', affiliationId = '', countyId = '' }) => {
  const p   = parseInt(page)  || 1;
  const lim = parseInt(limit) || 20;
  const off = (p - 1) * lim;
  const conds  = ['1=1'];
  const params = [];

  if (search) {
    conds.push('(d.serial_number LIKE ? OR d.imei LIKE ? OR d.asset_tag LIKE ? OR d.model LIKE ? OR f.mfl_code LIKE ? OR f.name LIKE ? OR s.phone_number LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status)        { conds.push('d.status = ?');        params.push(status); }
  if (facilityId)    { conds.push('d.facility_id = ?');    params.push(parseInt(facilityId)); }
  if (affiliationId) { conds.push('d.affiliation_id = ?'); params.push(parseInt(affiliationId)); }
  if (countyId)      { conds.push('f.county_id = ?');      params.push(parseInt(countyId)); }

  const where = `WHERE ${conds.join(' AND ')}`;

  const [rows]      = await db.query(`${BASE} ${where} ORDER BY d.created_at DESC LIMIT ${lim} OFFSET ${off}`, params);
  const [[{total}]] = await db.query(
    `SELECT COUNT(*) AS total FROM devices d
     JOIN facilities f ON f.id = d.facility_id
     LEFT JOIN sim_cards s ON s.id = d.sim_card_id
     ${where}`, params);

  return { rows: rows.map(decryptSim), total };
};

const getById = async (id) => {
  const [[row]] = await db.query(`${BASE} WHERE d.id = ? LIMIT 1`, [parseInt(id)]);
  return decryptSim(row ?? null);
};

const getBySerial = async (serial) => {
  const [[row]] = await db.query(`${BASE} WHERE d.serial_number = ? LIMIT 1`, [serial]);
  return decryptSim(row ?? null);
};

/**
 * Create device — optionally creates SIM record in same transaction
 */
const create = async (fields, createdBy) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let simCardId = null;

    if (fields.hasSim && (fields.simSerial || fields.phoneNumber)) {
      const [sr] = await conn.query(
        `INSERT INTO sim_cards (sim_serial, phone_number, pin, puk, network) VALUES (?, ?, ?, ?, ?)`,
        [
          fields.simSerial   || null,
          fields.phoneNumber || null,
          fields.pin         ? encrypt(fields.pin) : null,
          fields.puk         ? encrypt(fields.puk) : null,
          fields.network     || null,
        ]
      );
      simCardId = sr.insertId;
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
        fields.imei          || null,
        fields.model         || null,
        fields.assetTag      || null,
        fields.ipAddress     || null,
        fields.coverCondition || 'good',
        fields.coverNotes    || null,
        fields.dateIssued    || null,
        fields.assignedTo    || null,
        fields.status        || 'active',
        fields.notes         || null,
        createdBy,
      ]
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

/**
 * Update device — updates or creates SIM in same transaction
 */
const update = async (id, fields, updatedBy) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Get current device
    const [[current]] = await conn.query(
      `SELECT sim_card_id, has_sim FROM devices WHERE id = ?`, [parseInt(id)]
    );

    // ── SIM handling
    if (fields.hasSim) {
      if (current.sim_card_id) {
        // Update existing SIM
        const simSets = [], simVals = [];
        const simMap  = { simSerial: 'sim_serial', phoneNumber: 'phone_number', network: 'network' };
        for (const [k, col] of Object.entries(simMap)) {
          if (fields[k] !== undefined) { simSets.push(`${col} = ?`); simVals.push(fields[k]); }
        }
        if (fields.pin !== undefined) { simSets.push('pin = ?'); simVals.push(encrypt(fields.pin)); }
        if (fields.puk !== undefined) { simSets.push('puk = ?'); simVals.push(encrypt(fields.puk)); }
        if (simSets.length) {
          simVals.push(current.sim_card_id);
          await conn.query(`UPDATE sim_cards SET ${simSets.join(', ')} WHERE id = ?`, simVals);
        }
      } else if (fields.simSerial || fields.phoneNumber) {
        // Create new SIM
        const [sr] = await conn.query(
          `INSERT INTO sim_cards (sim_serial, phone_number, pin, puk, network) VALUES (?, ?, ?, ?, ?)`,
          [fields.simSerial || null, fields.phoneNumber || null,
           fields.pin ? encrypt(fields.pin) : null,
           fields.puk ? encrypt(fields.puk) : null,
           fields.network || null]
        );
        await conn.query(`UPDATE devices SET sim_card_id = ? WHERE id = ?`, [sr.insertId, parseInt(id)]);
      }
    } else if (!fields.hasSim && current.sim_card_id) {
      // Toggle SIM off — unlink (keep SIM record for audit)
      await conn.query(`UPDATE devices SET sim_card_id = NULL WHERE id = ?`, [parseInt(id)]);
    }

    // ── Device fields
    const devSets = [], devVals = [];
    const devMap  = {
      facilityId:     'facility_id',
      affiliationId:  'affiliation_id',
      serialNumber:   'serial_number',
      imei:           'imei',
      model:          'model',
      assetTag:       'asset_tag',
      ipAddress:      'ip_address',
      coverCondition: 'cover_condition',
      coverNotes:     'cover_notes',
      dateIssued:     'date_issued',
      assignedTo:     'assigned_to',
      status:         'status',
      notes:          'notes',
    };
    for (const [k, col] of Object.entries(devMap)) {
      if (fields[k] !== undefined) { devSets.push(`${col} = ?`); devVals.push(fields[k] || null); }
    }
    if (fields.hasSim !== undefined) { devSets.push('has_sim = ?'); devVals.push(fields.hasSim ? 1 : 0); }
    devSets.push('updated_by = ?');
    devVals.push(updatedBy, parseInt(id));
    await conn.query(`UPDATE devices SET ${devSets.join(', ')} WHERE id = ?`, devVals);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

/**
 * Transfer device to another facility — updates + logs
 */
const transfer = async (id, toFacilityId, reason, userId) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[dev]] = await conn.query(`SELECT facility_id FROM devices WHERE id = ?`, [parseInt(id)]);
    await conn.query(`UPDATE devices SET facility_id = ?, updated_by = ? WHERE id = ?`,
      [parseInt(toFacilityId), userId, parseInt(id)]);
    await conn.query(
      `INSERT INTO facility_transfers (device_id, from_facility_id, to_facility_id, transferred_by, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [parseInt(id), dev.facility_id, parseInt(toFacilityId), userId, reason || null]
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

const remove = (id) => db.query(`DELETE FROM devices WHERE id = ?`, [parseInt(id)]);

const getTransfers = async (deviceId) => {
  const [rows] = await db.query(
    `SELECT ft.*, ff.name AS from_facility, ff.mfl_code AS from_mfl,
            tf.name AS to_facility, tf.mfl_code AS to_mfl,
            u.full_name AS transferred_by_name
     FROM facility_transfers ft
     JOIN facilities ff ON ff.id = ft.from_facility_id
     JOIN facilities tf ON tf.id = ft.to_facility_id
     JOIN users u ON u.id = ft.transferred_by
     WHERE ft.device_id = ? ORDER BY ft.transferred_at DESC`, [parseInt(deviceId)]
  );
  return rows;
};

const getDashboardStats = async () => {
  const [[stats]] = await db.query(`
    SELECT
      COUNT(*)                                AS total_devices,
      SUM(d.status = 'active')                AS active_devices,
      SUM(d.has_sim = 1)                      AS devices_with_sim,
      SUM(d.has_sim = 0)                      AS wifi_only,
      SUM(d.cover_condition != 'good')        AS cover_issues,
      SUM(d.status = 'lost')                  AS lost_devices,
      SUM(d.status = 'under_repair')          AS under_repair
    FROM devices d`);

  const [unverified] = await db.query(`
    SELECT d.id, d.serial_number, d.model, f.name AS facility, f.mfl_code
    FROM devices d
    JOIN facilities f ON f.id = d.facility_id
    WHERE d.id NOT IN (
      SELECT DISTINCT device_id FROM verifications
      WHERE YEAR(verified_at) = YEAR(CURDATE())
    )
    AND d.status = 'active'
    ORDER BY d.created_at ASC
    LIMIT 5`);

  const [recentVerifications] = await db.query(`
    SELECT v.*, d.serial_number, d.model, f.name AS facility, u.full_name AS verified_by_name
    FROM verifications v
    JOIN devices d ON d.id = v.device_id
    JOIN facilities f ON f.id = d.facility_id
    JOIN users u ON u.id = v.verified_by
    ORDER BY v.verified_at DESC LIMIT 5`);

  return { ...stats, unverified_this_year: unverified, recent_verifications: recentVerifications };
};

module.exports = { list, getById, getBySerial, create, update, transfer, remove, getTransfers, getDashboardStats };
