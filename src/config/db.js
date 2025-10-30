const mysql = require('mysql2/promise');
require('dotenv').config();

console.log('Connecting to database:', {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
  enableKeepAlive: true, // ✅ NEW: Prevent MySQL from closing idle connections
  keepAliveInitialDelay: 10000,
  maxIdle: 10, // ✅ NEW: Maximum idle connections to maintain
  idleTimeout: 60000, // ✅ NEW: Close idle connections after 60s
});

// Test connection
pool.getConnection()
  .then(connection => {
    console.log('Successfully connected to MySQL database!');
    connection.release();
  })
  .catch(err => {
    console.error('Database connection error:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database connections...');
  await pool.end();
  process.exit(0);
});

module.exports = pool;