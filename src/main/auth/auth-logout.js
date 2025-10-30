const db = require("../../config/db");

const logoutUser = async (userId) => {
    try {
        if (!userId) {
            return {
                status: "error",
                message: "User ID is required"
            };
        }

        // Set user as inactive (offline)
        await db.query("UPDATE users SET is_active = 0 WHERE id = ?", [userId]);

        console.log(`User ${userId} logged out - is_active set to 0`);

        return {
            status: "success",
            message: "User logged out successfully"
        };

    } catch (error) {
        console.error("Error during logout:", error);
        return {
            status: "error",
            message: error.message || "Failed to logout user"
        };
    }
};

module.exports = { logoutUser };
