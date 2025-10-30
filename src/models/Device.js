// const pool = require("../config/db");

// class Device {
//   static async create(deviceId, name, secret) {
//     const [result] = await pool.query(
//       "INSERT INTO devices (id, name, secret) VALUES (?, ?, ?)",
//       [deviceId, name, secret]
//     );
//     return result;
//   }

//   static async getAll() {
//     const [rows] = await pool.query(
//       "SELECT * FROM devices ORDER BY created_at DESC"
//     );
//     return rows;
//   }

//   static async assignToUser(userId, deviceId) {
//     const [result] = await pool.query(
//       "INSERT INTO user_devices (user_id, device_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id",
//       [userId, deviceId]
//     );
//     return result;
//   }

//   static async userHasAccess(userId, deviceId) {
//     const [rows] = await pool.query(
//       "SELECT 1 FROM user_devices WHERE user_id = ? AND device_id = ?",
//       [userId, deviceId]
//     );
//     return rows.length > 0;
//   }

//   static async getMessages(deviceId) {
//     const [rows] = await pool.query(
//       "SELECT * FROM messages WHERE device_id = ? ORDER BY created_at DESC LIMIT 100",
//       [deviceId]
//     );
//     return rows.map((row) => ({
//       ...row,
//       message: JSON.parse(row.message || "{}"),
//     }));
//   }
// }

// module.exports = Device;


const pool = require("../config/db");

const create = async (deviceId, name, secret) => {
  const [result] = await pool.query(
    "INSERT INTO devices (id, name, secret) VALUES (?, ?, ?)",
    [deviceId, name, secret]
  );
  return result;
};

const getAll = async () => {
  const [rows] = await pool.query(
    "SELECT * FROM devices ORDER BY created_at DESC"
  );
  return rows;
};

const assignToUser = async (userId, deviceId) => {
  const [result] = await pool.query(
    "INSERT INTO user_devices (user_id, device_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id",
    [userId, deviceId]
  );
  return result;
};

const userHasAccess = async (userId, deviceId) => {
  const [rows] = await pool.query(
    "SELECT 1 FROM user_devices WHERE user_id = ? AND device_id = ?",
    [userId, deviceId]
  );
  return rows.length > 0;
};

const getMessages = async (deviceId) => {
  const [rows] = await pool.query(
    "SELECT * FROM messages WHERE device_id = ? ORDER BY created_at DESC LIMIT 100",
    [deviceId]
  );
  return rows.map((row) => ({
    ...row,
    message: JSON.parse(row.message || "{}"),
  }));
};

module.exports = {
  create,
  getAll,
  assignToUser,
  userHasAccess,
  getMessages
};
