const router = require("express").Router();
const { body, param } = require("express-validator");
const multer = require("multer");
const C = require("../controllers");
const { authenticate, isAdmin, isOfficer, validate } = require("../middleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Auth (public)
router.post(
  "/auth/login",
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
  validate,
  C.login,
);

// All routes below require authentication
router.use(authenticate);

router.get("/auth/me", C.me);
router.post(
  "/auth/register",
  isAdmin,
  body("fullName").trim().notEmpty(),
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/),
  body("roleId").optional().isInt({ min: 1, max: 3 }),
  validate,
  C.register,
);
router.post(
  "/auth/change-password",
  body("currentPassword").notEmpty(),
  body("newPassword").isLength({ min: 8 }),
  validate,
  C.changePassword,
);

// ── Users (admin only)
router.get("/users", isAdmin, C.listUsers);
router.patch("/users/:id", isAdmin, C.updateUser);
router.delete("/users/:id", isAdmin, C.deleteUser);

// ── Reference data (all authenticated)
router.get("/counties", C.getCounties);
router.get("/counties/:countyId/sub-counties", C.getSubCounties);
router.get("/affiliations", C.getAffiliations);
router.post(
  "/affiliations",
  isOfficer,
  body("name").trim().notEmpty(),
  validate,
  C.createAffiliation,
);

router.get("/facilities", C.listFacilities);
router.post(
  "/facilities",
  isOfficer,
  body("mflCode").trim().notEmpty(),
  body("name").trim().notEmpty(),
  body("countyId").isInt({ min: 1 }),
  validate,
  C.createFacility,
);
router.get("/facilities/:id", C.getFacility);
router.patch("/facilities/:id", isOfficer, C.updateFacility);
router.delete("/facilities/:id", isAdmin, C.deleteFacility);
router.post(
  "/facilities/import",
  isOfficer,
  upload.single("file"),
  C.importFacilities,
);

// ── Dashboard
router.get("/dashboard", C.dashboard);

// ── Devices
router.get("/devices", C.listDevices);
router.get("/devices/export", C.exportDevices);
router.get(
  "/devices/:id",
  param("id").isInt({ min: 1 }),
  validate,
  C.getDevice,
);

router.post(
  "/devices",
  isOfficer,
  body("serialNumber")
    .trim()
    .notEmpty()
    .withMessage("Serial number is required"),
  body("facilityId").isInt({ min: 1 }).withMessage("Facility is required"),
  body("affiliationId")
    .isInt({ min: 1 })
    .withMessage("Affiliation is required"),
  validate,
  C.createDevice,
);

router.post(
  "/devices/import",
  isOfficer,
  upload.single("file"),
  C.importDevices,
);

router.patch(
  "/devices/:id",
  isOfficer,
  param("id").isInt({ min: 1 }),
  validate,
  C.updateDevice,
);

router.post(
  "/devices/:id/transfer",
  isAdmin,
  param("id").isInt({ min: 1 }),
  body("toFacilityId")
    .isInt({ min: 1 })
    .withMessage("Target facility required"),
  validate,
  C.transferDevice,
);

router.delete(
  "/devices/:id",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.deleteDevice,
);

// ── Verifications
router.get("/verifications", C.listVerifications);
router.post(
  "/devices/:id/verify",
  isOfficer,
  param("id").isInt({ min: 1 }),
  body("devicePresent").isBoolean(),
  body("overallStatus").isIn(["pass", "fail", "partial"]),
  validate,
  C.verifyDevice,
);

// ── Audit log (admin only)
router.get("/audit-logs", isAdmin, C.listAuditLogs);

module.exports = router;
