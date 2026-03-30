const db = require("../config/db");

// Shared zone filter for facilities
const applyZone = (user, conds, params) => {
  if (!user || user.role === "admin" || user.zone_type === "all") return;
  if (user.zone_type === "facility") {
    conds.push(
      "f.id IN (SELECT facility_id FROM user_facilities WHERE user_id = ?)",
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

// ── Counties / Sub-counties ───────────────────────────────────────────────────
const getCounties = async () => {
  const [rows] = await db.query(
    `SELECT id, code, name FROM counties ORDER BY name ASC`,
  );
  return rows;
};

const getSubCounties = async (countyId) => {
  const [rows] = await db.query(
    `SELECT id, name FROM sub_counties WHERE county_id = ? ORDER BY name ASC`,
    [parseInt(countyId)],
  );
  return rows;
};

// ── Affiliations ──────────────────────────────────────────────────────────────
const getAffiliations = async () => {
  const [rows] = await db.query(
    `SELECT id, name, short_code FROM affiliations ORDER BY name ASC`,
  );
  return rows;
};

const createAffiliation = async (name, shortCode, createdBy) => {
  const [r] = await db.query(
    `INSERT INTO affiliations (name, short_code, created_by) VALUES (?, ?, ?)`,
    [name.trim(), shortCode || null, createdBy],
  );
  return r.insertId;
};

// ── Facilities ────────────────────────────────────────────────────────────────
const getFacilities = async ({
  search = "",
  countyId = "",
  page = 1,
  limit = 50,
  user = null,
} = {}) => {
  const p = parseInt(page) || 1;
  const lim = parseInt(limit) || 50;
  const off = (p - 1) * lim;

  const conds = ["1=1"];
  const params = [];

  applyZone(user, conds, params);

  if (search) {
    conds.push("(f.name LIKE ? OR f.mfl_code LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like);
  }
  if (countyId) {
    conds.push("f.county_id = ?");
    params.push(parseInt(countyId));
  }

  const where = `WHERE ${conds.join(" AND ")}`;

  const [rows] = await db.query(
    `
    SELECT f.id, f.mfl_code, f.name,
           c.id AS county_id, c.name AS county_name,
           sc.id AS sub_county_id, sc.name AS sub_county_name
    FROM facilities f
    JOIN counties c ON c.id = f.county_id
    LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
    ${where}
    ORDER BY f.name ASC
    LIMIT ${lim} OFFSET ${off}`,
    params,
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM facilities f ${where}`,
    params,
  );

  return { rows, total };
};

const getFacilityById = async (id) => {
  const [[row]] = await db.query(
    `
    SELECT f.*, c.name AS county_name, sc.name AS sub_county_name
    FROM facilities f
    JOIN counties c ON c.id = f.county_id
    LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
    WHERE f.id = ? LIMIT 1`,
    [parseInt(id)],
  );
  return row ?? null;
};

const createFacility = async ({ mflCode, name, countyId, subCountyId }) => {
  const [r] = await db.query(
    `INSERT INTO facilities (mfl_code, name, county_id, sub_county_id) VALUES (?, ?, ?, ?)`,
    [
      mflCode.trim(),
      name.trim(),
      parseInt(countyId),
      subCountyId ? parseInt(subCountyId) : null,
    ],
  );
  return r.insertId;
};

const updateFacility = async (id, { mflCode, name, countyId, subCountyId }) => {
  await db.query(
    `UPDATE facilities SET mfl_code = ?, name = ?, county_id = ?, sub_county_id = ? WHERE id = ?`,
    [mflCode, name, parseInt(countyId), subCountyId || null, parseInt(id)],
  );
};

const deleteFacility = async (id) => {
  await db.query(`DELETE FROM facilities WHERE id = ?`, [parseInt(id)]);
};

const importFacilities = async (rows) => {
  const results = { imported: 0, skipped: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    try {
      const mflCode = String(row["MFL Code"] || "").trim();
      const name = String(row["Facility Name"] || "").trim();
      const county = String(row["County"] || "").trim();
      const subCty = String(
        row["Sub County"] || row["Sub-County"] || "",
      ).trim();

      if (!mflCode || !name || !county) {
        results.errors.push({
          row: i + 2,
          error: "MFL Code, Facility Name and County are required",
        });
        results.skipped++;
        continue;
      }

      // Resolve county
      const [[cRow]] = await db.query(
        `SELECT id FROM counties WHERE LOWER(name) = LOWER(?) LIMIT 1`,
        [county],
      );
      if (!cRow) {
        results.errors.push({
          row: i + 2,
          error: `County not found: ${county}`,
        });
        results.skipped++;
        continue;
      }

      // Resolve sub-county (optional)
      let subCountyId = null;
      if (subCty) {
        const [[scRow]] = await db.query(
          `SELECT id FROM sub_counties WHERE county_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
          [cRow.id, subCty],
        );
        if (scRow) subCountyId = scRow.id;
      }

      // Upsert by MFL code
      const [[existing]] = await db.query(
        `SELECT id FROM facilities WHERE mfl_code = ? LIMIT 1`,
        [mflCode],
      );
      if (existing) {
        await db.query(
          `UPDATE facilities SET name = ?, county_id = ?, sub_county_id = ? WHERE id = ?`,
          [name, cRow.id, subCountyId, existing.id],
        );
      } else {
        await db.query(
          `INSERT INTO facilities (mfl_code, name, county_id, sub_county_id) VALUES (?, ?, ?, ?)`,
          [mflCode, name, cRow.id, subCountyId],
        );
      }
      results.imported++;
    } catch (e) {
      results.errors.push({ row: i + 2, error: e.message });
      results.skipped++;
    }
  }
  return results;
};

module.exports = {
  getCounties,
  getSubCounties,
  getAffiliations,
  createAffiliation,
  getFacilities,
  getFacilityById,
  createFacility,
  updateFacility,
  deleteFacility,
  importFacilities,
};
