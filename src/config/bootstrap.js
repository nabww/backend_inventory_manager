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

  /* Default admin — password: Admin@2024
     Hash taken directly from live dump. Change after first login. */
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

  /* Kisii · Bobasi (sub_county_id=16) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13511','Borangi Health Centre',45,16),
    ('13537','Ebiosi Dispensary',45,16),
    ('13558','Gesabakwa Health Centre',45,16),
    ('13561','Gesure Dispensary (Gucha)',45,16),
    ('19916','Gionsaria Dispensary (Nyamache)',45,16),
    ('13613','Igare Medical Clinic (Sameta)',45,16),
    ('13627','Itibo Eramani Dispensary',45,16),
    ('13630','Itumbe Dispensary',45,16),
    ('13671','Kenyambi Health Centre',45,16),
    ('13674','Kenyerere Dispensary (Sameta)',45,16),
    ('19917','Kiobegi Dispensary (Nyamache)',45,16),
    ('13697','Kionyo Health Centre (Nyamache)',45,16),
    ('16984','Motonto Dispensary (Gucha)',45,16),
    ('13867','Nyacheki Sub-District Hospital',45,16),
    ('13868','Nyachenge Dispensary',45,16),
    ('13869','Nyachogochogo Dispensary',45,16),
    ('13872','Nyagiki Dispensary',45,16),
    ('13882','Nyakegogi Dispensary',45,16),
    ('13891','Nyamache District Hospital',45,16),
    ('13893','Nyamagwa Health Centre',45,16),
    ('13933','Nyansakia Health Centre',45,16),
    ('13986','Omosaria Dispensary',45,16),
    ('14055','Ritumbe Health Centre',45,16),
    ('14062','Rusinga Dispensary',45,16)`,

  /* Kisii · Bomachoge Borabu (17) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13536','Eberege Dispensary',45,17),
    ('18340','Igorera Medical Clinic',45,17),
    ('16879','Itembu Dispensary',45,17),
    ('13673','Kenyenya District Hospital',45,17),
    ('17677','Kenyenya Medical Clinic (Kenyenya)',45,17),
    ('13748','Magena Dispensary',45,17),
    ('13749','Magenche Dispensary',45,17),
    ('13982','Omobera Dispensary',45,17)`,

  /* Kisii · Bomachoge Chache (18) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13538','Egetonto Dispensary (Gucha)',45,18),
    ('19984','Egetuki GOK Dispensary',45,18),
    ('13594','Gucha District Hospital',45,18),
    ('18336','Keragia Dispensary (Gucha)',45,18),
    ('22257','Kineni Dispensary',45,18),
    ('13814','Misesi Dispensary (Gucha)',45,18),
    ('18447','Moogi Dispensary',45,18),
    ('13901','Nyamasege Dispensary',45,18),
    ('14004','Our Lady of Lourdes Dispensary (Gucha)',45,18),
    ('14076','Sengera Health Centre (Gucha)',45,18)`,

  /* Kisii · Bonchari (19) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13474','Amani Medical Centre (Suneka)',45,19),
    ('13502','Bitare Dispensary',45,19),
    ('16422','Ekerubo Dispensary (Kisii South)',45,19),
    ('16424','Entanke Dispensary',45,19),
    ('13560','Gesuguri Dispensary',45,19),
    ('16425','Isamwera Dispensary',45,19),
    ('13631','Iyabe District Hospital (Kisii South)',45,19),
    ('13685','Kiaruta Dispensary',45,19),
    ('16423','Nyabioto Dispensary',45,19),
    ('16878','Nyamagiri Dispensary',45,19),
    ('13892','Nyamagundo Health Centre',45,19),
    ('13906','Nyambunwa Medical Clinic',45,19),
    ('13992','Oroche Dispensary',45,19),
    ('14045','Riana Health Centre',45,19),
    ('14054','Riotanchi Health Centre',45,19)`,

  /* Kisii · South Mugirango (24) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13505','Boige Health Centre',45,24),
    ('16974','Bokimai Dispensary',45,24),
    ('16975','Eburi Dispensary',45,24),
    ('13550','Etago Sub-District Hospital',45,24),
    ('13573','Giatunda Dispensary',45,24),
    ('13593','Gotichaki Dispensary',45,24),
    ('13681','Kiagware Dispensary',45,24),
    ('13821','Monianku Health Centre',45,24),
    ('13825','Moticho Health Centre',45,24),
    ('13847','Nduru District Hospital',45,24),
    ('16880','Nyabiosi Dispensary',45,24),
    ('16881','Nyagichenche (SDA) Dispensary',45,24),
    ('13983','Nyamogonchoro Dispensary',45,24),
    ('13945','Nyatike Health Centre',45,24),
    ('13984','Omogwa Dispensary',45,24),
    ('16973','Openda Dispensary',45,24),
    ('14131','Suguta Health Centre',45,24)`,

  /* Homa Bay · Homa Bay Town (1) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13608','Homa Bay District Hospital',43,1),
    ('16983','Hope Compassionate (ACK) Dispensary',43,1),
    ('16765','Kijawa Dispensary',43,1),
    ('19861','Koduogo Dispensary',43,1),
    ('19858','Makongeni Dispensary',43,1),
    ('13777','Marindi Health Centre',43,1),
    ('16766','Miniambo Dispensary',43,1),
    ('16986','Nyalkinyi (Jersey) Dispensary',43,1),
    ('13902','Nyamasi Dispensary',43,1),
    ('13962','Ogande Dispensary',43,1),
    ('19859','Pala Masogo Health Centre',43,1),
    ('14172','Wiga Dispensary',43,1)`,

  /* Homa Bay · Ndhiwa (6) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('16768','Amoyo Dispensary',43,6),
    ('13509','Bora Bora Clinic',43,6),
    ('13589','Got Kojowi Health Centre',43,6),
    ('18876','Kachuth Dispensary',43,6),
    ('16769','Kadhola Dispensary',43,6),
    ('13686','Kiasa Dispensary',43,6),
    ('20241','Kobodo Dispensary',43,6),
    ('20347','Kome Dispensary',43,6),
    ('13728','Kwamo Dispensary',43,6),
    ('13732','Lambwe Forest Dispensary',43,6),
    ('16770','Lwanda Awiti Dispensary',43,6),
    ('20285','Lwanda Kobita Dispensary',43,6),
    ('13751','Magina Health Centre',43,6),
    ('13761','Malela Dispensary',43,6),
    ('16258','Maram Dispensary',43,6),
    ('13841','Ndhiwa Sub-District Hospital',43,6),
    ('16771','Ndisi Dispensary',43,6),
    ('13855','Nguku Dispensary',43,6),
    ('13952','Ober Kabuoch Dispensary',43,6),
    ('16259','Okok Dispensary',43,6),
    ('13979','Ombo Kachieng\\'  Dispensary',43,6),
    ('16767','Oridi Dispensary',43,6),
    ('18877','Otange Dispensary',43,6),
    ('14011','Pala Health Centre',43,6),
    ('14015','Ponge Dispensary',43,6),
    ('20242','Unga/Adek Dispensary',43,6)`,

  /* Homa Bay · Suba North (8) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13479','Ang\\'iya Dispensary',43,8),
    ('13642','Kageno dispensary',43,8),
    ('13705','Kitare Health Centre',43,8),
    ('13731','Lambwe Dispensary',43,8),
    ('22476','Litare Community Health Centre',43,8),
    ('13798','Mbita District Hospital',43,8),
    ('17690','MED 25',43,8),
    ('13842','Ndhuru Dispensary',43,8),
    ('13854','Ng\\'odhe Island Dispensary',43,8),
    ('13950','Obalwanda Dispensary',43,8),
    ('13967','Ogongo Sub-District Hospital',43,8),
    ('14016','Ponge',43,8),
    ('17594','Rusinga Island of Hope Humanist Health Centre',43,8),
    ('14150','Tom Mboya Memorial Health Centre',43,8),
    ('14162','Usao Health Centre',43,8),
    ('14171','Waware Dispensary',43,8)`,

  /* Homa Bay · Suba South (9) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('13585','God Bura',43,9),
    ('18077','Kiembe Dispensary',43,9),
    ('13691','Kigwa Dispensary',43,9),
    ('13700','Kisaku Dispensary',43,9),
    ('13701','Kisegi Sub-District Hospital',43,9),
    ('13707','Kiwa Island Dispensary',43,9),
    ('13742','Lwanda Gwassi Dispensary',43,9),
    ('13753','Magunga Health Centre',43,9),
    ('20379','Malongo Dispensary',43,9),
    ('13828','Msare Health Centre',43,9),
    ('17711','Ngeri Dispensary',43,9),
    ('13870','Nyadenda Health Centre',43,9),
    ('13915','Nyamrisra Health Centre',43,9),
    ('13920','Nyandiwa Dispensary',43,9),
    ('13946','Nyatoto Health Centre',43,9),
    ('13949','Nys Dispensary (Suba)',43,9),
    ('13951','Obanga Health Centre',43,9),
    ('14130','SDH/Sindo',43,9),
    ('14074','Seka Health Centre',43,9),
    ('14152','Tonga Health Centre',43,9)`,

  /* Homa Bay · Suba West (5) */
  `INSERT IGNORE INTO \`facilities\` (mfl_code,name,county_id,sub_county_id) VALUES
    ('18420','Nyakweri Dispensary',43,5),
    ('17593','Remba Dispensary',43,5),
    ('17710','Ringiti Dispensary',43,5),
    ('14075','Sena Health Centre',43,5),
    ('14095','Soklo Dispensary',43,5),
    ('14140','Takawiri Dispensary',43,5),
    ('14155','Ugina Health Centre',43,5),
    ('14169','Wakula Health Centre',43,5),
    ('14176','Yokia Dispensary',43,5)`,

  /*devices*/
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
  \`has_charger\` TINYINT(1) NOT NULL DEFAULT 0,
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

  /* ── user_sub_counties (many-to-many zone assignment) ───────── */
  `CREATE TABLE IF NOT EXISTS \`user_sub_counties\` (
    \`user_id\`      INT UNSIGNED NOT NULL,
    \`sub_county_id\` INT UNSIGNED NOT NULL,
    \`created_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`user_id\`, \`sub_county_id\`),
    CONSTRAINT \`fk_usc_user\`       FOREIGN KEY (\`user_id\`)      REFERENCES \`users\`       (\`id\`) ON DELETE CASCADE,
    CONSTRAINT \`fk_usc_sub_county\` FOREIGN KEY (\`sub_county_id\`) REFERENCES \`sub_counties\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /* ── user_facilities (many-to-many zone assignment) ─────────── */
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

  /* ── locked column on devices (added separately below) ───────── */

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

    // Add locked column if it doesn't exist yet (ALTER TABLE IF NOT EXISTS not supported on all MySQL 8 versions)
    try {
      await conn.query(
        `ALTER TABLE \`devices\` ADD COLUMN \`locked\` TINYINT(1) NOT NULL DEFAULT 0`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e; // ignore "column already exists"
    }

     try {
       await conn.query(
         `ALTER TABLE \`devices\` ADD COLUMN \`has_charger\` TINYINT(1) NOT NULL DEFAULT 0`,
       );
     } catch (e) {
       if (e.code !== "ER_DUP_FIELDNAME") throw e; // ignore "column already exists"
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

    // Create user_sub_counties junction table if not exists
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

    // Create user_facilities junction table if not exists (for multi-facility zoning)
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

    // Drop unique key on sim_serial if it exists (SIM serials are not unique per device)
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

    // Add sdp_id column if not exists
    try {
      await conn.query(
        `ALTER TABLE \`devices\` ADD COLUMN \`sdp_id\` INT UNSIGNED DEFAULT NULL,
     ADD CONSTRAINT \`fk_device_sdp\` FOREIGN KEY (\`sdp_id\`) REFERENCES \`service_delivery_points\` (\`id\`) ON DELETE SET NULL`,
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }

    // Create new workflow tables
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
      `CREATE TABLE IF NOT EXISTS \`return_requests\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`device_id\` INT UNSIGNED NOT NULL, \`requested_by\` INT UNSIGNED NOT NULL,
        \`reason\` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
        \`status\` ENUM('pending','approved','rejected','reissued') NOT NULL DEFAULT 'pending',
        \`admin_notes\` TEXT COLLATE utf8mb4_unicode_ci,
        \`reviewed_by\` INT UNSIGNED DEFAULT NULL, \`reviewed_at\` DATETIME DEFAULT NULL,
        \`storage_location\` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`received_date\` DATE DEFAULT NULL, \`received_by\` VARCHAR(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`reissued_date\` DATE DEFAULT NULL, \`reissued_by\` INT UNSIGNED DEFAULT NULL,
        \`reissued_to_facility\` INT UNSIGNED DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`), KEY \`idx_ret_device\` (\`device_id\`), KEY \`idx_ret_status\` (\`status\`),
        CONSTRAINT \`fk_ret_device\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\` (\`id\`),
        CONSTRAINT \`fk_ret_requested\` FOREIGN KEY (\`requested_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_ret_reviewed\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_ret_reissued\` FOREIGN KEY (\`reissued_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_ret_facility\` FOREIGN KEY (\`reissued_to_facility\`) REFERENCES \`facilities\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS \`repair_requests\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`device_id\` INT UNSIGNED NOT NULL, \`initiated_by\` INT UNSIGNED NOT NULL,
        \`failure_cause\` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
        \`sent_to\` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`sent_date\` DATE DEFAULT NULL,
        \`signed_off_by\` VARCHAR(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`status\` ENUM('pending','under_repair','repair_return_pending','reissued','rejected') NOT NULL DEFAULT 'pending',
        \`admin_notes\` TEXT COLLATE utf8mb4_unicode_ci,
        \`returned_date\` DATE DEFAULT NULL,
        \`return_condition\` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`reissued_date\` DATE DEFAULT NULL, \`reissued_by\` INT UNSIGNED DEFAULT NULL,
        \`reissued_to_facility\` INT UNSIGNED DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`), KEY \`idx_rep_device\` (\`device_id\`), KEY \`idx_rep_status\` (\`status\`),
        CONSTRAINT \`fk_rep_device\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\` (\`id\`),
        CONSTRAINT \`fk_rep_initiated\` FOREIGN KEY (\`initiated_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_rep_reissued\` FOREIGN KEY (\`reissued_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_rep_facility\` FOREIGN KEY (\`reissued_to_facility\`) REFERENCES \`facilities\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS \`transfer_requests\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`device_id\` INT UNSIGNED NOT NULL, \`requested_by\` INT UNSIGNED NOT NULL,
        \`destination_facility_id\` INT UNSIGNED NOT NULL,
        \`reason\` TEXT COLLATE utf8mb4_unicode_ci,
        \`status\` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        \`admin_notes\` TEXT COLLATE utf8mb4_unicode_ci,
        \`reviewed_by\` INT UNSIGNED DEFAULT NULL, \`reviewed_at\` DATETIME DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`), KEY \`idx_treq_device\` (\`device_id\`), KEY \`idx_treq_status\` (\`status\`),
        CONSTRAINT \`fk_treq_device\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\` (\`id\`),
        CONSTRAINT \`fk_treq_requested\` FOREIGN KEY (\`requested_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_treq_reviewed\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_treq_destination\` FOREIGN KEY (\`destination_facility_id\`) REFERENCES \`facilities\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ]) {
      await conn.query(sql);
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
