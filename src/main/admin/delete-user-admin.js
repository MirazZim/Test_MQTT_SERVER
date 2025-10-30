const Admin = require("../../models/admin");

const deleteUserAdmin = async (userId, currentUser) => {
    try {
        if (!userId) {
            return {
                status: "error",
                message: "User ID is required"
            };
        }

        // Don't allow deleting self
        if (parseInt(userId) === currentUser.id) {
            return {
                status: "error",
                message: "Cannot delete your own account"
            };
        }

        const result = await Admin.deleteUser(userId);

        if (result.affectedRows === 0) {
            return {
                status: "error",
                message: "User not found"
            };
        }

        return {
            status: "success",
            message: "User deleted successfully"
        };

    } catch (error) {
        console.error("Error deleting user:", error);
        return {
            status: "error",
            message: error.message || "Failed to delete user"
        };
    }
};

module.exports = { deleteUserAdmin };
