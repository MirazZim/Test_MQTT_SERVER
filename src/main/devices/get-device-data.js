const { userHasAccess, getMessages } = require("../../models/Device");

const checkDeviceAccess = async (userRole, userId, deviceId) => {
    try {
        const hasAccess = userRole === "admin" || (await userHasAccess(userId, deviceId));
        return hasAccess;
    } catch (error) {
        throw error;
    }
};

const fetchDeviceData = async (deviceId) => {
    try {
        const data = await getMessages(deviceId);
        return data;
    } catch (error) {
        throw error;
    }
};

const getDeviceData = async (userData, requestData) => {
    const { role, id } = userData;
    const { deviceId } = requestData;

    try {
        const hasAccess = await checkDeviceAccess(role, id, deviceId);

        if (!hasAccess) {
            return Promise.reject({
                status: "failed",
                message: "Access denied",
            });
        }

        const data = await fetchDeviceData(deviceId);

        return Promise.resolve({
            status: "success",
            message: "Device data retrieved successfully",
            data: data,
        });

    } catch (err) {
        console.error("Error getting device data:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving device data",
        });
    }
};

module.exports = { getDeviceData };
