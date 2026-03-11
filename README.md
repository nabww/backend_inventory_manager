# EMR Device Inventory — Backend

REST API for the EMR Device Inventory system. Tracks tablets and SIM cards across health facilities in Homa Bay and Kisii counties, Kenya.

Built with **Node.js**, **Express**, and **MySQL**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Database | MySQL 8 |
| Auth | JWT (Bearer token) |
| Encryption | AES (SIM PIN/PUK) |
| File uploads | Multer (disk storage) |
| Email | Nodemailer + Gmail SMTP |
| Logging | Winston |
| Security | Helmet, express-rate-limit, bcrypt |

---

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── bootstrap.js      # Auto-creates DB schema + seeds on startup
│   │   ├── db.js             # MySQL connection pool
│   │   ├── logger.js         # Winston logger
│   │   └── mailer.js         # Gmail SMTP, email templates
│   ├── controllers/
│   │   └── index.js          # All request handlers
│   ├── middleware/
│   │   └── index.js          # authenticate, isAdmin, isOfficer, validate
│   ├── models/
│   │   ├── device.model.js
│   │   ├── loss_model.js
│   │   └── user.model.js
│   ├── routes/
│   │   └── index.js          # All routes
│   ├── utils/
│   │   └── index.js          # R.ok / R.err response helpers
│   └── server.js
├── uploads/
│   └── loss-docs/            # Uploaded PDF documents
├── .env
└── package.json
```

---

## Database Schema

The schema is **auto-created on startup** via `bootstrap.js` — no manual migration needed.

| Table | Description |
|---|---|
| `roles` | viewer, field_officer, admin |
| `users` | Staff accounts with role FK |
| `counties` | Homa Bay, Kisii |
| `sub_counties` | Sub-counties per county |
| `affiliations` | Issuing organisations (LVCT, AHF, MoH, etc.) |
| `facilities` | Health facilities with MFL code |
| `sim_cards` | SIM cards with AES-encrypted PIN/PUK |
| `devices` | Tablets with linked facility, affiliation, SIM |
| `facility_transfers` | Device transfer audit trail |
| `verifications` | Annual device verification records |
| `device_loss_reports` | Loss reports with PDF document paths |
| `audit_logs` | All create/update/delete actions |

**Default admin:** `admin@inventory.org` / `Admin@2024`

---

## Environment Variables

Create a `.env` file in the backend root:

```env
PORT=5000

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_NAME=inventory
DB_USER=root
DB_PASSWORD=yourpassword

# JWT
JWT_SECRET=your_jwt_secret_here

# AES encryption for SIM PIN/PUK
ENCRYPTION_KEY=your_32_char_key_here

# CORS — set to your frontend URL
CORS_ORIGIN=http://localhost:3000

# Gmail SMTP (use an App Password, not your login password)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
MAIL_USER=your@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM="EMR Inventory <your@gmail.com>"
```

> **Gmail setup:** Go to Google Account → Security → 2-Step Verification → App Passwords. Generate a password for "Mail" and use it as `MAIL_PASS`.

---

## Running Locally

```bash
npm install
npm run dev      # nodemon
# or
npm start        # node
```

The server bootstraps the database automatically on first start.

---

## API Reference

All routes are prefixed with `/api`. Protected routes require:
```
Authorization: Bearer <jwt_token>
```

### Auth

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Login, returns JWT |
| GET | `/auth/me` | Auth | Current user info |
| POST | `/auth/register` | Admin | Create new user |
| POST | `/auth/change-password` | Auth | Change own password |

### Users

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/users` | Admin | List all users |
| PATCH | `/users/:id` | Admin | Update user |
| DELETE | `/users/:id` | Admin | Delete user |
| GET | `/users/escalation-targets` | Officer | Users eligible for loss report escalation |

### Reference Data

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/counties` | Auth | List counties |
| GET | `/counties/:id/sub-counties` | Auth | Sub-counties for a county |
| GET | `/affiliations` | Auth | List affiliations |
| POST | `/affiliations` | Officer | Create affiliation |

### Facilities

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/facilities` | Auth | List facilities (paginated, filterable) |
| POST | `/facilities` | Officer | Create facility |
| GET | `/facilities/:id` | Auth | Get facility detail |
| PATCH | `/facilities/:id` | Officer | Update facility |
| DELETE | `/facilities/:id` | Admin | Delete facility |
| POST | `/facilities/import` | Officer | Bulk import via XLSX |

### Devices

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/devices` | Auth | List devices (paginated, filterable) |
| POST | `/devices` | Officer | Create device |
| GET | `/devices/export` | Auth | Export to XLSX |
| GET | `/devices/:id` | Auth | Get device detail |
| PATCH | `/devices/:id` | Officer | Update device |
| DELETE | `/devices/:id` | Admin | Delete device |
| POST | `/devices/import` | Officer | Bulk import via XLSX |
| POST | `/devices/:id/transfer` | Admin | Transfer to another facility |

### Verifications

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/verifications` | Auth | List verifications |
| POST | `/devices/:id/verify` | Officer | Submit verification (pass/fail/partial/lost) |

### Loss Reports

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/devices/:id/report-lost` | Officer | Report device lost (multipart/form-data, PDF uploads) |
| GET | `/devices/:id/loss-documents/:type` | Officer | View/download PDF (`type`: `incident` or `police`). Add `?download=1` to force download |
| POST | `/devices/:id/review-loss` | Admin | Acknowledge / reject / escalate loss report |
| POST | `/devices/:id/recover` | Admin | Mark device as recovered |

### Other

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/dashboard` | Auth | Summary stats |
| GET | `/audit-logs` | Admin | Full audit trail |

---

## Role Levels

| Role | Level | Permissions |
|---|---|---|
| `viewer` | 1 | Read-only access |
| `field_officer` | 2 | View + create + edit + verify + report lost |
| `admin` | 3 | Full access including delete, transfers, loss review, audit log |

---

## Deployment

### Railway (Cloud)

Set all environment variables in the Railway dashboard. The `trust proxy` setting is already configured for Railway's proxy layer.

### Linux Server (Self-hosted)

```bash
# Install dependencies
npm install --production

# Set up PM2
pm2 start src/server.js --name inventory-backend
pm2 save
pm2 startup

# Nginx proxies /api/ → localhost:5000
# See server-setup.md for full Nginx config
```

Make sure `uploads/loss-docs/` exists and is writable by the Node process.

---

## Email Alerts

The system sends email in two scenarios:

- **Lost device reported** — All admins receive an alert with PDF attachments (if uploaded)
- **Loss report escalated** — Escalation targets (field officers + admins) are notified

Emails include a branded SVG header and links back to the application (uses `CORS_ORIGIN` for link generation).
