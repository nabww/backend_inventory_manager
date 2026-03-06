const bcrypt = require("bcryptjs");
const xlsx = require("xlsx");
const User = require("../models/user.model");
const Device = require("../models/device.model");
const Verify = require("../models/verification.model");
const Ref = require("../models/reference.model");
const Audit = require("../models/audit.model");
const { signToken, R } = require("../utils");

// ================================================================
// AUTH
// ================================================================
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return R.unauth(res, "Invalid credentials");
    await User.updateLastLogin(user.id);
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    await Audit.write({
      userId: user.id,
      action: "LOGIN",
      entityType: "user",
      entityId: user.id,
      req,
    });
    return R.ok(res, {
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e) {
    next(e);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return R.unauth(res, "User not found");
    return R.ok(res, user);
  } catch (e) {
    next(e);
  }
};

const register = async (req, res, next) => {
  try {
    const { fullName, email, password, roleId } = req.body;
    if (await User.findByEmail(email))
      return R.badRequest(res, "Email already registered");
    const passwordHash = await bcrypt.hash(password, 12);
    const id = await User.create({
      roleId: roleId || 1,
      fullName,
      email,
      passwordHash,
    });
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "user",
      entityId: id,
      newValues: { fullName, email, roleId },
      req,
    });
    return R.created(res, { id }, "User created");
  } catch (e) {
    next(e);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findByEmail(req.user.email);
    if (!(await bcrypt.compare(currentPassword, user.password_hash)))
      return R.badRequest(res, "Current password is incorrect");
    await User.update(req.user.id, {
      passwordHash: await bcrypt.hash(newPassword, 12),
    });
    return R.ok(res, null, "Password changed");
  } catch (e) {
    next(e);
  }
};

// ================================================================
// USERS
// ================================================================
const listUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const result = await User.list({ page, limit, search });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page) || 1,
      parseInt(limit) || 20,
    );
  } catch (e) {
    next(e);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const user = await User.findById(id);
    if (!user) return R.notFound(res, "User not found");
    await User.update(id, req.body);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "user",
      entityId: id,
      oldValues: user,
      newValues: req.body,
      req,
    });
    return R.ok(res, await User.findById(id), "User updated");
  } catch (e) {
    next(e);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.user.id)
      return R.badRequest(res, "Cannot deactivate your own account");
    await User.deactivate(id);
    await Audit.write({
      userId: req.user.id,
      action: "DELETE",
      entityType: "user",
      entityId: id,
      req,
    });
    return R.ok(res, null, "User deactivated");
  } catch (e) {
    next(e);
  }
};

// ================================================================
// REFERENCE DATA
// ================================================================
const getCounties = async (req, res, next) => {
  try {
    return R.ok(res, await Ref.getCounties());
  } catch (e) {
    next(e);
  }
};
const getSubCounties = async (req, res, next) => {
  try {
    return R.ok(res, await Ref.getSubCounties(req.params.countyId));
  } catch (e) {
    next(e);
  }
};
const getAffiliations = async (req, res, next) => {
  try {
    return R.ok(res, await Ref.getAffiliations());
  } catch (e) {
    next(e);
  }
};

const createAffiliation = async (req, res, next) => {
  try {
    const { name, shortCode } = req.body;
    if (!name?.trim()) return R.badRequest(res, "Affiliation name is required");
    const id = await Ref.createAffiliation(name, shortCode, req.user.id);
    return R.created(
      res,
      { id, name: name.trim(), shortCode },
      "Affiliation created",
    );
  } catch (e) {
    next(e);
  }
};

const listFacilities = async (req, res, next) => {
  try {
    const { search = "", countyId = "", page = 1, limit = 50 } = req.query;
    const result = await Ref.getFacilities({ search, countyId, page, limit });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page) || 1,
      parseInt(limit) || 50,
    );
  } catch (e) {
    next(e);
  }
};

const createFacility = async (req, res, next) => {
  try {
    const { mflCode, name, countyId, subCountyId } = req.body;
    const id = await Ref.createFacility({
      mflCode,
      name,
      countyId,
      subCountyId,
    });
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "facility",
      entityId: id,
      newValues: req.body,
      req,
    });
    return R.created(res, { id }, "Facility created");
  } catch (e) {
    next(e);
  }
};

const updateFacility = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await Ref.updateFacility(id, req.body);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "facility",
      entityId: id,
      newValues: req.body,
      req,
    });
    return R.ok(res, null, "Facility updated");
  } catch (e) {
    next(e);
  }
};

const deleteFacility = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const fac = await Ref.getFacilityById(id);
    if (!fac) return R.notFound(res, "Facility not found");
    await Ref.deleteFacility(id);
    await Audit.write({
      userId: req.user.id,
      action: "DELETE",
      entityType: "facility",
      entityId: id,
      oldValues: fac,
      req,
    });
    return R.ok(res, null, "Facility deleted");
  } catch (e) {
    if (e.message.includes("Cannot delete")) return R.err(res, e.message, 409);
    next(e);
  }
};

const importFacilities = async (req, res, next) => {
  try {
    if (!req.file) return R.err(res, "No file uploaded", 400);
    const wb = xlsx.read(req.file.buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const results = await Ref.importFacilities(rows);
    await Audit.write({
      userId: req.user.id,
      action: "IMPORT",
      entityType: "facility",
      entityId: 0,
      newValues: results,
      req,
    });
    return R.ok(
      res,
      results,
      `Imported ${results.imported}, skipped ${results.skipped}`,
    );
  } catch (e) {
    next(e);
  }
};

// ================================================================
// DEVICES
// ================================================================
const dashboard = async (req, res, next) => {
  try {
    return R.ok(res, await Device.getDashboardStats());
  } catch (e) {
    next(e);
  }
};

const listDevices = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      status = "",
      facilityId = "",
      affiliationId = "",
      countyId = "",
    } = req.query;
    const result = await Device.list({
      page,
      limit,
      search,
      status,
      facilityId,
      affiliationId,
      countyId,
    });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page) || 1,
      parseInt(limit) || 20,
    );
  } catch (e) {
    next(e);
  }
};

const getDevice = async (req, res, next) => {
  try {
    const device = await Device.getById(parseInt(req.params.id));
    if (!device) return R.notFound(res, "Device not found");
    const [verifications, transfers] = await Promise.all([
      Verify.getByDevice(device.id),
      Device.getTransfers(device.id),
    ]);
    return R.ok(res, {
      ...device,
      verifications: verifications.rows,
      transfers,
    });
  } catch (e) {
    next(e);
  }
};

const createDevice = async (req, res, next) => {
  try {
    const id = await Device.create(req.body, req.user.id);
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "device",
      entityId: id,
      newValues: req.body,
      req,
    });
    return R.created(res, await Device.getById(id), "Device created");
  } catch (e) {
    next(e);
  }
};

const updateDevice = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await Device.getById(id);
    if (!existing) return R.notFound(res, "Device not found");
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "device",
      entityId: id,
      oldValues: existing,
      newValues: req.body,
      req,
    });
    await Device.update(id, req.body, req.user.id);
    return R.ok(res, await Device.getById(id), "Device updated");
  } catch (e) {
    next(e);
  }
};

const transferDevice = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { toFacilityId, reason } = req.body;
    if (!toFacilityId) return R.badRequest(res, "Target facility is required");
    const fromFacilityId = await Device.transfer(
      id,
      toFacilityId,
      reason,
      req.user.id,
    );
    await Audit.write({
      userId: req.user.id,
      action: "TRANSFER",
      entityType: "device",
      entityId: id,
      oldValues: { facilityId: fromFacilityId },
      newValues: { facilityId: toFacilityId, reason },
      req,
    });
    return R.ok(res, null, "Device transferred");
  } catch (e) {
    next(e);
  }
};

const deleteDevice = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await Device.getById(id);
    if (!existing) return R.notFound(res, "Device not found");
    await Audit.write({
      userId: req.user.id,
      action: "DELETE",
      entityType: "device",
      entityId: id,
      oldValues: existing,
      req,
    });
    await Device.remove(id);
    return R.ok(res, null, "Device deleted");
  } catch (e) {
    next(e);
  }
};

const exportDevices = async (req, res, next) => {
  try {
    const { rows } = await Device.list({ page: 1, limit: 10000, ...req.query });
    const data = rows.map((d) => ({
      "Serial Number": d.serial_number,
      IMEI: d.imei ?? "",
      Model: d.model ?? "",
      "Asset Tag": d.asset_tag ?? "",
      "IP Address": d.ip_address ?? "",
      "Cover Condition": d.cover_condition,
      "Has SIM": d.has_sim ? "Yes" : "No",
      "Phone Number": d.phone_number ?? "",
      "SIM Serial": d.sim_serial ?? "",
      Network: d.network ?? "",
      Facility: d.facility_name,
      "MFL Code": d.mfl_code,
      County: d.county,
      "Sub-County": d.sub_county ?? "",
      Affiliation: d.affiliation,
      "Assigned To": d.assigned_to ?? "",
      "Date Issued": d.date_issued ?? "",
      Status: d.status,
      "Last Verified": d.last_verified_at ?? "",
      Verification: d.last_verification_status ?? "",
    }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(data), "Devices");
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    await Audit.write({
      userId: req.user.id,
      action: "EXPORT",
      entityType: "device",
      entityId: 0,
      req,
    });
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="devices_export.xlsx"',
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return res.send(buf);
  } catch (e) {
    next(e);
  }
};

const importDevices = async (req, res, next) => {
  try {
    if (!req.file) return R.err(res, "No file uploaded", 400);
    const db = require("../config/db");
    const wb = xlsx.read(req.file.buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const results = { imported: 0, skipped: 0, errors: [] };

    // Cache lookups to avoid repeated queries
    const facilityCache = {};
    const affiliationCache = {};

    for (const [i, row] of rows.entries()) {
      try {
        const serial = String(row["Serial Number"] || "").trim();
        const mflCode = String(row["MFL Code"] || "").trim();
        const affName = String(row["Affiliation"] || "").trim();

        if (!serial || !mflCode || !affName) {
          results.errors.push({
            row: i + 2,
            error: "Serial Number, MFL Code and Affiliation are required",
          });
          continue;
        }

        // Skip duplicates
        if (await Device.getBySerial(serial)) {
          results.skipped++;
          continue;
        }

        // Resolve facility
        if (!facilityCache[mflCode]) {
          const [[fac]] = await db.query(
            `SELECT id FROM facilities WHERE mfl_code = ? LIMIT 1`,
            [mflCode],
          );
          if (!fac) {
            results.errors.push({
              row: i + 2,
              error: `Facility not found: ${mflCode}`,
            });
            continue;
          }
          facilityCache[mflCode] = fac.id;
        }

        // Resolve affiliation — create if not exists
        if (!affiliationCache[affName]) {
          const [[aff]] = await db.query(
            `SELECT id FROM affiliations WHERE LOWER(name) = LOWER(?) LIMIT 1`,
            [affName],
          );
          if (aff) {
            affiliationCache[affName] = aff.id;
          } else {
            const [r] = await db.query(
              `INSERT INTO affiliations (name, created_by) VALUES (?, ?)`,
              [affName, req.user.id],
            );
            affiliationCache[affName] = r.insertId;
          }
        }

        const hasSim = String(row["Has SIM"] || "").toLowerCase() === "yes";

        await Device.create(
          {
            serialNumber: serial,
            facilityId: facilityCache[mflCode],
            affiliationId: affiliationCache[affName],
            imei: row["IMEI"] || null,
            model: row["Model"] || null,
            assetTag: row["Asset Tag"] || null,
            ipAddress: row["IP Address"] || null,
            coverCondition: row["Cover Condition"] || "good",
            dateIssued: row["Date Issued"] || null,
            assignedTo: row["Assigned To"] || null,
            status: row["Status"] || "active",
            hasSim,
            simSerial: hasSim ? row["SIM Serial"] || null : null,
            phoneNumber: hasSim ? row["Phone Number"] || null : null,
            network: hasSim ? row["Network"] || null : null,
            pin: hasSim ? row["PIN"] || null : null,
            puk: hasSim ? row["PUK"] || null : null,
          },
          req.user.id,
        );

        results.imported++;
      } catch (e) {
        results.errors.push({ row: i + 2, error: e.message });
      }
    }

    await Audit.write({
      userId: req.user.id,
      action: "IMPORT",
      entityType: "device",
      entityId: 0,
      newValues: results,
      req,
    });
    return R.ok(
      res,
      results,
      `Imported ${results.imported}, skipped ${results.skipped}`,
    );
  } catch (e) {
    next(e);
  }
};

// ================================================================
// VERIFICATIONS
// ================================================================
const verifyDevice = async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");
    const id = await Verify.create({
      deviceId,
      verifiedBy: req.user.id,
      ...req.body,
    });
    await Audit.write({
      userId: req.user.id,
      action: "VERIFY",
      entityType: "device",
      entityId: deviceId,
      newValues: req.body,
      req,
    });
    return R.created(res, { id }, "Verification recorded");
  } catch (e) {
    next(e);
  }
};

const listVerifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, year = "" } = req.query;
    const result = await Verify.listAll({ page, limit, year });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page) || 1,
      parseInt(limit) || 20,
    );
  } catch (e) {
    next(e);
  }
};

const listAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = "", action = "" } = req.query;
    const result = await Audit.list({ page, limit, search, action });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page) || 1,
      parseInt(limit) || 20,
    );
  } catch (e) {
    next(e);
  }
};

module.exports = {
  login,
  me,
  register,
  changePassword,
  listUsers,
  updateUser,
  deleteUser,
  getCounties,
  getSubCounties,
  getAffiliations,
  createAffiliation,
  listFacilities,
  createFacility,
  updateFacility,
  deleteFacility,
  importFacilities,
  dashboard,
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  transferDevice,
  deleteDevice,
  exportDevices,
  importDevices,
  verifyDevice,
  listVerifications,
  listAuditLogs,
};
