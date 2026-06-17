// controllers/index.js (full file with audit added)

const bcrypt = require("bcryptjs");
const xlsx = require("xlsx");
const User = require("../models/user.model");
const Device = require("../models/device.model");
const Verify = require("../models/verification.model");
const Ref = require("../models/reference.model");
const Audit = require("../models/audit.model");
const { signToken, R } = require("../utils");
const {
  sendWelcomeEmail,
  sendLostDeviceAlert,
  sendEscalationAlert,
  sendReturnRequestedEmail,
  sendReturnReviewedEmail,
  sendReissueEmail,
  sendRepairInitiatedEmail,
  sendRepairReturnedEmail,
  sendTransferRequestedEmail,
  sendTransferReviewedEmail,
} = require("../config/mailer");
const Loss = require("../models/loss.model");
const logger = require("../config/logger");
const deviceModel = require("../models/device.model");
const db = require("../config/db");
const chargerModel = require("../models/charger.model");

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
    const {
      fullName,
      email,
      password,
      roleId,
      zoneType,
      zoneCountyId,
      subCountyIds,
      facilityIds,
    } = req.body;
    if (await User.findByEmail(email))
      return R.badRequest(res, "Email already registered");

    // Only super admin (id=1) can create admins or assign zones
    const isSuperAdmin = req.user.id === 1;
    if (!isSuperAdmin && parseInt(roleId) === 3)
      return R.forbidden(
        res,
        "Only the super admin can create administrator accounts",
      );
    const effectiveZoneType = isSuperAdmin ? zoneType : zoneType || "all";
    const effectiveZoneCountyId = isSuperAdmin ? zoneCountyId : null;
    const effectiveSubCountyIds = isSuperAdmin ? subCountyIds || [] : [];
    const effectiveFacilityIds = isSuperAdmin ? facilityIds || [] : [];

    const passwordHash = await bcrypt.hash(password, 12);
    const id = await User.create({
      roleId: roleId || 1,
      fullName,
      email,
      passwordHash,
      zoneType: effectiveZoneType,
      zoneCountyId: effectiveZoneCountyId,
      subCountyIds: effectiveSubCountyIds,
      facilityIds: effectiveFacilityIds,
    });
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "user",
      entityId: id,
      newValues: { fullName, email, roleId, zoneType: effectiveZoneType },
      req,
    });
    const roleMap = { 1: "viewer", 2: "field_officer", 3: "admin" };
    sendWelcomeEmail({ fullName, email, password, role: roleMap[roleId || 1] });
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
    const isSuperAdmin = req.user.id === 1;
    const user = await User.findById(id);
    if (!user) return R.notFound(res, "User not found");

    // Non-super-admins cannot edit their own zone/role
    if (
      !isSuperAdmin &&
      id === req.user.id &&
      (req.body.zoneType || req.body.roleId)
    ) {
      return R.forbidden(res, "You cannot change your own zone or role");
    }
    // Non-super-admins cannot assign admin role
    if (!isSuperAdmin && parseInt(req.body.roleId) === 3) {
      return R.forbidden(
        res,
        "Only the super admin can assign the administrator role",
      );
    }
    // Non-super-admins cannot change zone assignments
    if (!isSuperAdmin) {
      delete req.body.zoneType;
      delete req.body.zoneCountyId;
      delete req.body.subCountyIds;
      delete req.body.facilityIds;
    }

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
    if (id === 1)
      return R.forbidden(res, "Cannot deactivate the super admin account");
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

const resendWelcome = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const user = await User.findById(id);
    if (!user) return R.notFound(res, "User not found");

    // Generate a new random password
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!";
    const newPassword = Array.from(
      { length: 10 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await User.update(id, { passwordHash });

    const roleMap = { 1: "viewer", 2: "field_officer", 3: "admin" };
    await sendWelcomeEmail({
      fullName: user.full_name,
      email: user.email,
      password: newPassword,
      role: roleMap[user.role_id] || "viewer",
    });

    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "user",
      entityId: id,
      newValues: { action: "resend_welcome" },
      req,
    });
    return R.ok(res, null, "Welcome email resent with new password");
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

const getFacility = async (req, res, next) => {
  try {
    const fac = await Ref.getFacilityById(parseInt(req.params.id));
    if (!fac) return R.notFound(res, "Facility not found");

    // Zone check for non-admins
    const user = req.user;
    if (user.id !== 1 && user.zone_type !== "all") {
      const db = require("../config/db");
      if (user.zone_type === "facility") {
        const [rows] = await db.query(
          `SELECT facility_id FROM user_facilities WHERE user_id = ?`,
          [user.id],
        );
        const allowed = rows.map((r) => r.facility_id);
        if (!allowed.includes(fac.id))
          return R.forbidden(res, "Access denied to this facility");
      } else if (user.zone_type === "sub_county") {
        const [rows] = await db.query(
          `SELECT sub_county_id FROM user_sub_counties WHERE user_id = ?`,
          [user.id],
        );
        const allowed = rows.map((r) => r.sub_county_id);
        if (!allowed.includes(fac.sub_county_id))
          return R.forbidden(res, "Access denied to this facility");
      } else if (
        user.zone_type === "county" &&
        fac.county_id !== user.zone_county_id
      ) {
        return R.forbidden(res, "Access denied to this facility");
      }
    }

    return R.ok(res, fac);
  } catch (e) {
    next(e);
  }
};

const listFacilities = async (req, res, next) => {
  try {
    const { search = "", countyId = "", page = 1, limit = 50 } = req.query;
    const result = await Ref.getFacilities({
      search,
      countyId,
      page,
      limit,
      user: req.user,
    });
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
    const old = await Ref.getFacilityById(id);
    await Ref.updateFacility(id, req.body);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "facility",
      entityId: id,
      oldValues: old,
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
    return R.ok(res, await Device.getDashboardStats(req.user));
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
      hasSim = "",
      coverCondition = "",
    } = req.query;
    const result = await Device.list({
      page,
      limit,
      search,
      status,
      facilityId,
      affiliationId,
      countyId,
      hasSim,
      coverCondition,
      user: req.user,
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
    const [verifications, transfers, lossReport] = await Promise.all([
      Verify.getByDevice(device.id),
      Device.getTransfers(device.id),
      Loss.getByDevice(device.id),
    ]);
    return R.ok(res, {
      ...device,
      verifications: verifications.rows,
      transfers,
      lossReport: lossReport || null,
    });
  } catch (e) {
    next(e);
  }
};

const createDevice = async (req, res, next) => {
  try {
    const id = await Device.create(req.body, req.user.id);
    const device = await Device.getById(id);
    // Auto-verify on enrolment using actual device values
    await Verify.create({
      deviceId: id,
      verifiedBy: req.user.id,
      overallStatus: "pass",
      sdpId: req.body.sdpId,
      devicePresent: true,
      simPaired: !!device.has_sim,
      coverOk: ["good", "replaced"].includes(device.cover_condition),
      powersOn: true,
      emrWorking: true,
      notes: "Auto-verified on enrolment",
    });
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "device",
      entityId: id,
      newValues: req.body,
      req,
    });
    return R.created(res, device, "Device created");
  } catch (e) {
    next(e);
  }
};

const updateDevice = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await Device.getById(id);
    if (!existing) return R.notFound(res, "Device not found");
    if (existing.locked && req.user.role !== "admin")
      return R.forbidden(
        res,
        "Device is locked pending loss review. Contact an administrator.",
      );
    // Capture relevant fields for audit
    const oldSnapshot = {
      sdp_id: existing.sdp_id,
      has_charger: existing.has_charger,
      charger_type_id: existing.charger_type_id,
      status: existing.status,
      facility_id: existing.facility_id,
      assigned_to: existing.assigned_to,
    };
    const newSnapshot = {
      sdp_id: req.body.sdpId,
      has_charger: req.body.hasCharger,
      charger_type_id: req.body.chargerTypeId,
      status: req.body.status,
      facility_id: req.body.facilityId,
      assigned_to: req.body.assignedTo,
    };
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "device",
      entityId: id,
      oldValues: oldSnapshot,
      newValues: newSnapshot,
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
    const { rows } = await Device.list({
      page: 1,
      limit: 10000,
      ...req.query,
      user: req.user,
    });
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

        const newId = await Device.create(
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

        // Auto-verify on import using actual device values
        const coverCondition = row["Cover Condition"] || "good";
        await Verify.create({
          deviceId: newId,
          verifiedBy: req.user.id,
          overallStatus: "pass",
          devicePresent: true,
          simPaired: hasSim,
          coverOk: ["good", "replaced"].includes(coverCondition.toLowerCase()),
          powersOn: true,
          emrWorking: true,
          notes: "Auto-verified on import",
        });

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
    if (device.locked || device.status === "lost")
      return R.badRequest(res, "Cannot verify a lost device");
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
    const result = await Verify.listAll({ page, limit, year, user: req.user });
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

const listUnverified = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const p = parseInt(page) || 1;
    const lim = parseInt(limit) || 20;
    const off = (p - 1) * lim;
    const db = require("../config/db");

    const zoneConds = ["d.status = 'active'"];
    const zoneParams = [];
    const user = req.user;
    if (user.id !== 1 && user.zone_type !== "all") {
      if (user.zone_type === "facility") {
        zoneConds.push(
          "d.facility_id IN (SELECT facility_id FROM user_facilities WHERE user_id = ?)",
        );
        zoneParams.push(user.id);
      } else if (user.zone_type === "sub_county" && user.zone_sub_county_id) {
        zoneConds.push("f.sub_county_id = ?");
        zoneParams.push(user.zone_sub_county_id);
      } else if (user.zone_type === "county" && user.zone_county_id) {
        zoneConds.push("f.county_id = ?");
        zoneParams.push(user.zone_county_id);
      }
    }

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

    return R.paginated(res, rows, total, p, lim);
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

const getEscalationUsers = async (req, res, next) => {
  try {
    const users = await User.getByMinRole("field_officer");
    return R.ok(res, users);
  } catch (e) {
    next(e);
  }
};

// ================================================================
// LOSS REPORTS
// ================================================================

const reportLost = async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");
    if (device.status === "lost")
      return R.badRequest(res, "Device is already marked as lost");

    const {
      dateLost,
      circumstances,
      lastKnownLocation,
      reportedByName,
      policeAbstract,
    } = req.body;
    if (!dateLost || !circumstances || !reportedByName)
      return R.badRequest(
        res,
        "Date lost, circumstances and reporter name are required",
      );

    // Grab uploaded file paths if present
    const incidentReportPath = req.files?.incidentReport?.[0]?.filename || null;
    const policeObPath = req.files?.policeOb?.[0]?.filename || null;

    // Lock device and mark lost
    await Device.update(
      deviceId,
      { status: "lost", locked: true },
      req.user.id,
    );

    // Create loss report
    const reportId = await Loss.create({
      deviceId,
      reportedBy: req.user.id,
      dateLost,
      circumstances,
      lastKnownLocation,
      reportedByName,
      policeAbstract,
      incidentReportPath,
      policeObPath,
    });

    // Fire alert to all admins (non-blocking)
    // const admins = await User.getByRole("admin");
    const admins = await User.getAdminsByFacility(device.facility_id);
    const fullDevice = await Device.getById(deviceId);
    const report = await Loss.getByDevice(deviceId);
    sendLostDeviceAlert({ device: fullDevice, report, admins }).catch(() => {});

    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "device",
      entityId: deviceId,
      newValues: { status: "lost", reportId },
      req,
    });

    return R.created(
      res,
      { reportId },
      "Device marked as lost and report submitted",
    );
  } catch (e) {
    next(e);
  }
};

const getLossDocument = async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const { type } = req.params; // 'incident' or 'police'
    const download = req.query.download === "1";

    const report = await Loss.getByDevice(deviceId);
    if (!report) return R.notFound(res, "No loss report found");

    const filename =
      type === "incident"
        ? report.incident_report_path
        : type === "police"
          ? report.police_ob_path
          : null;
    if (!filename) return R.notFound(res, "No document uploaded for this type");

    const filePath = require("path").join(
      __dirname,
      "../../uploads/loss-docs",
      filename,
    );
    if (!require("fs").existsSync(filePath))
      return R.notFound(res, "File not found on server");

    const friendlyName =
      type === "incident" ? "incident-report.pdf" : "police-ob.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${friendlyName}"`,
    );
    require("fs").createReadStream(filePath).pipe(res);
  } catch (e) {
    next(e);
  }
};

const reviewLossReport = async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");

    const report = await Loss.getByDevice(deviceId);
    if (!report) return R.notFound(res, "No loss report found for this device");

    const { action, adminNotes, escalateToUserIds } = req.body;
    const validActions = ["acknowledge", "reject", "insure", "escalate"];
    if (!validActions.includes(action))
      return R.badRequest(res, "Invalid action");

    // Capture audit before changes
    await Audit.write({
      userId: req.user.id,
      action: "LOSS_REVIEW",
      entityType: "device_loss_reports",
      entityId: report.id,
      newValues: { action, adminNotes, escalateToUserIds },
      req,
    });

    if (action === "escalate") {
      if (!escalateToUserIds || !escalateToUserIds.length)
        return R.badRequest(res, "Select at least one user to escalate to");
      const escalateToUsers = await Promise.all(
        escalateToUserIds.map((id) => User.findById(id)),
      );
      const validTargets = escalateToUsers.filter(Boolean);
      if (!validTargets.length)
        return R.notFound(res, "No valid escalation targets found");
      // const admins = await User.getByRole("admin");
      const admins = await User.getAdminsByFacility(device.facility_id);
      const escalatedBy = await User.findById(req.user.id);
      // Send to each target (deduped against admins list)
      const allRecipients = [
        ...validTargets,
        ...admins.filter((a) => !validTargets.find((t) => t.id === a.id)),
      ];
      sendEscalationAlert({
        device,
        report,
        recipients: allRecipients,
        escalatedBy,
      }).catch(() => {});
      await Loss.review(report.id, {
        status: "escalated",
        adminNotes,
        reviewedBy: req.user.id,
      });
      return R.ok(res, null, "Report escalated");
    }

    if (action === "reject") {
      if (!adminNotes)
        return R.badRequest(
          res,
          "A reason is required when rejecting a loss report",
        );
      // Unlock and restore device to active
      await Device.update(
        deviceId,
        { status: "active", locked: false },
        req.user.id,
      );
      await Loss.review(report.id, {
        status: "rejected",
        adminNotes,
        reviewedBy: req.user.id,
      });
      return R.ok(res, null, "Device restored to active");
    }

    // acknowledge or insure — keep device locked as lost
    const status = action === "insure" ? "acknowledged" : "acknowledged";
    await Loss.review(report.id, {
      status,
      adminNotes,
      reviewedBy: req.user.id,
    });
    return R.ok(res, null, "Loss report updated");
  } catch (e) {
    next(e);
  }
};

const recoverDevice = async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");
    if (device.status !== "lost")
      return R.badRequest(res, "Device is not marked as lost");

    const { adminNotes } = req.body;
    if (!adminNotes)
      return R.badRequest(res, "A reason/note is required to recover a device");

    await Device.update(
      deviceId,
      { status: "active", locked: false },
      req.user.id,
    );

    const report = await Loss.getByDevice(deviceId);
    if (report)
      await Loss.recover(report.id, { adminNotes, reviewedBy: req.user.id });

    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "device",
      entityId: deviceId,
      newValues: { status: "active", recoveryNote: adminNotes },
      req,
    });

    return R.ok(res, null, "Device recovered and unlocked");
  } catch (e) {
    next(e);
  }
};

// ================================================================
// SIM CARDS
// ================================================================
const listSims = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const result = await Device.listSims({
      page,
      limit,
      search,
      user: req.user,
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

const updateSim = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await Device.updateSim(id, req.body);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "sim_card",
      entityId: id,
      newValues: req.body,
      req,
    });
    return R.ok(res, null, "SIM updated");
  } catch (e) {
    next(e);
  }
};

const linkSim = async (req, res, next) => {
  try {
    const simId = parseInt(req.params.id);
    const deviceId = parseInt(req.body.deviceId);
    if (!deviceId) return R.badRequest(res, "deviceId is required");
    await Device.linkSim(simId, deviceId);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "sim_card",
      entityId: simId,
      newValues: { linkedTo: deviceId },
      req,
    });
    return R.ok(res, null, "SIM linked to device");
  } catch (e) {
    next(e);
  }
};

const unlinkSim = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await Device.unlinkSim(id);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "sim_card",
      entityId: id,
      newValues: { unlinked: true },
      req,
    });
    return R.ok(res, null, "SIM unlinked");
  } catch (e) {
    next(e);
  }
};

const exportSims = async (req, res, next) => {
  try {
    const rows = await Device.exportSims(req.user);
    const wb = xlsx.utils.book_new();
    const data = rows.map((r) => ({
      "SIM Serial": r.sim_serial || "",
      "Phone Number": r.phone_number || "",
      Network: r.network || "",
      "Device Serial": r.device_serial || "Unlinked",
      Model: r.model || "",
      Facility: r.facility_name || "",
      "MFL Code": r.mfl_code || "",
      "Created At": r.created_at
        ? new Date(r.created_at).toISOString().split("T")[0]
        : "",
    }));
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(data),
      "SIM Cards",
    );
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sim_cards.xlsx"',
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buf);
  } catch (e) {
    next(e);
  }
};

// ================================================================
// ADMIN CONTACTS
// ================================================================
const AdminContact = require("../models/admin_contact.model");

const listAdminContacts = async (req, res, next) => {
  try {
    const { search = "", includeInactive = false } = req.query;
    const rows = await AdminContact.list({
      search,
      includeInactive: includeInactive === "true",
    });
    return R.ok(res, rows);
  } catch (e) {
    next(e);
  }
};

const listCadres = async (req, res, next) => {
  try {
    const cadres = await AdminContact.getCadres();
    return R.ok(res, cadres);
  } catch (e) {
    next(e);
  }
};

const createAdminContact = async (req, res, next) => {
  try {
    const { name, email, cadre } = req.body;
    if (!name || !email)
      return R.badRequest(res, "Name and email are required");
    const id = await AdminContact.create({
      name,
      email,
      cadre,
      createdBy: req.user.id,
    });
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "admin_contact",
      entityId: id,
      newValues: { name, email, cadre },
      req,
    });
    return R.created(res, { id }, "Admin contact created");
  } catch (e) {
    next(e);
  }
};

const updateAdminContact = async (req, res, next) => {
  try {
    await AdminContact.update(parseInt(req.params.id), req.body);
    return R.ok(res, null, "Admin contact updated");
  } catch (e) {
    next(e);
  }
};

const deleteAdminContact = async (req, res, next) => {
  try {
    await AdminContact.remove(parseInt(req.params.id));
    return R.ok(res, null, "Admin contact deleted");
  } catch (e) {
    next(e);
  }
};

// ================================================================
// RETURNS
// ================================================================
const Return = require("../models/return.model");

const createReturn = async (req, res, next) => {
  try {
    const { deviceId, reason, adminContactIds = [] } = req.body;
    if (!deviceId || !reason)
      return R.badRequest(res, "deviceId and reason are required");
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");
    const id = await Return.create({
      deviceId,
      requestedBy: req.user.id,
      reason,
    });
    // const admins = await User.getByRole("admin");
    const admins = await User.getAdminsByFacility(device.facility_id);
    const contacts = await AdminContact.getByIds(adminContactIds);
    const requestedBy = await User.findById(req.user.id);
    sendReturnRequestedEmail({
      device,
      reason,
      requestedBy,
      admins,
      contacts,
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "return_request",
      entityId: id,
      newValues: { deviceId, reason },
      req,
    });
    return R.created(res, { id }, "Return request submitted");
  } catch (e) {
    next(e);
  }
};

const listReturns = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "" } = req.query;
    const result = await Return.list({ page, limit, status });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page),
      parseInt(limit),
    );
  } catch (e) {
    next(e);
  }
};

const getReturn = async (req, res, next) => {
  try {
    const rr = await Return.getById(parseInt(req.params.id));
    if (!rr) return R.notFound(res, "Return request not found");
    return R.ok(res, rr);
  } catch (e) {
    next(e);
  }
};

const reviewReturn = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { status, adminNotes, storageLocation, receivedDate, receivedBy } =
      req.body;
    if (!["approved", "rejected"].includes(status))
      return R.badRequest(res, "Invalid status");
    const rr = await Return.getById(id);
    if (!rr) return R.notFound(res, "Return request not found");
    await Return.review(id, {
      status,
      adminNotes,
      reviewedBy: req.user.id,
      storageLocation,
      receivedDate,
      receivedBy,
    });
    const requestedByUser = await User.findById(rr.requested_by);
    sendReturnReviewedEmail({ rr, status, adminNotes, requestedByUser }).catch(
      () => {},
    );
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "return_request",
      entityId: id,
      newValues: { status, adminNotes },
      req,
    });
    return R.ok(res, null, `Return request ${status}`);
  } catch (e) {
    next(e);
  }
};

const reissueReturn = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { reissuedDate, reissuedToFacility } = req.body;
    if (!reissuedToFacility)
      return R.badRequest(res, "Destination facility is required");
    const rr = await Return.getById(id);
    if (!rr) return R.notFound(res, "Return request not found");
    const deviceId = await Return.reissue(id, {
      reissuedBy: req.user.id,
      reissuedDate,
      reissuedToFacility,
    });
    const device = await Device.getById(deviceId);
    const requestedByUser = await User.findById(rr.requested_by);
    const reissuedByUser = await User.findById(req.user.id);
    sendReissueEmail({
      device,
      requestedByUser,
      reissuedByUser,
      reissuedDate,
      type: "return",
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "return_request",
      entityId: id,
      newValues: { status: "reissued", reissuedToFacility },
      req,
    });
    return R.ok(res, null, "Device reissued to facility");
  } catch (e) {
    next(e);
  }
};

// ================================================================
// REPAIRS
// ================================================================
const Repair = require("../models/repair.model");

const createRepair = async (req, res, next) => {
  try {
    const {
      deviceId,
      failureCause,
      sentTo,
      sentDate,
      signedOffBy,
      adminContactIds = [],
    } = req.body;
    if (!deviceId || !failureCause)
      return R.badRequest(res, "deviceId and failureCause are required");
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");
    const id = await Repair.create({
      deviceId,
      initiatedBy: req.user.id,
      failureCause,
      sentTo,
      sentDate,
      signedOffBy,
    });
    // const admins = await User.getByRole("admin");
    const admins = await User.getAdminsByFacility(device.facility_id);
    const contacts = await AdminContact.getByIds(adminContactIds);
    const initiatedBy = await User.findById(req.user.id);
    sendRepairInitiatedEmail({
      device,
      failureCause,
      sentTo,
      sentDate,
      signedOffBy,
      initiatedBy,
      admins,
      contacts,
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "repair_request",
      entityId: id,
      newValues: { deviceId, failureCause },
      req,
    });
    return R.created(
      res,
      { id },
      "Repair request submitted for admin approval",
    );
  } catch (e) {
    next(e);
  }
};

const reviewRepair = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { status, adminNotes, sentTo, sentDate, signedOffBy } = req.body;
    if (!["under_repair", "rejected"].includes(status))
      return R.badRequest(res, "Invalid status");
    const rp = await Repair.getById(id);
    if (!rp) return R.notFound(res, "Repair request not found");
    await Repair.review(id, {
      status,
      adminNotes,
      reviewedBy: req.user.id,
      sentTo,
      sentDate,
      signedOffBy,
    });
    const initiatedByUser = await User.findById(rp.initiated_by);
    // Notify FO of decision
    sendReturnReviewedEmail({
      rr: { ...rp, device_id: rp.device_id },
      status: status === "under_repair" ? "approved" : "rejected",
      adminNotes,
      requestedByUser: initiatedByUser,
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "repair_request",
      entityId: id,
      newValues: { status, adminNotes },
      req,
    });
    return R.ok(
      res,
      null,
      `Repair request ${status === "under_repair" ? "approved" : "rejected"}`,
    );
  } catch (e) {
    next(e);
  }
};

const listRepairs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "" } = req.query;
    const result = await Repair.list({ page, limit, status });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page),
      parseInt(limit),
    );
  } catch (e) {
    next(e);
  }
};

const getRepair = async (req, res, next) => {
  try {
    const rp = await Repair.getById(parseInt(req.params.id));
    if (!rp) return R.notFound(res, "Repair request not found");
    return R.ok(res, rp);
  } catch (e) {
    next(e);
  }
};

const markRepairReturned = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const {
      returnedDate,
      returnCondition,
      adminNotes,
      adminContactIds = [],
    } = req.body;
    const rp = await Repair.getById(id);
    if (!rp) return R.notFound(res, "Repair request not found");
    const deviceId = await Repair.markReturned(id, {
      returnedDate,
      returnCondition,
      adminNotes,
    });
    const device = await Device.getById(deviceId);
    // const admins = await User.getByRole("admin");
    const admins = await User.getAdminsByFacility(device.facility_id);
    const contacts = await AdminContact.getByIds(adminContactIds);
    sendRepairReturnedEmail({
      device,
      rp,
      returnedDate,
      returnCondition,
      admins,
      contacts,
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "repair_request",
      entityId: id,
      newValues: { status: "repair_return_pending", returnedDate },
      req,
    });
    return R.ok(res, null, "Repair marked as returned from repair center");
  } catch (e) {
    next(e);
  }
};

const reissueRepair = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { reissuedDate, reissuedToFacility } = req.body;
    if (!reissuedToFacility)
      return R.badRequest(res, "Destination facility is required");
    const rp = await Repair.getById(id);
    if (!rp) return R.notFound(res, "Repair request not found");
    const deviceId = await Repair.reissue(id, {
      reissuedBy: req.user.id,
      reissuedDate,
      reissuedToFacility,
    });
    const device = await Device.getById(deviceId);
    const initiatedByUser = await User.findById(rp.initiated_by);
    const reissuedByUser = await User.findById(req.user.id);
    sendReissueEmail({
      device,
      requestedByUser: initiatedByUser,
      reissuedByUser,
      reissuedDate,
      type: "repair",
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "repair_request",
      entityId: id,
      newValues: { status: "reissued", reissuedToFacility },
      req,
    });
    return R.ok(res, null, "Device reissued to facility after repair");
  } catch (e) {
    next(e);
  }
};

// ================================================================
// TRANSFER REQUESTS
// ================================================================
const TransferReq = require("../models/transfer_request.model");

const createTransferRequest = async (req, res, next) => {
  try {
    const {
      deviceId,
      destinationFacilityId,
      reason,
      adminContactIds = [],
    } = req.body;
    if (!deviceId || !destinationFacilityId)
      return R.badRequest(
        res,
        "deviceId and destinationFacilityId are required",
      );
    const device = await Device.getById(deviceId);
    if (!device) return R.notFound(res, "Device not found");

    // Zone check — FO can only request transfers within their zone
    if (req.user.id !== 1 && req.user.role !== "viewer") {
      const destFac = await Ref.getFacilityById(destinationFacilityId);
      if (req.user.zone_type === "facility") {
        const db = require("../config/db");
        const [ufRows] = await db.query(
          `SELECT facility_id FROM user_facilities WHERE user_id = ?`,
          [req.user.id],
        );
        const allowed = ufRows.map((r) => r.facility_id);
        if (!allowed.includes(parseInt(destinationFacilityId)))
          return R.forbidden(res, "Destination facility is outside your zone");
      } else if (req.user.zone_type === "sub_county") {
        const db = require("../config/db");
        const [scRows] = await db.query(
          `SELECT sub_county_id FROM user_sub_counties WHERE user_id = ?`,
          [req.user.id],
        );
        const allowedScs = scRows.map((r) => r.sub_county_id);
        if (!allowedScs.includes(destFac?.sub_county_id))
          return R.forbidden(res, "Destination facility is outside your zone");
      } else if (
        req.user.zone_type === "county" &&
        destFac?.county_id !== req.user.zone_county_id
      ) {
        return R.forbidden(res, "Destination facility is outside your zone");
      }
    }

    const id = await TransferReq.create({
      deviceId,
      requestedBy: req.user.id,
      destinationFacilityId,
      reason,
    });
    // const admins = await User.getByRole("admin");
    const admins = await User.getAdminsByFacility(device.facility_id);
    const contacts = await AdminContact.getByIds(adminContactIds);
    const requestedBy = await User.findById(req.user.id);
    sendTransferRequestedEmail({
      device,
      reason,
      requestedBy,
      admins,
      contacts,
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "CREATE",
      entityType: "transfer_request",
      entityId: id,
      newValues: { deviceId, destinationFacilityId },
      req,
    });
    return R.created(res, { id }, "Transfer request submitted");
  } catch (e) {
    next(e);
  }
};

const listTransferRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "" } = req.query;
    const result = await TransferReq.list({ page, limit, status });
    return R.paginated(
      res,
      result.rows,
      result.total,
      parseInt(page),
      parseInt(limit),
    );
  } catch (e) {
    next(e);
  }
};

const getTransferRequest = async (req, res, next) => {
  try {
    const tr = await TransferReq.getById(parseInt(req.params.id));
    if (!tr) return R.notFound(res, "Transfer request not found");
    return R.ok(res, tr);
  } catch (e) {
    next(e);
  }
};

const reviewTransferRequest = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { status, adminNotes } = req.body;
    if (!["approved", "rejected"].includes(status))
      return R.badRequest(res, "Invalid status");
    const tr = await TransferReq.getById(id);
    if (!tr) return R.notFound(res, "Transfer request not found");
    await TransferReq.review(id, {
      status,
      adminNotes,
      reviewedBy: req.user.id,
    });
    const requestedByUser = await User.findById(tr.requested_by);
    sendTransferReviewedEmail({
      tr,
      status,
      adminNotes,
      requestedByUser,
    }).catch(() => {});
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "transfer_request",
      entityId: id,
      newValues: { status, adminNotes },
      req,
    });
    return R.ok(res, null, `Transfer request ${status}`);
  } catch (e) {
    next(e);
  }
};

// ================================================================
// SDP & CHARGER ADDITIONS (with audit)
// ================================================================

// GET /sdp
const getSDPs = async (req, res) => {
  try {
    const list = await deviceModel.getSDPList();
    return R.ok(res, list);
  } catch (err) {
    logger.error("getSDPs error", err);
    return R.err(res, "Failed to fetch service delivery points");
  }
};

// GET /facilities/:id/sdps – returns only active SDPs for a facility
const getFacilitySDPs = async (req, res) => {
  try {
    const facilityId = req.params.id;
    const sdps = await deviceModel.getFacilitySDPs(facilityId);
    return R.ok(res, sdps);
  } catch (err) {
    logger.error("getFacilitySDPs error", err);
    return R.err(res, "Failed to fetch facility SDPs");
  }
};

// GET /facilities/:id/all-sdps – returns all SDPs (active + inactive) for editing
const getAllFacilitySDPs = async (req, res) => {
  try {
    const facilityId = req.params.id;
    const sdps = await deviceModel.getAllFacilitySDPs(facilityId);
    return R.ok(res, sdps);
  } catch (err) {
    logger.error("getAllFacilitySDPs error", err);
    return R.err(res, "Failed to fetch facility SDPs");
  }
};

// PUT /facilities/:id/sdps – batch update SDPs for a facility (with audit)
const updateFacilitySDPs = async (req, res) => {
  try {
    const facilityId = parseInt(req.params.id);
    const { sdps } = req.body;
    if (!Array.isArray(sdps)) {
      return R.err(res, "sdps must be an array", 400);
    }
    const oldSdps = await deviceModel.getAllFacilitySDPs(facilityId);
    await deviceModel.updateFacilitySDPs(facilityId, sdps, req.user.id);
    const newSdps = await deviceModel.getAllFacilitySDPs(facilityId);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "facility_sdps",
      entityId: facilityId,
      oldValues: oldSdps,
      newValues: newSdps,
      req,
    });
    return R.ok(res, { message: "Facility SDPs updated" });
  } catch (err) {
    logger.error("updateFacilitySDPs error", err);
    return R.err(res, "Failed to update facility SDPs");
  }
};

// GET /facilities/:id/sdp-stats – aggregated device counts + provider counts
const getFacilitySDPStats = async (req, res) => {
  try {
    const facilityId = req.params.id;
    const stats = await deviceModel.getFacilitySDPStats(facilityId);
    return R.ok(res, stats);
  } catch (err) {
    logger.error("getFacilitySDPStats error", err);
    return R.err(res, "Failed to fetch SDP stats");
  }
};

// ================================================================
// SDP GAPS REPORT
// ================================================================
const getFacilitySDPGaps = async (req, res) => {
  try {
    const user = req.user;
    let zoneConds = [];
    let zoneParams = [];

    if (user && user.zone_type !== "all") {
      if (user.zone_type === "county" && user.zone_county_id) {
        zoneConds.push("f.county_id = ?");
        zoneParams.push(user.zone_county_id);
      } else if (user.zone_type === "sub_county") {
        const subIds =
          user.zone_sub_county_ids ||
          (user.zone_sub_county_id ? [user.zone_sub_county_id] : []);
        if (subIds.length) {
          const placeholders = subIds.map(() => "?").join(",");
          zoneConds.push(`f.sub_county_id IN (${placeholders})`);
          zoneParams.push(...subIds);
        } else {
          return R.ok(res, []);
        }
      } else if (user.zone_type === "facility") {
        const facIds =
          user.zone_facility_ids ||
          (user.zone_facility_id ? [user.zone_facility_id] : []);
        if (facIds.length) {
          const placeholders = facIds.map(() => "?").join(",");
          zoneConds.push(`f.id IN (${placeholders})`);
          zoneParams.push(...facIds);
        } else {
          return R.ok(res, []);
        }
      }
    }

    const whereClause = zoneConds.length
      ? ` AND ${zoneConds.join(" AND ")}`
      : "";

    const query = `
      SELECT 
        f.id AS facility_id,
        f.mfl_code,
        f.name AS facility_name,
        c.name AS county,
        sc.name AS sub_county,
        sdp.id AS sdp_id,
        sdp.name AS sdp_name,
        COALESCE(fs.provider_count, 0) AS provider_count,
        COUNT(d.id) AS device_count,
        CASE
          WHEN COALESCE(fs.provider_count, 0) = 0 AND COUNT(d.id) = 0 THEN 'inactive'
          WHEN COALESCE(fs.provider_count, 0) = 0 AND COUNT(d.id) > 0 THEN 'no_providers'
          WHEN COALESCE(fs.provider_count, 0) > 0 AND COUNT(d.id) < COALESCE(fs.provider_count, 0) THEN 'no_devices'
          WHEN COALESCE(fs.provider_count, 0) > 0 AND COUNT(d.id) >= COALESCE(fs.provider_count, 0) THEN 'ok'
          ELSE 'inactive'
        END AS gap_status
      FROM facilities f
      JOIN counties c ON c.id = f.county_id
      LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
      CROSS JOIN service_delivery_points sdp
      LEFT JOIN facility_sdps fs ON fs.facility_id = f.id AND fs.sdp_id = sdp.id
      LEFT JOIN devices d ON d.facility_id = f.id AND d.sdp_id = sdp.id 
        AND d.status NOT IN ('decommissioned', 'lost')
      WHERE 1=1 ${whereClause}
      GROUP BY f.id, sdp.id
      ORDER BY f.name, sdp.display_order
    `;

    const [rows] = await db.query(query, zoneParams);
    return R.ok(res, rows);
  } catch (err) {
    logger.error("getFacilitySDPGaps error", err);
    return R.ok(res, []);
  }
};

// ================================================================
// SDP MATRIX REPORT
// ================================================================
const getFacilitySDPMatrix = async (req, res) => {
  try {
    const user = req.user;
    let zoneConds = [];
    let zoneParams = [];

    if (user && user.zone_type !== "all") {
      if (user.zone_type === "county" && user.zone_county_id) {
        zoneConds.push("f.county_id = ?");
        zoneParams.push(user.zone_county_id);
      } else if (user.zone_type === "sub_county") {
        const subIds =
          user.zone_sub_county_ids ||
          (user.zone_sub_county_id ? [user.zone_sub_county_id] : []);
        if (subIds.length) {
          const placeholders = subIds.map(() => "?").join(",");
          zoneConds.push(`f.sub_county_id IN (${placeholders})`);
          zoneParams.push(...subIds);
        } else {
          return R.ok(res, { sdps: [], facilities: [] });
        }
      } else if (user.zone_type === "facility") {
        const facIds =
          user.zone_facility_ids ||
          (user.zone_facility_id ? [user.zone_facility_id] : []);
        if (facIds.length) {
          const placeholders = facIds.map(() => "?").join(",");
          zoneConds.push(`f.id IN (${placeholders})`);
          zoneParams.push(...facIds);
        } else {
          return R.ok(res, { sdps: [], facilities: [] });
        }
      }
    }

    const whereClause = zoneConds.length
      ? ` AND ${zoneConds.join(" AND ")}`
      : "";

    const [sdps] = await db.query(
      "SELECT id, name FROM service_delivery_points ORDER BY display_order, name",
    );

    const [rows] = await db.query(
      `
      SELECT 
        f.id AS facility_id,
        f.mfl_code,
        f.name AS facility_name,
        c.name AS county,
        sc.name AS sub_county,
        sdp.id AS sdp_id,
        COUNT(d.id) AS device_count,
        COALESCE(fs.provider_count, 0) AS provider_count
      FROM facilities f
      JOIN counties c ON c.id = f.county_id
      LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
      CROSS JOIN service_delivery_points sdp
      LEFT JOIN facility_sdps fs ON fs.facility_id = f.id AND fs.sdp_id = sdp.id
      LEFT JOIN devices d ON d.facility_id = f.id AND d.sdp_id = sdp.id 
        AND d.status NOT IN ('decommissioned', 'lost')
      WHERE 1=1 ${whereClause}
      GROUP BY f.id, sdp.id, fs.provider_count
      ORDER BY f.name, sdp.display_order
      `,
      zoneParams,
    );

    const facilitiesMap = new Map();
    for (const row of rows) {
      const key = row.facility_id;
      if (!facilitiesMap.has(key)) {
        facilitiesMap.set(key, {
          facility_id: row.facility_id,
          mfl_code: row.mfl_code,
          facility_name: row.facility_name,
          county: row.county,
          sub_county: row.sub_county,
          devices: {},
          providers: {},
        });
      }
      facilitiesMap.get(key).devices[row.sdp_id] = row.device_count;
      facilitiesMap.get(key).providers[row.sdp_id] = row.provider_count;
    }

    for (const facility of facilitiesMap.values()) {
      for (const sdp of sdps) {
        if (facility.devices[sdp.id] === undefined)
          facility.devices[sdp.id] = 0;
        if (facility.providers[sdp.id] === undefined)
          facility.providers[sdp.id] = 0;
      }
    }

    if (facilitiesMap.size === 0) {
      return R.ok(res, { sdps: [], facilities: [] });
    }

    return R.ok(res, {
      sdps: sdps.map((s) => ({ id: s.id, name: s.name })),
      facilities: Array.from(facilitiesMap.values()),
    });
  } catch (err) {
    logger.error("getFacilitySDPMatrix error", err);
    return R.ok(res, { sdps: [], facilities: [] });
  }
};

// ================================================================
// CHARGER TYPES AND FACILITY CHARGERS (with audit)
// ================================================================
const getChargerTypes = async (req, res) => {
  try {
    const types = await chargerModel.getTypes();
    return R.ok(res, types);
  } catch (err) {
    logger.error("getChargerTypes error", err);
    return R.err(res, "Failed to fetch charger types");
  }
};

const getFacilityChargers = async (req, res) => {
  try {
    const facilityId = req.params.id;
    const chargers = await chargerModel.getFacilityChargers(facilityId);
    return R.ok(res, chargers);
  } catch (err) {
    logger.error("getFacilityChargers error", err);
    return R.err(res, "Failed to fetch charger data");
  }
};

const updateFacilityChargers = async (req, res) => {
  try {
    const facilityId = parseInt(req.params.id);
    const { counts } = req.body;
    const user = req.user;

    if (!counts || typeof counts !== "object") {
      return R.err(res, "Invalid counts format", 400);
    }

    // Zone enforcement for admins (same logic as facility update)
    const isGlobalAdmin = user.role === "admin" && user.zone_type === "all";
    if (!isGlobalAdmin) {
      let hasAccess = false;
      if (user.zone_type === "county") {
        const [[facility]] = await db.query(
          "SELECT county_id FROM facilities WHERE id = ?",
          [facilityId],
        );
        if (facility && facility.county_id === user.zone_county_id)
          hasAccess = true;
      } else if (user.zone_type === "sub_county") {
        const [[facility]] = await db.query(
          "SELECT sub_county_id FROM facilities WHERE id = ?",
          [facilityId],
        );
        if (facility && facility.sub_county_id === user.zone_sub_county_id)
          hasAccess = true;
      } else if (user.zone_type === "facility") {
        if (user.zone_facility_id === facilityId) hasAccess = true;
      }
      if (!hasAccess) {
        return R.err(
          res,
          "You do not have permission to update chargers for this facility",
          403,
        );
      }
    }

    const oldChargers = await chargerModel.getFacilityChargers(facilityId);
    await chargerModel.updateFacilityChargers(facilityId, counts, user.id);
    const newChargers = await chargerModel.getFacilityChargers(facilityId);
    await Audit.write({
      userId: req.user.id,
      action: "UPDATE",
      entityType: "facility_chargers",
      entityId: facilityId,
      oldValues: oldChargers,
      newValues: newChargers,
      req,
    });
    return R.ok(res, { message: "Charger counts updated" });
  } catch (err) {
    logger.error("updateFacilityChargers error", err);
    return R.err(res, "Failed to update charger counts");
  }
};

// ================================================================
// CHARGER GAPS REPORT
// ================================================================
const getChargerGapsReport = async (req, res) => {
  try {
    const user = req.user;
    let zoneConds = [];
    let zoneParams = [];

    if (user && user.zone_type !== "all") {
      if (user.zone_type === "county" && user.zone_county_id) {
        zoneConds.push("f.county_id = ?");
        zoneParams.push(user.zone_county_id);
      } else if (user.zone_type === "sub_county") {
        const subIds =
          user.zone_sub_county_ids ||
          (user.zone_sub_county_id ? [user.zone_sub_county_id] : []);
        if (subIds.length) {
          const placeholders = subIds.map(() => "?").join(",");
          zoneConds.push(`f.sub_county_id IN (${placeholders})`);
          zoneParams.push(...subIds);
        } else {
          return R.ok(res, []);
        }
      } else if (user.zone_type === "facility") {
        const facIds =
          user.zone_facility_ids ||
          (user.zone_facility_id ? [user.zone_facility_id] : []);
        if (facIds.length) {
          const placeholders = facIds.map(() => "?").join(",");
          zoneConds.push(`f.id IN (${placeholders})`);
          zoneParams.push(...facIds);
        } else {
          return R.ok(res, []);
        }
      }
    }

    const whereClause = zoneConds.length
      ? ` WHERE ${zoneConds.join(" AND ")}`
      : "";

    const query = `
      SELECT 
        f.id AS facility_id,
        f.mfl_code,
        f.name AS facility_name,
        c.name AS county,
        sc.name AS sub_county,
        COALESCE(fc_typeA.count, 0) AS typeA_chargers_manual,
        COALESCE(fc_typeC.count, 0) AS typeC_chargers_manual,
        COUNT(CASE WHEN d.status NOT IN ('decommissioned','lost') AND d.has_charger = 1 
                   AND d.charger_type_id = 1 THEN 1 END) AS typeA_attached,
        COUNT(CASE WHEN d.status NOT IN ('decommissioned','lost') AND d.has_charger = 1 
                   AND d.charger_type_id = 2 THEN 1 END) AS typeC_attached,
        COUNT(CASE WHEN d.status NOT IN ('decommissioned','lost') 
                   AND d.charger_type_id = 1 THEN 1 END) AS typeA_devices_total,
        COUNT(CASE WHEN d.status NOT IN ('decommissioned','lost') 
                   AND d.charger_type_id = 2 THEN 1 END) AS typeC_devices_total
      FROM facilities f
      JOIN counties c ON c.id = f.county_id
      LEFT JOIN sub_counties sc ON sc.id = f.sub_county_id
      LEFT JOIN (
        SELECT facility_id, SUM(count) AS count FROM facility_chargers WHERE charger_type_id = 1 GROUP BY facility_id
      ) fc_typeA ON fc_typeA.facility_id = f.id
      LEFT JOIN (
        SELECT facility_id, SUM(count) AS count FROM facility_chargers WHERE charger_type_id = 2 GROUP BY facility_id
      ) fc_typeC ON fc_typeC.facility_id = f.id
      LEFT JOIN devices d ON d.facility_id = f.id
      ${whereClause}
      GROUP BY f.id
      ORDER BY f.name
    `;

    const [rows] = await db.query(query, zoneParams);
    return R.ok(res, rows);
  } catch (err) {
    logger.error("getChargerGapsReport error", err);
    return R.ok(res, []);
  }
};

const logReportExport = async (req, res) => {
  try {
    const { reportName } = req.body;
    if (!reportName) return R.err(res, "reportName required", 400);
    await Audit.write({
      userId: req.user.id,
      action: "EXPORT",
      entityType: "report",
      entityId: 0,
      newValues: { reportName },
      req,
    });
    return R.ok(res);
  } catch (err) {
    logger.error("logReportExport error", err);
    return R.err(res, "Failed to log export");
  }
};

// ================================================================
// EXPORTS
// ================================================================
module.exports = {
  login,
  me,
  register,
  changePassword,
  listUsers,
  updateUser,
  deleteUser,
  resendWelcome,
  getCounties,
  getSubCounties,
  getAffiliations,
  createAffiliation,
  getFacility,
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
  listUnverified,
  listAuditLogs,
  reportLost,
  reviewLossReport,
  recoverDevice,
  getEscalationUsers,
  getLossDocument,
  listSims,
  updateSim,
  linkSim,
  unlinkSim,
  exportSims,
  listAdminContacts,
  listCadres,
  createAdminContact,
  updateAdminContact,
  deleteAdminContact,
  createReturn,
  listReturns,
  getReturn,
  reviewReturn,
  reissueReturn,
  createRepair,
  listRepairs,
  getRepair,
  reviewRepair,
  markRepairReturned,
  reissueRepair,
  createTransferRequest,
  listTransferRequests,
  getTransferRequest,
  reviewTransferRequest,
  getSDPs,
  getFacilitySDPs,
  getAllFacilitySDPs,
  updateFacilitySDPs,
  getFacilitySDPStats,
  getFacilitySDPGaps,
  getFacilitySDPMatrix,
  getChargerTypes,
  getFacilityChargers,
  updateFacilityChargers,
  getChargerGapsReport,
  logReportExport,
};
