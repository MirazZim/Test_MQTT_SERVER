const pool = require("../config/db");

const create = async ({ user_id, value, location }) => {
  const [result] = await pool.query(
    "INSERT INTO temperatures (user_id, value, location) VALUES (?, ?, ?)",
    [user_id, value, location]
  );
  return result;
};

const getAll = async () => {
  const [rows] = await pool.query(
    "SELECT * FROM temperatures ORDER BY created_at DESC"
  );
  return rows;
};

const getAllForUser = async (userId) => {
  const [rows] = await pool.query(
    "SELECT * FROM temperatures WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  return rows;
};

const getLatest = async () => {
  const [rows] = await pool.query(
    "SELECT * FROM temperatures ORDER BY created_at DESC LIMIT 1"
  );
  return rows[0] || null;
};

const getLatestForUser = async (userId) => {
  const [rows] = await pool.query(
    "SELECT * FROM temperatures WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  return rows[0] || null;
};

const getHistoryForDays = async (days) => {
  const [rows] = await pool.query(
    `SELECT 
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as timestamp,
            AVG(value) as average_temp,
            MIN(value) as min_temp,
            MAX(value) as max_temp,
            COUNT(*) as readings_count
        FROM temperatures 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')
        ORDER BY created_at ASC`,
    [days]
  );
  return rows;
};

const getHistoryForUserAndDays = async (userId, days) => {
  const [rows] = await pool.query(
    `SELECT 
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as timestamp,
            AVG(value) as average_temp,
            MIN(value) as min_temp,
            MAX(value) as max_temp,
            COUNT(*) as readings_count
        FROM temperatures 
        WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')
        ORDER BY created_at ASC`,
    [userId, days]
  );
  return rows;
};

module.exports = {
  create,
  getAll,
  getAllForUser,
  getLatest,
  getLatestForUser,
  getHistoryForDays,
  getHistoryForUserAndDays
};
