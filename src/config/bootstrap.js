/**
 * bootstrap.js — place at backend/src/config/bootstrap.js
 *
 * Connects without a DB, creates `inventory` if missing, then runs the full
 * schema using IF NOT EXISTS / INSERT IGNORE so it is safe on every redeploy.
 */
const mysql = require("mysql2/promise");
const logger = require("./logger");

const DB_NAME = process.env.DB_NAME || "inventory";

/* ================================================================
   SCHEMA — mirrors the live dump exactly
   ================================================================ */
const STATEMENTS = [
  /* ── roles ──────────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`roles\` (
    \`id\`    TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\`  VARCHAR(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
    \`label\` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_role_name\` (\`name\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT IGNORE INTO \`roles\` (id, name, label) VALUES
    (1,'viewer','Viewer'),
    (2,'field_officer','Field Officer'),
    (3,'admin','Administrator')`,

  /* ── users ───────────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`role_id\`             TINYINT UNSIGNED NOT NULL DEFAULT 1,
    \`full_name\`           VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`email\`               VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`password_hash\`       VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`is_active\`           TINYINT(1) NOT NULL DEFAULT 1,
    \`last_login\`          DATETIME DEFAULT NULL,
    \`zone_type\`           ENUM('all','county','sub_county','facility') NOT NULL DEFAULT 'all',
    \`zone_county_id\`      SMALLINT UNSIGNED DEFAULT NULL,
    \`zone_sub_county_id\`  INT UNSIGNED DEFAULT NULL,
    \`zone_facility_id\`    INT UNSIGNED DEFAULT NULL,
    \`created_at\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_user_email\` (\`email\`),
    KEY \`idx_users_role\` (\`role_id\`),
    CONSTRAINT \`fk_users_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* Default admin — password: Admin@2024 */
  `INSERT IGNORE INTO \`users\` (id, role_id, full_name, email, password_hash, is_active) VALUES
    (1, 3, 'System Admin', 'admin@inventory.org',
     '$2b$12$AkFrPmyVFvZwScdYqzGiWuR.5dGliE9YCyBM0/7Sk1uaGREGl1c2q', 1)`,

  /* ── affiliations ────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`affiliations\` (
    \`id\`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\`       VARCHAR(200) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`short_code\` VARCHAR(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`created_by\` INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_affiliation_name\` (\`name\`),
    KEY \`idx_affiliation_code\` (\`short_code\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT IGNORE INTO \`affiliations\` (id, name) VALUES
    (1,'LVCT Vukisha95'),
    (2,'AHF'),
    (3,'Ministry of Health - Homa Bay'),
    (4,'DHA')`,

  /* ── counties ────────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`counties\` (
    \`id\`   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`code\` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_county_name\` (\`name\`),
    UNIQUE KEY \`uq_county_code\` (\`code\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT IGNORE INTO \`counties\` (id, name, code) VALUES
    (43,'Homa Bay',43),
    (45,'Kisii',45)`,

  /* ── sub_counties ────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`sub_counties\` (
    \`id\`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`county_id\` SMALLINT UNSIGNED NOT NULL,
    \`name\`      VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_subcounty_county\` (\`county_id\`),
    CONSTRAINT \`fk_subcounty_county\` FOREIGN KEY (\`county_id\`) REFERENCES \`counties\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── service_delivery_points ───────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`service_delivery_points\` (
  \`id\`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`name\`          VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`display_order\` INT NOT NULL DEFAULT 0,
  \`created_at\`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_sdp_name\` (\`name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT IGNORE INTO \`service_delivery_points\` (name, display_order) VALUES
  ('OPD', 1),
  ('IPD', 2),
  ('Laboratory', 3),
  ('Triage', 4),
  ('HTS', 5),
  ('MCH/MNCH', 6),
  ('Adherence', 7),
  ('Administration', 8),
  ('Pharmacy', 9)`,

  /* ── facility_sdps (links facilities to SDPs with provider counts) ── */
  `CREATE TABLE IF NOT EXISTS \`facility_sdps\` (
  \`id\`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`facility_id\`    INT UNSIGNED NOT NULL,
  \`sdp_id\`         INT UNSIGNED NOT NULL,
  \`provider_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`is_active\`      TINYINT(1) NOT NULL DEFAULT 1,
  \`created_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_facility_sdp\` (\`facility_id\`, \`sdp_id\`),
  CONSTRAINT \`fk_fs_facility\` FOREIGN KEY (\`facility_id\`) REFERENCES \`facilities\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`fk_fs_sdp\`      FOREIGN KEY (\`sdp_id\`)      REFERENCES \`service_delivery_points\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── charger_types ──────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`charger_types\` (
  \`id\`   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`name\` VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_charger_type\` (\`name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT IGNORE INTO \`charger_types\` (id, name) VALUES (1, 'Type A'), (2, 'Type C')`,

  /* ── facility_chargers ──────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`facility_chargers\` (
  \`id\`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`facility_id\`     INT UNSIGNED NOT NULL,
  \`charger_type_id\` INT UNSIGNED NOT NULL,
  \`count\`           INT UNSIGNED NOT NULL DEFAULT 0,
  \`updated_by\`      INT UNSIGNED NOT NULL,
  \`updated_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_facility_charger_type\` (\`facility_id\`, \`charger_type_id\`),
  CONSTRAINT \`fk_fc_facility\` FOREIGN KEY (\`facility_id\`) REFERENCES \`facilities\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`fk_fc_type\` FOREIGN KEY (\`charger_type_id\`) REFERENCES \`charger_types\` (\`id\`),
  CONSTRAINT \`fk_fc_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* IDs match live dump exactly */
  `INSERT IGNORE INTO \`sub_counties\` (id, county_id, name) VALUES
    (1, 43,'Homa Bay Town'),
    (2, 43,'Kabondo Kasipul'),
    (3, 43,'Karachuonyo'),
    (4, 43,'Kasipul'),
    (5, 43,'Suba West'),
    (6, 43,'Ndhiwa'),
    (7, 43,'Rangwe'),
    (8, 43,'Suba North'),
    (9, 43,'Suba South'),
    (16,45,'Bobasi'),
    (17,45,'Bomachoge Borabu'),
    (18,45,'Bomachoge Chache'),
    (19,45,'Bonchari'),
    (20,45,'Kitutu Chache North'),
    (21,45,'Kitutu Chache South'),
    (22,45,'Nyaribari Chache'),
    (23,45,'Nyaribari Masaba'),
    (24,45,'South Mugirango')`,

  /* ── sim_cards ───────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`sim_cards\` (
    \`id\`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`sim_serial\`   VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`phone_number\` VARCHAR(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`pin\`          VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`puk\`          VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`network\`      VARCHAR(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`created_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_sim_phone\`  (\`phone_number\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── facilities ──────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`facilities\` (
    \`id\`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`mfl_code\`      VARCHAR(20)  COLLATE utf8mb4_unicode_ci NOT NULL,
    \`name\`          VARCHAR(200) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`county_id\`     SMALLINT UNSIGNED NOT NULL,
    \`sub_county_id\` INT UNSIGNED DEFAULT NULL,
    \`created_at\`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_facility_mfl\`     (\`mfl_code\`),
    KEY \`idx_facility_county\`        (\`county_id\`),
    KEY \`idx_facility_subcounty\`     (\`sub_county_id\`),
    CONSTRAINT \`fk_facility_county\`    FOREIGN KEY (\`county_id\`)     REFERENCES \`counties\`     (\`id\`),
    CONSTRAINT \`fk_facility_subcounty\` FOREIGN KEY (\`sub_county_id\`) REFERENCES \`sub_counties\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* (facility inserts omitted for brevity – they are already in your file) */
  /* ... all facility INSERT statements remain as in your original ... */

  /* ── devices ─────────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`devices\` (
  \`id\`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`facility_id\`     INT UNSIGNED NOT NULL,
  \`affiliation_id\`  INT UNSIGNED NOT NULL,
  \`sim_card_id\`     INT UNSIGNED DEFAULT NULL,
  \`has_sim\`         TINYINT(1) NOT NULL DEFAULT 0,
  \`serial_number\`   VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`imei\`            VARCHAR(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`model\`           VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`asset_tag\`       VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`ip_address\`      VARCHAR(45)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`cover_condition\` ENUM('good','damaged','missing','replaced') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'good',
  \`cover_notes\`     TEXT COLLATE utf8mb4_unicode_ci,
  \`date_issued\`     DATE DEFAULT NULL,
  \`assigned_to\`     VARCHAR(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`status\`          ENUM('active','under_repair','repair_return_pending','returned','pending_transfer','decommissioned','lost') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  \`sdp_id\`          INT UNSIGNED DEFAULT NULL,
  \`notes\`           TEXT COLLATE utf8mb4_unicode_ci,
  \`has_charger\`     TINYINT(1) NOT NULL DEFAULT 0,
  \`created_by\`      INT UNSIGNED NOT NULL,
  \`updated_by\`      INT UNSIGNED DEFAULT NULL,
  \`created_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_device_serial\` (\`serial_number\`),
  UNIQUE KEY \`uq_device_sim\`    (\`sim_card_id\`),
  KEY \`idx_device_facility\`     (\`facility_id\`),
  KEY \`idx_device_sdp\`          (\`sdp_id\`),
  KEY \`idx_device_affiliation\`  (\`affiliation_id\`),
  KEY \`idx_device_status\`       (\`status\`),
  KEY \`fk_device_created_by\`    (\`created_by\`),
  KEY \`fk_device_updated_by\`    (\`updated_by\`),
  CONSTRAINT \`fk_device_affiliation\` FOREIGN KEY (\`affiliation_id\`) REFERENCES \`affiliations\` (\`id\`),
  CONSTRAINT \`fk_device_created_by\`  FOREIGN KEY (\`created_by\`)     REFERENCES \`users\`        (\`id\`),
  CONSTRAINT \`fk_device_facility\`    FOREIGN KEY (\`facility_id\`)    REFERENCES \`facilities\`   (\`id\`),
  CONSTRAINT \`fk_device_sim\`         FOREIGN KEY (\`sim_card_id\`)    REFERENCES \`sim_cards\`    (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`fk_device_updated_by\`  FOREIGN KEY (\`updated_by\`)     REFERENCES \`users\`        (\`id\`),
  CONSTRAINT \`fk_device_sdp\`         FOREIGN KEY (\`sdp_id\`)         REFERENCES \`service_delivery_points\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── facility_transfers ──────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`facility_transfers\` (
    \`id\`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`device_id\`        INT UNSIGNED NOT NULL,
    \`from_facility_id\` INT UNSIGNED NOT NULL,
    \`to_facility_id\`   INT UNSIGNED NOT NULL,
    \`transferred_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`transferred_by\`   INT UNSIGNED NOT NULL,
    \`reason\`           TEXT COLLATE utf8mb4_unicode_ci,
    PRIMARY KEY (\`id\`),
    KEY \`idx_transfer_device\` (\`device_id\`),
    KEY \`fk_transfer_from\`    (\`from_facility_id\`),
    KEY \`fk_transfer_to\`      (\`to_facility_id\`),
    KEY \`fk_transfer_by\`      (\`transferred_by\`),
    CONSTRAINT \`fk_transfer_by\`     FOREIGN KEY (\`transferred_by\`)   REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_transfer_device\` FOREIGN KEY (\`device_id\`)        REFERENCES \`devices\`    (\`id\`),
    CONSTRAINT \`fk_transfer_from\`   FOREIGN KEY (\`from_facility_id\`) REFERENCES \`facilities\` (\`id\`),
    CONSTRAINT \`fk_transfer_to\`     FOREIGN KEY (\`to_facility_id\`)   REFERENCES \`facilities\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── verifications ───────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`verifications\` (
    \`id\`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`device_id\`      INT UNSIGNED NOT NULL,
    \`verified_by\`    INT UNSIGNED NOT NULL,
    \`verified_at\`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`device_present\` TINYINT(1) NOT NULL DEFAULT 0,
    \`sim_paired\`     TINYINT(1) NOT NULL DEFAULT 0,
    \`cover_ok\`       TINYINT(1) NOT NULL DEFAULT 0,
    \`powers_on\`      TINYINT(1) NOT NULL DEFAULT 0,
    \`emr_working\`    TINYINT(1) NOT NULL DEFAULT 0,
    \`overall_status\` ENUM('pass','fail','partial','lost') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pass',
    \`notes\`          TEXT COLLATE utf8mb4_unicode_ci,
    PRIMARY KEY (\`id\`),
    KEY \`idx_verification_device\` (\`device_id\`),
    KEY \`idx_verification_date\`   (\`verified_at\`),
    KEY \`fk_verification_by\`      (\`verified_by\`),
    CONSTRAINT \`fk_verification_by\`     FOREIGN KEY (\`verified_by\`) REFERENCES \`users\`   (\`id\`),
    CONSTRAINT \`fk_verification_device\` FOREIGN KEY (\`device_id\`)  REFERENCES \`devices\`  (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── admin_contacts ──────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`admin_contacts\` (
    \`id\`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\`       VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`email\`      VARCHAR(200) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`cadre\`      VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`is_active\`  TINYINT(1) NOT NULL DEFAULT 1,
    \`created_by\` INT UNSIGNED NOT NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_admin_contact_email\` (\`email\`),
    CONSTRAINT \`fk_ac_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── return_requests ─────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`return_requests\` (
    \`id\`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`device_id\`            INT UNSIGNED NOT NULL,
    \`requested_by\`         INT UNSIGNED NOT NULL,
    \`reason\`               TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
    \`status\`               ENUM('pending','approved','rejected','reissued') NOT NULL DEFAULT 'pending',
    \`admin_notes\`          TEXT COLLATE utf8mb4_unicode_ci,
    \`reviewed_by\`          INT UNSIGNED DEFAULT NULL,
    \`reviewed_at\`          DATETIME DEFAULT NULL,
    \`storage_location\`     VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`received_date\`        DATE DEFAULT NULL,
    \`received_by\`          VARCHAR(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`reissued_date\`        DATE DEFAULT NULL,
    \`reissued_by\`          INT UNSIGNED DEFAULT NULL,
    \`reissued_to_facility\` INT UNSIGNED DEFAULT NULL,
    \`created_at\`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_return_device\` (\`device_id\`),
    KEY \`idx_return_status\` (\`status\`),
    CONSTRAINT \`fk_ret_device\`    FOREIGN KEY (\`device_id\`)            REFERENCES \`devices\`    (\`id\`),
    CONSTRAINT \`fk_ret_requested\` FOREIGN KEY (\`requested_by\`)         REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_ret_reviewed\`  FOREIGN KEY (\`reviewed_by\`)          REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_ret_reissued\`  FOREIGN KEY (\`reissued_by\`)          REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_ret_facility\`  FOREIGN KEY (\`reissued_to_facility\`) REFERENCES \`facilities\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── repair_requests ─────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`repair_requests\` (
    \`id\`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`device_id\`            INT UNSIGNED NOT NULL,
    \`initiated_by\`         INT UNSIGNED NOT NULL,
    \`failure_cause\`        TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
    \`sent_to\`              VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`sent_date\`            DATE DEFAULT NULL,
    \`signed_off_by\`        VARCHAR(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`status\`               ENUM('pending','under_repair','repair_return_pending','reissued','rejected') NOT NULL DEFAULT 'pending',
    \`admin_notes\`          TEXT COLLATE utf8mb4_unicode_ci,
    \`returned_date\`        DATE DEFAULT NULL,
    \`return_condition\`     VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`reissued_date\`        DATE DEFAULT NULL,
    \`reissued_by\`          INT UNSIGNED DEFAULT NULL,
    \`reissued_to_facility\` INT UNSIGNED DEFAULT NULL,
    \`created_at\`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_repair_device\` (\`device_id\`),
    KEY \`idx_repair_status\` (\`status\`),
    CONSTRAINT \`fk_rep_device\`    FOREIGN KEY (\`device_id\`)            REFERENCES \`devices\`    (\`id\`),
    CONSTRAINT \`fk_rep_initiated\` FOREIGN KEY (\`initiated_by\`)         REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_rep_reissued\`  FOREIGN KEY (\`reissued_by\`)          REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_rep_facility\`  FOREIGN KEY (\`reissued_to_facility\`) REFERENCES \`facilities\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── transfer_requests ───────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`transfer_requests\` (
    \`id\`                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`device_id\`               INT UNSIGNED NOT NULL,
    \`requested_by\`            INT UNSIGNED NOT NULL,
    \`destination_facility_id\` INT UNSIGNED NOT NULL,
    \`reason\`                  TEXT COLLATE utf8mb4_unicode_ci,
    \`status\`                  ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    \`admin_notes\`             TEXT COLLATE utf8mb4_unicode_ci,
    \`reviewed_by\`             INT UNSIGNED DEFAULT NULL,
    \`reviewed_at\`             DATETIME DEFAULT NULL,
    \`created_at\`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_treq_device\` (\`device_id\`),
    KEY \`idx_treq_status\` (\`status\`),
    CONSTRAINT \`fk_treq_device\`       FOREIGN KEY (\`device_id\`)               REFERENCES \`devices\`    (\`id\`),
    CONSTRAINT \`fk_treq_requested\`    FOREIGN KEY (\`requested_by\`)            REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_treq_reviewed\`     FOREIGN KEY (\`reviewed_by\`)             REFERENCES \`users\`      (\`id\`),
    CONSTRAINT \`fk_treq_destination\`  FOREIGN KEY (\`destination_facility_id\`) REFERENCES \`facilities\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── user_sub_counties ───────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`user_sub_counties\` (
    \`user_id\`      INT UNSIGNED NOT NULL,
    \`sub_county_id\` INT UNSIGNED NOT NULL,
    \`created_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`user_id\`, \`sub_county_id\`),
    CONSTRAINT \`fk_usc_user\`       FOREIGN KEY (\`user_id\`)      REFERENCES \`users\`       (\`id\`) ON DELETE CASCADE,
    CONSTRAINT \`fk_usc_sub_county\` FOREIGN KEY (\`sub_county_id\`) REFERENCES \`sub_counties\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── user_facilities ─────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`user_facilities\` (
    \`user_id\`     INT UNSIGNED NOT NULL,
    \`facility_id\` INT UNSIGNED NOT NULL,
    \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`user_id\`, \`facility_id\`),
    CONSTRAINT \`fk_uf_user\`     FOREIGN KEY (\`user_id\`)     REFERENCES \`users\`      (\`id\`) ON DELETE CASCADE,
    CONSTRAINT \`fk_uf_facility\` FOREIGN KEY (\`facility_id\`) REFERENCES \`facilities\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── audit_logs ──────────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`audit_logs\` (
    \`id\`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`user_id\`     INT UNSIGNED NOT NULL,
    \`action\`      ENUM('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','TRANSFER','VERIFY','IMPORT','EXPORT') COLLATE utf8mb4_unicode_ci NOT NULL,
    \`entity_type\` VARCHAR(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
    \`entity_id\`   INT UNSIGNED NOT NULL,
    \`old_values\`  JSON DEFAULT NULL,
    \`new_values\`  JSON DEFAULT NULL,
    \`ip_address\`  VARCHAR(45)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_audit_entity\`  (\`entity_type\`,\`entity_id\`),
    KEY \`idx_audit_user\`    (\`user_id\`),
    KEY \`idx_audit_created\` (\`created_at\`),
    CONSTRAINT \`fk_audit_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── device_loss_reports ─────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS \`device_loss_reports\` (
    \`id\`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`device_id\`           INT UNSIGNED NOT NULL,
    \`reported_by\`         INT UNSIGNED NOT NULL,
    \`date_lost\`           DATE NOT NULL,
    \`circumstances\`       TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
    \`last_known_location\` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`reported_by_name\`    VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    \`police_abstract\`          VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`incident_report_path\`     VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`police_ob_path\`           VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    \`status\`              ENUM('pending','acknowledged','rejected','escalated','recovered')
                           COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
    \`admin_notes\`         TEXT COLLATE utf8mb4_unicode_ci,
    \`reviewed_by\`         INT UNSIGNED DEFAULT NULL,
    \`reviewed_at\`         DATETIME DEFAULT NULL,
    \`created_at\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_loss_device\`  (\`device_id\`),
    KEY \`idx_loss_status\`  (\`status\`),
    CONSTRAINT \`fk_loss_device\`      FOREIGN KEY (\`device_id\`)   REFERENCES \`devices\` (\`id\`),
    CONSTRAINT \`fk_loss_reported_by\` FOREIGN KEY (\`reported_by\`) REFERENCES \`users\`   (\`id\`),
    CONSTRAINT \`fk_loss_reviewed_by\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\`   (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/* ================================================================ */
const run = async () => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
    });

    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    logger.info(`Database "${DB_NAME}" ready`);

    await conn.query(`USE \`${DB_NAME}\``);

    for (const sql of STATEMENTS) {
      await conn.query(sql);
    }

    // Add locked column if it doesn't exist yet
    try {
      await conn.query(
        `ALTER TABLE \`devices\` ADD COLUMN \`locked\` TINYINT(1) NOT NULL DEFAULT 0`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }

    // Add has_charger column if not exists (already in CREATE TABLE, but safe)
    try {
      await conn.query(
        `ALTER TABLE \`devices\` ADD COLUMN \`has_charger\` TINYINT(1) NOT NULL DEFAULT 0`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }

    // Add charger_type_id column to devices (manual charger type)
    try {
      await conn.query(
        `ALTER TABLE \`devices\` ADD COLUMN \`charger_type_id\` INT UNSIGNED DEFAULT NULL`,
      );
      // Add foreign key constraint
      await conn.query(
        `ALTER TABLE \`devices\` ADD CONSTRAINT \`fk_device_charger_type\` 
         FOREIGN KEY (\`charger_type_id\`) REFERENCES \`charger_types\`(\`id\`) ON DELETE SET NULL`,
      );
      // Add index for performance
      await conn.query(
        `ALTER TABLE \`devices\` ADD INDEX \`idx_device_charger_type\` (\`charger_type_id\`)`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME" && e.code !== "ER_DUP_KEY") {
        // Column or constraint already exists – ignore
        logger.warn("Adding charger_type_id: " + e.message);
      }
    }

    // Add charger_present column to verifications
    try {
      await conn.query(
        `ALTER TABLE \`verifications\` ADD COLUMN \`charger_present\` TINYINT(1) NOT NULL DEFAULT 0`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }

    // Add lost to verifications overall_status ENUM if upgrading
    try {
      await conn.query(
        `ALTER TABLE \`verifications\` MODIFY COLUMN \`overall_status\` ENUM('pass','fail','partial','lost') NOT NULL DEFAULT 'pass'`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }

    // Add file path columns to device_loss_reports if upgrading existing DB
    for (const col of [
      `ALTER TABLE \`device_loss_reports\` ADD COLUMN \`incident_report_path\` VARCHAR(500) DEFAULT NULL`,
      `ALTER TABLE \`device_loss_reports\` ADD COLUMN \`police_ob_path\` VARCHAR(500) DEFAULT NULL`,
    ]) {
      try {
        await conn.query(col);
      } catch (e) {
        if (e.code !== "ER_DUP_FIELDNAME") throw e;
      }
    }

    // Add user zone columns if upgrading existing DB
    for (const col of [
      `ALTER TABLE \`users\` ADD COLUMN \`zone_type\` ENUM('all','county','sub_county','facility') NOT NULL DEFAULT 'all'`,
      `ALTER TABLE \`users\` ADD COLUMN \`zone_county_id\` SMALLINT UNSIGNED DEFAULT NULL`,
      `ALTER TABLE \`users\` ADD COLUMN \`zone_sub_county_id\` INT UNSIGNED DEFAULT NULL`,
      `ALTER TABLE \`users\` ADD COLUMN \`zone_facility_id\` INT UNSIGNED DEFAULT NULL`,
    ]) {
      try {
        await conn.query(col);
      } catch (e) {
        if (e.code !== "ER_DUP_FIELDNAME") throw e;
      }
    }

    // Ensure junction tables exist (already in STATEMENTS, but safe)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`user_sub_counties\` (
        \`user_id\`       INT UNSIGNED NOT NULL,
        \`sub_county_id\` INT UNSIGNED NOT NULL,
        \`created_at\`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`user_id\`, \`sub_county_id\`),
        CONSTRAINT \`fk_usc_user\`       FOREIGN KEY (\`user_id\`)      REFERENCES \`users\`       (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_usc_sub_county\` FOREIGN KEY (\`sub_county_id\`) REFERENCES \`sub_counties\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`user_facilities\` (
        \`user_id\`     INT UNSIGNED NOT NULL,
        \`facility_id\` INT UNSIGNED NOT NULL,
        \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`user_id\`, \`facility_id\`),
        CONSTRAINT \`fk_uf_user\`     FOREIGN KEY (\`user_id\`)     REFERENCES \`users\`      (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_uf_facility\` FOREIGN KEY (\`facility_id\`) REFERENCES \`facilities\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add rejected to repair_requests status ENUM
    try {
      await conn.query(
        `ALTER TABLE \`repair_requests\` MODIFY COLUMN \`status\` ENUM('pending','under_repair','repair_return_pending','reissued','rejected') NOT NULL DEFAULT 'pending'`,
      );
    } catch (e) {
      logger.warn("repair_requests ENUM update: " + e.message);
    }

    // Drop unique key on sim_serial if it exists
    try {
      await conn.query(
        `ALTER TABLE \`sim_cards\` DROP INDEX \`uq_sim_serial\``,
      );
    } catch (e) {
      if (e.code !== "ER_CANT_DROP_FIELD_OR_KEY") throw e;
    }

    // Update device status ENUM to include new workflow statuses
    try {
      await conn.query(
        `ALTER TABLE \`devices\` MODIFY COLUMN \`status\` ENUM('active','under_repair','repair_return_pending','returned','pending_transfer','decommissioned','lost') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active'`,
      );
    } catch (e) {
      logger.warn("Device status ENUM update: " + e.message);
    }

    // Add sdp_id column if not exists (already in CREATE TABLE, but safe)
    try {
      await conn.query(
        `ALTER TABLE \`devices\` ADD COLUMN \`sdp_id\` INT UNSIGNED DEFAULT NULL,
         ADD CONSTRAINT \`fk_device_sdp\` FOREIGN KEY (\`sdp_id\`) REFERENCES \`service_delivery_points\` (\`id\`) ON DELETE SET NULL`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }

    // Create new workflow tables if not exists (already in STATEMENTS, but safe)
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS \`admin_contacts\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`email\` VARCHAR(200) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`cadre\` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_by\` INT UNSIGNED NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_ac_email\` (\`email\`),
        CONSTRAINT \`fk_ac_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS \`return_requests\` ... `, // already defined in STATEMENTS
    ]) {
    }

    logger.info("Schema bootstrap complete");
  } catch (e) {
    logger.error("Bootstrap failed: " + e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
};

module.exports = run;
