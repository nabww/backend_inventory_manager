const db = require("../config/db");

const list = async ({ search = "", includeInactive = false } = {}) => {
  const conds = includeInactive ? [] : ["is_active = 1"];
  const params = [];
  if (search) {
    conds.push("(name LIKE ? OR email LIKE ? OR cadre LIKE ?)");
    const l = `%${search}%`;
    params.push(l, l, l);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT * FROM admin_contacts ${where} ORDER BY name ASC`,
    params,
  );
  return rows;
};

const getCadres = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT cadre FROM admin_contacts WHERE cadre IS NOT NULL AND cadre != '' ORDER BY cadre ASC`,
  );
  return rows.map((r) => r.cadre);
};

const create = async ({ name, email, cadre, createdBy }) => {
  const [r] = await db.query(
    `INSERT INTO admin_contacts (name, email, cadre, created_by) VALUES (?, ?, ?, ?)`,
    [name.trim(), email.trim().toLowerCase(), cadre || null, createdBy],
  );
  return r.insertId;
};

const update = async (id, { name, email, cadre, isActive }) => {
  const sets = [],
    vals = [];
  if (name !== undefined) {
    sets.push("name = ?");
    vals.push(name.trim());
  }
  if (email !== undefined) {
    sets.push("email = ?");
    vals.push(email.trim().toLowerCase());
  }
  if (cadre !== undefined) {
    sets.push("cadre = ?");
    vals.push(cadre || null);
  }
  if (isActive !== undefined) {
    sets.push("is_active = ?");
    vals.push(isActive ? 1 : 0);
  }
  if (!sets.length) return;
  vals.push(parseInt(id));
  await db.query(
    `UPDATE admin_contacts SET ${sets.join(", ")} WHERE id = ?`,
    vals,
  );
};

const remove = async (id) => {
  await db.query(`DELETE FROM admin_contacts WHERE id = ?`, [parseInt(id)]);
};

const getByIds = async (ids = []) => {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT * FROM admin_contacts WHERE id IN (?)`,
    [ids],
  );
  return rows;
};

module.exports = { list, getCadres, create, update, remove, getByIds };
