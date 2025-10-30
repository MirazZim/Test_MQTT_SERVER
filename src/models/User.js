// const bcrypt = require("bcryptjs");
// const db = require("../config/db");

// class User {
//   static async create(username, password, role = "user") {
//     const hashedPassword = await bcrypt.hash(password, 10);
//     const [result] = await db.query(
//       "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
//       [username, hashedPassword, role]
//     );
//     return result.insertId;
//   }

//   static async findByUsername(username) {
//     const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
//       username,
//     ]);
//     return rows[0];
//   }

//   // ADD THIS MISSING METHOD
//   static async findById(id) {
//     const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
//     return rows[0];
//   }

//   // ADD THIS MISSING METHOD
//   static async getAll() {
//     const [rows] = await db.query(
//       "SELECT id, username, role, created_at FROM users ORDER BY created_at DESC"
//     );
//     return rows;
//   }

//   static async comparePassword(password, hashedPassword) {
//     return bcrypt.compare(password, hashedPassword);
//   }
// }

// module.exports = User;



const bcrypt = require("bcryptjs");
const db = require("../config/db");

const create = async (username, password, role = "user") => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
    [username, hashedPassword, role]
  );
  return result.insertId;
};

const findByUsername = async (username) => {
  const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
    username,
  ]);
  return rows[0];
};

const findById = async (id) => {
  const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0];
};

const getAll = async () => {
  const [rows] = await db.query(
    "SELECT id, username, role, created_at FROM users ORDER BY created_at DESC"
  );
  return rows;
};

const comparePassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};

module.exports = {
  create,
  findByUsername,
  findById,
  getAll,
  comparePassword
};
