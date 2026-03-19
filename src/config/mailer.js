const nodemailer = require("nodemailer");
const logger = require("./logger");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.MAIL_PORT || "465"),
  secure: parseInt(process.env.MAIL_PORT || "465") === 465,
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  tls: { rejectUnauthorized: false },
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
      <div style="margin-bottom:8px;">
        <svg width="48" height="48" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;">
          <rect width="40" height="40" rx="10" fill="rgba(255,255,255,0.15)"/>
          <rect x="7" y="10" width="26" height="18" rx="3" fill="white" fill-opacity="0.15"/>
          <rect x="9" y="12" width="22" height="14" rx="2" fill="white" fill-opacity="0.9"/>
          <polyline points="11,19 14,19 16,15 18,23 20,17 22,21 24,19 29,19"
            stroke="#7c3aed" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <path d="M17 31 Q20 34 23 31" stroke="white" stroke-width="1.5" stroke-linecap="round" fill="none" fill-opacity="0.7"/>
        </svg>
      </div>
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
        Your account has been created on the EMR Device Inventory system. Below are your login credentials.
      </p>
      <div style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Email", email)}
          ${row("Password", `<span style="font-family:monospace;">${password}</span>`)}
          ${row("Role", roleLabel)}
        </table>
      </div>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.05em;">📱 Access on Tablet</p>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">
          Open your browser and go to:<br/>
          <a href="http://10.201.30.200:3000" style="color:#7c3aed;font-weight:700;font-family:monospace;">http://10.201.30.200:3000</a>
        </p>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:22px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.05em;">💻 Access on PC</p>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">
          You must be connected to the <strong>Sophos VPN</strong> before accessing the platform on a PC.
          Once connected, open your browser and go to:<br/>
          <a href="http://192.168.1.200:3000" style="color:#1e40af;font-weight:700;font-family:monospace;">http://192.168.1.200:3000</a>
        </p>
      </div>

      <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;">Please change your password after your first login.</p>
      <p style="margin:0;font-size:13px;color:#9ca3af;">If you have trouble logging in, contact your administrator to have your credentials reset.</p>
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
  recipients,
  escalatedBy,
}) => {
  if (!canSend()) return;
  const recipientNames = recipients.map((r) => r.full_name).join(", ");
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
      ${
        report.incident_report_path || report.police_ob_path
          ? `
      <p style="margin:16px 0 0;font-size:13px;color:#374151;">
        📎 Supporting documents are attached to this email.
      </p>`
          : ""
      }
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">
        This escalation was also sent to: <strong>${recipientNames}</strong>
      </p>
    </td></tr>`);
  try {
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
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.map((r) => r.email).join(", "),
      subject: `⚠️ Escalated: Lost Device ${device.serial_number} — ${device.facility_name}`,
      html,
      attachments,
    });
    logger.info(`Escalation alert sent for device ${device.id}`);
  } catch (e) {
    logger.error(`Escalation alert failed: ${e.message}`);
  }
};

// ── Helper: build recipient list (admins + selected contacts) ────
const buildRecipients = (admins = [], contacts = []) => {
  const all = [
    ...admins.map((a) => ({ name: a.full_name, email: a.email })),
    ...contacts.map((c) => ({ name: c.name, email: c.email })),
  ];
  // dedupe by email
  return [...new Map(all.map((r) => [r.email, r])).values()];
};

// ── Return requested ─────────────────────────────────────────────
const sendReturnRequestedEmail = async ({
  device,
  reason,
  requestedBy,
  admins,
  contacts,
}) => {
  if (!canSend()) return;
  const recipients = buildRecipients(admins, contacts);
  if (!recipients.length) return;
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#1e40af;">📦 Device Return Request</p>
        <p style="margin:4px 0 0;font-size:12px;color:#3b82f6;">Submitted by ${requestedBy.full_name}</p>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;">Device</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Facility", device.facility_name)}
          ${row("Requested By", requestedBy.full_name)}
        </table>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;">Reason for Return</p>
        <p style="margin:0;font-size:13px;color:#374151;">${reason}</p>
      </div>
      <div style="text-align:center;">
        <a href="${appUrl()}/returns" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">Review Request →</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">This notification was also sent to: <strong>${recipients.map((r) => r.name).join(", ")}</strong></p>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.map((r) => r.email).join(", "),
      subject: `📦 Return Request: ${device.serial_number} — ${device.facility_name}`,
      html,
    });
    logger.info(`Return request email sent for device ${device.id}`);
  } catch (e) {
    logger.error(`Return request email failed: ${e.message}`);
  }
};

// ── Return reviewed (approved/rejected) — sent to FO ─────────────
const sendReturnReviewedEmail = async ({
  rr,
  status,
  adminNotes,
  requestedByUser,
}) => {
  if (!canSend()) return;
  const approved = status === "approved";
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:${approved ? "#f0fdf4" : "#fef2f2"};border:1px solid ${approved ? "#bbf7d0" : "#fecaca"};border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:${approved ? "#166534" : "#991b1b"};">${approved ? "✅ Return Request Approved" : "❌ Return Request Rejected"}</p>
      </div>
      <p style="margin:0 0 18px;font-size:14px;color:#374151;">Hi <strong>${requestedByUser.full_name}</strong>, your return request for device <strong>${rr.serial_number}</strong> has been <strong>${status}</strong>.</p>
      ${
        adminNotes
          ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:18px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;">Admin Notes</p>
        <p style="margin:0;font-size:13px;color:#374151;">${adminNotes}</p>
      </div>`
          : ""
      }
      <a href="${appUrl()}/devices/${rr.device_id}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">View Device →</a>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: requestedByUser.email,
      subject: `Return Request ${approved ? "Approved" : "Rejected"}: ${rr.serial_number}`,
      html,
    });
  } catch (e) {
    logger.error(`Return reviewed email failed: ${e.message}`);
  }
};

// ── Reissue (return or repair) — sent to original requestor ──────
const sendReissueEmail = async ({
  device,
  requestedByUser,
  reissuedByUser,
  reissuedDate,
  type,
}) => {
  if (!canSend()) return;
  const label = type === "repair" ? "repaired" : "returned";
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#166534;">✅ Device Reissued to Field</p>
      </div>
      <p style="margin:0 0 18px;font-size:14px;color:#374151;">Hi <strong>${requestedByUser.full_name}</strong>, the ${label} device has been reissued back to the field.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Reissued To", device.facility_name)}
          ${row("Reissued By", reissuedByUser.full_name)}
          ${row("Date", reissuedDate || "Today")}
        </table>
      </div>
      <a href="${appUrl()}/devices/${device.id}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">View Device →</a>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: requestedByUser.email,
      subject: `Device Reissued: ${device.serial_number}`,
      html,
    });
  } catch (e) {
    logger.error(`Reissue email failed: ${e.message}`);
  }
};

// ── Repair initiated ─────────────────────────────────────────────
const sendRepairInitiatedEmail = async ({
  device,
  failureCause,
  sentTo,
  sentDate,
  signedOffBy,
  initiatedBy,
  admins,
  contacts,
}) => {
  if (!canSend()) return;
  const recipients = buildRecipients(admins, contacts);
  if (!recipients.length) return;
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#92400e;">🔧 Device Sent for Repair</p>
        <p style="margin:4px 0 0;font-size:12px;color:#b45309;">Initiated by ${initiatedBy.full_name}</p>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Facility", device.facility_name)}
          ${row("Failure Cause", failureCause)}
          ${row("Sent To", sentTo || "—")}
          ${row("Date Sent", sentDate || "—")}
          ${row("Signed Off By", signedOffBy || "—")}
          ${row("Initiated By", initiatedBy.full_name)}
        </table>
      </div>
      <div style="text-align:center;">
        <a href="${appUrl()}/repairs" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">View Repairs →</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">This notification was also sent to: <strong>${recipients.map((r) => r.name).join(", ")}</strong></p>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.map((r) => r.email).join(", "),
      subject: `🔧 Repair Initiated: ${device.serial_number} — ${device.facility_name}`,
      html,
    });
    logger.info(`Repair initiated email sent for device ${device.id}`);
  } catch (e) {
    logger.error(`Repair initiated email failed: ${e.message}`);
  }
};

// ── Repair returned from center ──────────────────────────────────
const sendRepairReturnedEmail = async ({
  device,
  rp,
  returnedDate,
  returnCondition,
  admins,
  contacts,
}) => {
  if (!canSend()) return;
  const recipients = buildRecipients(admins, contacts);
  if (!recipients.length) return;
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#166534;">🔧 Device Returned from Repair</p>
        <p style="margin:4px 0 0;font-size:12px;color:#059669;">Pending reissuance to facility</p>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Sent To", rp.sent_to || "—")}
          ${row("Returned Date", returnedDate || "—")}
          ${row("Return Condition", returnCondition || "—")}
        </table>
      </div>
      <div style="text-align:center;">
        <a href="${appUrl()}/repairs" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">Reissue Device →</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">This notification was also sent to: <strong>${recipients.map((r) => r.name).join(", ")}</strong></p>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.map((r) => r.email).join(", "),
      subject: `Device Back from Repair: ${device.serial_number}`,
      html,
    });
  } catch (e) {
    logger.error(`Repair returned email failed: ${e.message}`);
  }
};

// ── Transfer requested ───────────────────────────────────────────
const sendTransferRequestedEmail = async ({
  device,
  reason,
  requestedBy,
  admins,
  contacts,
}) => {
  if (!canSend()) return;
  const recipients = buildRecipients(admins, contacts);
  if (!recipients.length) return;
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#6d28d9;">🔄 Transfer Request</p>
        <p style="margin:4px 0 0;font-size:12px;color:#7c3aed;">Submitted by ${requestedBy.full_name}</p>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Serial No.", device.serial_number)}
          ${row("Model", device.model)}
          ${row("Current Facility", device.facility_name)}
          ${row("Requested By", requestedBy.full_name)}
          ${reason ? row("Reason", reason) : ""}
        </table>
      </div>
      <div style="text-align:center;">
        <a href="${appUrl()}/transfer-requests" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">Review Request →</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">This notification was also sent to: <strong>${recipients.map((r) => r.name).join(", ")}</strong></p>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.map((r) => r.email).join(", "),
      subject: `🔄 Transfer Request: ${device.serial_number} — ${device.facility_name}`,
      html,
    });
    logger.info(`Transfer request email sent for device ${device.id}`);
  } catch (e) {
    logger.error(`Transfer request email failed: ${e.message}`);
  }
};

// ── Transfer reviewed ─────────────────────────────────────────────
const sendTransferReviewedEmail = async ({
  tr,
  status,
  adminNotes,
  requestedByUser,
}) => {
  if (!canSend()) return;
  const approved = status === "approved";
  const html = wrap(`
    <tr><td style="padding:28px 36px;">
      <div style="background:${approved ? "#f0fdf4" : "#fef2f2"};border:1px solid ${approved ? "#bbf7d0" : "#fecaca"};border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:${approved ? "#166534" : "#991b1b"};">${approved ? "✅ Transfer Approved" : "❌ Transfer Rejected"}</p>
      </div>
      <p style="margin:0 0 18px;font-size:14px;color:#374151;">Hi <strong>${requestedByUser.full_name}</strong>, your transfer request for device <strong>${tr.serial_number}</strong> has been <strong>${status}</strong>.</p>
      ${approved ? `<p style="margin:0 0 18px;font-size:13px;color:#6b7280;">The device has been transferred to <strong>${tr.destination_facility_name}</strong>.</p>` : ""}
      ${
        adminNotes
          ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:18px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;">Admin Notes</p>
        <p style="margin:0;font-size:13px;color:#374151;">${adminNotes}</p>
      </div>`
          : ""
      }
      <a href="${appUrl()}/devices/${tr.device_id}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;">View Device →</a>
    </td></tr>`);
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: requestedByUser.email,
      subject: `Transfer ${approved ? "Approved" : "Rejected"}: ${tr.serial_number}`,
      html,
    });
  } catch (e) {
    logger.error(`Transfer reviewed email failed: ${e.message}`);
  }
};

module.exports = {
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
};
