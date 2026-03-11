const nodemailer = require("nodemailer");
const logger = require("./logger");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.office365.com",
  port: parseInt(process.env.MAIL_PORT || "587"),
  secure: false,
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  tls: { ciphers: "SSLv3", rejectUnauthorized: false },
});

// Verify SMTP connection on startup
if (process.env.MAIL_USER && process.env.MAIL_PASS) {
  transporter.verify((err) => {
    if (err) logger.error(`SMTP connection failed: ${err.message}`);
    else logger.info(`SMTP ready — ${process.env.MAIL_USER}`);
  });
}

const canSend = () => {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    logger.warn("Mail not configured — skipping email");
    return false;
  }
  return true;
};

const appUrl = () => process.env.CORS_ORIGIN || "https://your-app.vercel.app";

const header = `
  <tr>
    <td style="background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:28px 36px;text-align:center;">
      <div style="font-size:26px;margin-bottom:6px;">💊</div>
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">EMR Device Inventory</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:12px;">Device Management System</p>
    </td>
  </tr>`;

const footer = `
  <tr>
    <td style="padding:14px 36px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">EMR Device Inventory · Automated message, do not reply.</p>
    </td>
  </tr>`;

const wrap = (
  body,
) => `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f8f7ff;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:540px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
        ${header}${body}${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;

const row = (label, value) => `
  <tr>
    <td style="padding:5px 0;font-size:13px;color:#6b7280;width:160px;">${label}</td>
    <td style="padding:5px 0;font-size:13px;color:#111827;font-weight:600;">${value || "—"}</td>
  </tr>`;

// ── Welcome email ────────────────────────────────────────────────
const sendWelcomeEmail = async ({ fullName, email, password, role }) => {
  if (!canSend()) return;
  const roleLabel =
    {
      admin: "Administrator",
      field_officer: "Field Officer",
      viewer: "Viewer",
    }[role] || role;
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <p style="margin:0 0 14px;font-size:15px;color:#374151;">Hi <strong>${fullName}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
        Your account has been created on the EMR Device Inventory system.
      </p>
      <div style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Email", email)}
          ${row("Password", `<span style="font-family:monospace;">${password}</span>`)}
          ${row("Role", roleLabel)}
        </table>
      </div>
      <div style="text-align:center;margin-bottom:20px;">
        <a href="${appUrl()}/login" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;
           padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">Sign In →</a>
      </div>
      <p style="margin:0;font-size:13px;color:#9ca3af;">Please change your password after first login.</p>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: email,
      subject: "Your EMR Inventory Account Credentials",
      html,
    });
    logger.info(`Welcome email sent to ${email}`);
  } catch (e) {
    logger.error(`Welcome email failed: ${e.message}`);
  }
};

// ── Lost device alert (to all admins) ───────────────────────────
const sendLostDeviceAlert = async ({ device, report, admins }) => {
  if (!canSend()) return;
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;
                  padding:14px 18px;margin-bottom:22px;display:flex;align-items:center;">
        <span style="font-size:20px;margin-right:10px;">🚨</span>
        <div>
          <p style="margin:0;font-size:14px;font-weight:700;color:#991b1b;">Device Reported Lost</p>
          <p style="margin:2px 0 0;font-size:12px;color:#b91c1c;">Immediate review required</p>
        </div>
      </div>
      <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6;">
        A device has been marked as lost and requires your review.
      </p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;">Device Details</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Asset Tag", device.asset_tag)}
          ${row("Facility", device.facility_name)}
          ${row("Affiliation", device.affiliation_name)}
        </table>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;">Loss Report</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Date Lost", report.date_lost)}
          ${row("Reported By", report.reported_by_name)}
          ${row("Last Known Location", report.last_known_location)}
          ${row("Police Abstract", report.police_abstract)}
          ${row("Circumstances", report.circumstances)}
        </table>
      </div>
      ${
        report.incident_report_path || report.police_ob_path
          ? `
      <p style="margin:0 0 10px;font-size:13px;color:#374151;">
        📎 Supporting documents are attached to this email.
      </p>`
          : ""
      }
      <div style="text-align:center;">
        <a href="${appUrl()}/devices/${device.id}" style="display:inline-block;background:#dc2626;color:#fff;
           text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          Review Loss Report →
        </a>
      </div>
    </td></tr>`);

  // Build attachments from uploaded files
  const path = require("path");
  const fs = require("fs");
  const DOCS_DIR = path.join(__dirname, "../../uploads/loss-docs");
  const attachments = [];
  if (report.incident_report_path) {
    const fp = path.join(DOCS_DIR, report.incident_report_path);
    if (fs.existsSync(fp))
      attachments.push({
        filename: "incident-report.pdf",
        path: fp,
        contentType: "application/pdf",
      });
  }
  if (report.police_ob_path) {
    const fp = path.join(DOCS_DIR, report.police_ob_path);
    if (fs.existsSync(fp))
      attachments.push({
        filename: "police-ob.pdf",
        path: fp,
        contentType: "application/pdf",
      });
  }

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: admins.map((a) => a.email).join(", "),
      subject: `🚨 Device Lost: ${device.serial_number} — ${device.facility_name}`,
      html,
      attachments,
    });
    logger.info(`Lost device alert sent for device ${device.id}`);
  } catch (e) {
    logger.error(`Lost device alert failed: ${e.message}`);
  }
};

// ── Escalation alert (to selected user + all admins) ────────────
const sendEscalationAlert = async ({
  device,
  report,
  escalateTo,
  admins,
  escalatedBy,
}) => {
  if (!canSend()) return;
  const recipients = [
    escalateTo,
    ...admins.filter((a) => a.email !== escalateTo.email),
  ];
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;
                  padding:14px 18px;margin-bottom:22px;">
        <span style="font-size:20px;margin-right:10px;">⚠️</span>
        <div style="display:inline-block;vertical-align:top;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#92400e;">Loss Report Escalated</p>
          <p style="margin:2px 0 0;font-size:12px;color:#b45309;">Escalated by ${escalatedBy.full_name}</p>
        </div>
      </div>
      <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6;">
        A lost device report has been escalated and requires urgent follow-up.
      </p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;">Device Details</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Asset Tag", device.asset_tag)}
          ${row("Facility", device.facility_name)}
        </table>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;">Loss Report</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Date Lost", report.date_lost)}
          ${row("Reported By", report.reported_by_name)}
          ${row("Circumstances", report.circumstances)}
          ${row("Police Abstract", report.police_abstract)}
          ${row("Admin Notes", report.admin_notes)}
        </table>
      </div>
      <div style="text-align:center;">
        <a href="${appUrl()}/devices/${device.id}" style="display:inline-block;background:#d97706;color:#fff;
           text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          View Device →
        </a>
      </div>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.map((r) => r.email).join(", "),
      subject: `⚠️ Escalated: Lost Device ${device.serial_number} — ${device.facility_name}`,
      html,
    });
    logger.info(`Escalation alert sent for device ${device.id}`);
  } catch (e) {
    logger.error(`Escalation alert failed: ${e.message}`);
  }
};

module.exports = { sendWelcomeEmail, sendLostDeviceAlert, sendEscalationAlert };
