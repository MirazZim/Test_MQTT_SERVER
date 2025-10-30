const { assignToUser } = require("../../models/Device");

const assignDeviceToUser = async (userId, deviceId) => {
    try {
        await assignToUser(userId, deviceId);
        return true;
    } catch (error) {
        throw error;
    }
};

const assignDevice = async (assignmentData) => {
    const { userId, deviceId } = assignmentData;

    try {
        await assignDeviceToUser(userId, deviceId);

        return Promise.resolve({
            status: "success",
            message: "Device assigned successfully",
        });

    } catch (err) {
        console.error("Error assigning device:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while assigning device",
        });
    }
};

module.exports = { assignDevice };
