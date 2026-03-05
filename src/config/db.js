const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  database:           process.env.DB_NAME     || 'emr_inventory',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:    10,
  timezone:           '+00:00',
  charset:            'utf8mb4',
});

pool.getConnection()
  .then(c => { console.log('✅ MySQL connected'); c.release(); })
  .catch(e => { console.error('❌ MySQL failed:', e.message); process.exit(1); });

/**
 * Central query helper — always uses pool.query() (client-side interpolation)
 * which handles all param types correctly including LIMIT/OFFSET integers.
 */
const query = (sql, params = []) => pool.query(sql, params);

const getConnection = () => pool.getConnection();

module.exports = { query, getConnection };
