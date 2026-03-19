const router = require("express").Router();
const { body, param } = require("express-validator");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const C = require("../controllers");
const { authenticate, isAdmin, isOfficer, validate } = require("../middleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Disk storage for loss report documents (PDFs)
const DOCS_DIR = path.join(__dirname, "../../uploads/loss-docs");
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const lossDocStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOCS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `device-${req.params.id}-${file.fieldname}-${Date.now()}${ext}`;
    cb(null, name);
  },
});
const uploadLossDocs = multer({
  storage: lossDocStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") return cb(null, true);
    cb(new Error("Only PDF files are accepted"));
  },
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
router.post("/users/:id/resend-welcome", isAdmin, C.resendWelcome);

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
router.get("/devices/unverified", C.listUnverified);
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
  body("overallStatus").isIn(["pass", "fail", "partial", "lost"]),
  validate,
  C.verifyDevice,
);

// ── Loss reports
router.get("/users/escalation-targets", isOfficer, C.getEscalationUsers);
router.post(
  "/devices/:id/report-lost",
  isOfficer,
  uploadLossDocs.fields([
    { name: "incidentReport", maxCount: 1 },
    { name: "policeOb", maxCount: 1 },
  ]),
  param("id").isInt({ min: 1 }),
  body("dateLost").notEmpty().withMessage("Date lost is required"),
  body("circumstances")
    .trim()
    .notEmpty()
    .withMessage("Circumstances are required"),
  body("reportedByName")
    .trim()
    .notEmpty()
    .withMessage("Reporter name is required"),
  validate,
  C.reportLost,
);

router.get("/devices/:id/loss-documents/:type", isOfficer, C.getLossDocument);

router.post(
  "/devices/:id/review-loss",
  isAdmin,
  param("id").isInt({ min: 1 }),
  body("action")
    .isIn(["acknowledge", "reject", "insure", "escalate"])
    .withMessage("Invalid action"),
  validate,
  C.reviewLossReport,
);

router.post(
  "/devices/:id/recover",
  isAdmin,
  param("id").isInt({ min: 1 }),
  body("adminNotes")
    .trim()
    .notEmpty()
    .withMessage("Recovery reason is required"),
  validate,
  C.recoverDevice,
);

// ── Audit log (admin only)
router.get("/audit-logs", isAdmin, C.listAuditLogs);

// ── SIM Cards
router.get("/sims", isAdmin, C.listSims);
router.get("/sims/export", isAdmin, C.exportSims);
router.patch(
  "/sims/:id",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.updateSim,
);
router.post(
  "/sims/:id/link",
  isAdmin,
  param("id").isInt({ min: 1 }),
  body("deviceId").isInt({ min: 1 }),
  validate,
  C.linkSim,
);
router.post(
  "/sims/:id/unlink",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.unlinkSim,
);

// ── Admin Contacts
router.get("/admin-contacts", isAdmin, C.listAdminContacts);
router.get("/admin-contacts/cadres", isAdmin, C.listCadres);
router.post("/admin-contacts", isAdmin, C.createAdminContact);
router.patch(
  "/admin-contacts/:id",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.updateAdminContact,
);
router.delete(
  "/admin-contacts/:id",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.deleteAdminContact,
);

// ── Return Requests
router.post("/returns", isOfficer, C.createReturn);
router.get("/returns", isAdmin, C.listReturns);
router.get(
  "/returns/:id",
  authenticate,
  param("id").isInt({ min: 1 }),
  validate,
  C.getReturn,
);
router.post(
  "/returns/:id/review",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.reviewReturn,
);
router.post(
  "/returns/:id/reissue",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.reissueReturn,
);

// ── Repair Requests
router.post("/repairs", isOfficer, C.createRepair);
router.get("/repairs", isAdmin, C.listRepairs);
router.get(
  "/repairs/:id",
  authenticate,
  param("id").isInt({ min: 1 }),
  validate,
  C.getRepair,
);
router.post(
  "/repairs/:id/review",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.reviewRepair,
);
router.post(
  "/repairs/:id/mark-returned",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.markRepairReturned,
);
router.post(
  "/repairs/:id/reissue",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.reissueRepair,
);

// ── Transfer Requests (FO requests, admin reviews)
router.post("/transfer-requests", isOfficer, C.createTransferRequest);
router.get("/transfer-requests", isAdmin, C.listTransferRequests);
router.get(
  "/transfer-requests/:id",
  authenticate,
  param("id").isInt({ min: 1 }),
  validate,
  C.getTransferRequest,
);
router.post(
  "/transfer-requests/:id/review",
  isAdmin,
  param("id").isInt({ min: 1 }),
  validate,
  C.reviewTransferRequest,
);

module.exports = router;
