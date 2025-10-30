const { hashPassword } = require('../../utils/bcryptOptimized.js');
const jwt = require("jsonwebtoken");
const db = require("../../config/db");

// Helper functions
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

const create = async (username, password, role = "user") => {
    const hashedPassword = await hashPassword(password);
    const [result] = await db.query(
        "INSERT INTO users (username, password, role,is_active) VALUES (?, ?, ?, ?)",
        [username, hashedPassword, role, 1]
    );
    return result.insertId;
};

const generateJWTToken = (userData) => {
    try {
        const token = jwt.sign(
            { id: userData.id, username: userData.username, role: userData.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );
        return token;
    } catch (error) {
        console.error("Error generating JWT token:", error);
        return false;
    }
};

// NEW: Set user active status
const setUserActiveStatus = async (userId, status) => {
    try {
        await db.query("UPDATE users SET is_active = ? WHERE id = ?", [status, userId]);
        console.log(`User ${userId} is_active updated to ${status}`);
    } catch (error) {
        console.error(`Failed to update is_active for user ${userId}:`, error);
    }
};

const checkIfUserExists = async (username) => {
    try {
        const user = await findByUsername(username);
        return user || false;
    } catch (error) {
        throw error;
    }
};

const createUser = async (username, password, role) => {
    try {
        const userId = await create(username, password, role);
        const user = await findById(userId);
        return user;
    } catch (error) {
        throw error;
    }
};

// Main function
const registerUser = async (registerData) => {
    const { username, password, role = "user" } = registerData;

    try {
        if (!username || !password) {
            return Promise.reject({
                status: "failed",
                message: "Username and password are required",
            });
        }

        // Check if user already exists
        const existingUser = await checkIfUserExists(username);
        if (existingUser) {
            return Promise.reject({
                status: "failed",
                message: "Username already exists",
            });
        }

        // Create new user
        const user = await createUser(username, password, role);

        if (!user) {
            return Promise.reject({
                status: "failed",
                message: "Failed to create user",
            });
        }

        // Generate token
        const token = generateJWTToken(user);

        if (!token) {
            return Promise.reject({
                status: "failed",
                message: "Failed to generate token",
            });
        }

        return Promise.resolve({
            status: "success",
            message: "User created successfully",
            token: token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            }
        });

    } catch (err) {
        console.error("Error during registration:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred during registration",
        });
    }
};

module.exports = { registerUser };
