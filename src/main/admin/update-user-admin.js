const Admin = require("../../models/admin");

const updateUserAdmin = async (userId, userData, currentUser) => {
    try {
        const { username, role, desired_temperature, desired_humidity, is_active } = userData;

        if (!userId) {
            return {
                status: "error",
                message: "User ID is required"
            };
        }

        const result = await Admin.updateUser(userId, {
            username,
            role,
            desired_temperature,
            desired_humidity,
            is_active
        });

        if (result.affectedRows === 0) {
            return {
                status: "error",
                message: "User not found"
            };
        }

        return {
            status: "success",
            message: "User updated successfully"
        };

    } catch (error) {
        console.error("Error updating user:", error);
        return {
            status: "error",
            message: error.message || "Failed to update user"
        };
    }
};

module.exports = { updateUserAdmin };
