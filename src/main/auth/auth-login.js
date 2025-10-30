const { comparePassword } = require('../../utils/bcryptOptimized');
const jwt = require("jsonwebtoken");
const db = require("../../config/db");

// Helper functions
const findByUsername = async (username) => {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
        username,
    ]);
    return rows[0];
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
        return error;
    }
};

const verifyPassword = async (plainPassword, hashedPassword) => {
    try {
        const isValid = await comparePassword(plainPassword, hashedPassword);
        return isValid;
    } catch (error) {
        return false;
    }
};

// Main function
const loginUser = async (loginData) => {
    const { username, password } = loginData;

    try {
        if (!username || !password) {
            return Promise.reject({
                status: "failed",
                message: "Username and password are required",
            });
        }

        const user = await checkIfUserExists(username);

        if (user === false) {
            return Promise.reject({
                status: "failed",
                message: "Invalid credentials",
            });
        }

        const isPasswordValid = await verifyPassword(password, user.password);

        if (!isPasswordValid) {
            return Promise.reject({
                status: "failed",
                message: "Invalid credentials",
            });
        }

        await setUserActiveStatus(user.id, 1);

        const token = generateJWTToken(user);

        if (!token) {
            return Promise.reject({
                status: "failed",
                message: "Failed to generate token",
            });
        }

        return Promise.resolve({
            status: "success",
            message: "Login successful",
            token: token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            }
        });

    } catch (err) {
        console.error("Error during login:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred during login",
        });
    }
};

module.exports = { loginUser };
