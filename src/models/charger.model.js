const db = require("../config/db");

// Get charger types list
const getTypes = async () => {
  const [rows] = await db.query(
    "SELECT id, name FROM charger_types ORDER BY id",
  );
  return rows;
};

// Get facility charger counts (both types)
const getFacilityChargers = async (facilityId) => {
  const [rows] = await db.query(
    `SELECT ct.id AS charger_type_id, ct.name AS charger_type, COALESCE(fc.count, 0) AS count
     FROM charger_types ct
     LEFT JOIN facility_chargers fc ON fc.charger_type_id = ct.id AND fc.facility_id = ?
     ORDER BY ct.id`,
    [parseInt(facilityId)],
  );
  return rows;
};

// Update facility charger counts (batch upsert)
const updateFacilityChargers = async (facilityId, counts, userId) => {
  // counts is object: { 1: count_typeA, 2: count_typeC }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const [chargerTypeId, count] of Object.entries(counts)) {
      await conn.query(
        `INSERT INTO facility_chargers (facility_id, charger_type_id, count, updated_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           count = VALUES(count),
           updated_by = VALUES(updated_by)`,
        [facilityId, parseInt(chargerTypeId), parseInt(count) || 0, userId],
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getTypes,
  getFacilityChargers,
  updateFacilityChargers,
};
