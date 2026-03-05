const db = require('../config/db');

// ── Counties
const getCounties = async () => {
  const [rows] = await db.query(`SELECT id, code, name FROM counties ORDER BY name`);
  return rows;
};

// ── Sub-counties by county
const getSubCounties = async (countyId) => {
  const [rows] = await db.query(
    `SELECT id, name FROM sub_counties WHERE county_id = ? ORDER BY name`, [parseInt(countyId)]
  );
  return rows;
};

// ── Affiliations — self-growing
const getAffiliations = async () => {
  const [rows] = await db.query(`SELECT id, name, short_code FROM affiliations ORDER BY name`);
  return rows;
};

const createAffiliation = async (name, shortCode, userId) => {
  const [r] = await db.query(
    `INSERT INTO affiliations (name, short_code, created_by) VALUES (?, ?, ?)`,
    [name.trim(), shortCode?.trim() || null, userId]
  );
  return r.insertId;
};

// ── Facilities
const getFacilities = async ({ search = '', countyId = '', page = 1, limit = 50 }) => {
  const p   = parseInt(page)  || 1;
  const lim = parseInt(limit) || 50;
  const off = (p - 1) * lim;
  const conds = ['1=1'];
  const params = [];
  if (search)   { conds.push('(f.mfl_code LIKE ? OR f.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (countyId) { conds.push('f.county_id = ?'); params.push(parseInt(countyId)); }
  const where = `WHERE ${conds.join(' AND ')}`;
  const [rows] = await db.query(
    `SELECT f.*, c.name AS county_name, sc.name AS sub_county_name
     FROM facilities f
     JOIN counties c ON c.id = f.county_id
     LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
     ${where} ORDER BY f.name LIMIT ${lim} OFFSET ${off}`, params);
  const [[{total}]] = await db.query(`SELECT COUNT(*) AS total FROM facilities f ${where}`, params);
  return { rows, total };
};

const getFacilityById = async (id) => {
  const [[row]] = await db.query(
    `SELECT f.*, c.name AS county_name, sc.name AS sub_county_name
     FROM facilities f
     JOIN counties c ON c.id = f.county_id
     LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
     WHERE f.id = ? LIMIT 1`, [parseInt(id)]);
  return row ?? null;
};

const createFacility = async ({ mflCode, name, countyId, subCountyId }) => {
  const [r] = await db.query(
    `INSERT INTO facilities (mfl_code, name, county_id, sub_county_id) VALUES (?, ?, ?, ?)`,
    [mflCode.trim(), name.trim(), parseInt(countyId), subCountyId ? parseInt(subCountyId) : null]
  );
  return r.insertId;
};

const updateFacility = async (id, { mflCode, name, countyId, subCountyId }) => {
  await db.query(
    `UPDATE facilities SET mfl_code = ?, name = ?, county_id = ?, sub_county_id = ? WHERE id = ?`,
    [mflCode, name, parseInt(countyId), subCountyId ? parseInt(subCountyId) : null, parseInt(id)]
  );
};




const deleteFacility = async (id) => {
  // Check if any devices are still assigned
  const [[{count}]] = await db.query(
    'SELECT COUNT(*) AS count FROM devices WHERE facility_id = ?', [parseInt(id)]);
  if (count > 0) throw new Error('Cannot delete facility with active devices. Reassign or remove devices first.');
  await db.query('DELETE FROM facilities WHERE id = ?', [parseInt(id)]);
};

const importFacilities = async (rows) => {
  const results = { imported: 0, skipped: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    try {
      const mflCode = String(row['MFL Code'] || row['mfl_code'] || '').trim();
      const name    = String(row['Facility Name'] || row['name'] || '').trim();
      const county  = String(row['County'] || row['county'] || '').trim();
      const sub     = String(row['Sub County'] || row['Sub-County'] || row['sub_county'] || '').trim();

      if (!mflCode || !name || !county) { results.skipped++; continue; }

      // Resolve county
      const [[countyRow]] = await db.query(
        `SELECT id FROM counties WHERE LOWER(name) = LOWER(?) LIMIT 1`, [county]);
      if (!countyRow) { results.errors.push({ row: i+2, error: `County not found: ${county}` }); continue; }

      // Resolve sub-county (optional)
      let subCountyId = null;
      if (sub) {
        const [[subRow]] = await db.query(
          `SELECT id FROM sub_counties WHERE county_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
          [countyRow.id, sub]);
        if (subRow) subCountyId = subRow.id;
      }

      // Skip if MFL code already exists
      const [[existing]] = await db.query(
        `SELECT id FROM facilities WHERE mfl_code = ? LIMIT 1`, [mflCode]);
      if (existing) { results.skipped++; continue; }

      await db.query(
        `INSERT INTO facilities (mfl_code, name, county_id, sub_county_id) VALUES (?, ?, ?, ?)`,
        [mflCode, name, countyRow.id, subCountyId]);
      results.imported++;
    } catch (e) {
      results.errors.push({ row: i+2, error: e.message });
    }
  }
  return results;
};

module.exports = {
  getCounties, getSubCounties,
  getAffiliations, createAffiliation,
  getFacilities, getFacilityById, createFacility, updateFacility, deleteFacility,
  importFacilities,
};
