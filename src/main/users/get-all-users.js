// const bcrypt = require("bcryptjs");
// const db = require("../../config/db");

// // Model functions
// const create = async (username, password, role = "user") => {
//     const hashedPassword = await bcrypt.hash(password, 10);
//     const [result] = await db.query(
//         "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
//         [username, hashedPassword, role]
//     );
//     return result.insertId;
// };

// const findByUsername = async (username) => {
//     const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
//         username,
//     ]);
//     return rows[0];
// };

// const findById = async (id) => {
//     const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
//     return rows[0];
// };

// const getAll = async () => {
//     const [rows] = await db.query(
//         "SELECT id, username, role, created_at FROM users ORDER BY created_at DESC"
//     );
//     return rows;
// };

// const comparePassword = async (password, hashedPassword) => {
//     return bcrypt.compare(password, hashedPassword);
// };

// // Helper function for main logic
// const fetchAllUsers = async () => {
//     try {
//         const users = await getAll();
//         return users;
//     } catch (error) {
//         throw error;
//     }
// };

// // Main function
// const getAllUsers = async () => {
//     try {
//         const users = await fetchAllUsers();

//         if (!users || users.length === 0) {
//             return Promise.resolve({
//                 status: "success",
//                 message: "No users found",
//                 users: [],
//             });
//         }

//         return Promise.resolve({
//             status: "success",
//             message: "Users retrieved successfully",
//             users: users,
//         });

//     } catch (err) {
//         console.error("Error getting all users:", err);
//         return Promise.reject({
//             status: "failed",
//             message: err.message || "An error occurred while retrieving users",
//         });
//     }
// };

// module.exports = {
//     // Model functions
//     create,
//     findByUsername,
//     findById,
//     getAll,
//     comparePassword,
//     // Main function
//     getAllUsers
// };


const { getAll } = require("../../models/User");

const fetchAllUsers = async () => {
    try {
        const users = await getAll();
        return users;
    } catch (error) {
        throw error;
    }
};

const getAllUsers = async () => {
    try {
        const users = await fetchAllUsers();

        if (!users || users.length === 0) {
            return Promise.resolve({
                status: "success",
                message: "No users found",
                users: [],
            });
        }

        return Promise.resolve({
            status: "success",
            message: "Users retrieved successfully",
            users: users,
        });

    } catch (err) {
        console.error("Error getting all users:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving users",
        });
    }
};

module.exports = { getAllUsers };
