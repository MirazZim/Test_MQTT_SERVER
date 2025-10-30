const Admin = require("../../models/admin");

const getAllUsersAdmin = async () => {
    try {
        const users = await Admin.getAllUsersWithStats();

        // Remove passwords from response
        const safeUsers = users.map(user => ({
            ...user,
            password: undefined
        }));

        return {
            status: "success",
            message: "Users retrieved successfully",
            users: safeUsers
        };

    } catch (error) {
        console.error("Error getting all users:", error);
        return {
            status: "error",
            message: error.message || "Failed to get users"
        };
    }
};

module.exports = { getAllUsersAdmin };
