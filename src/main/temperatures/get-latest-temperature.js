// main/temperatures/get-latest-temperature.js
// ✅ UPDATED FOR redesigned_iot_database schema
const { getLatest, getLatestForUser } = require("../../models/Temperature");

const fetchLatestTemperature = async (userRole, userId) => {
    console.log(`🔵 [Latest Temp] Fetching latest - Role: ${userRole}, UserID: ${userId}`);
    try {
        const temp = userRole === "admin" ? await getLatest() : await getLatestForUser(userId);
        console.log(`✅ [Latest Temp] Retrieved: ${temp ? temp.value : 'None'}`);
        return temp;
    } catch (error) {
        console.error(`❌ [Latest Temp] Error:`, error.message);
        throw error;
    }
};

const getLatestTemperature = async (userData) => {
    const { role, id } = userData;
    console.log(`🔵 [Latest Temp Service] Request from user ${id} (${role})`);

    try {
        const temperature = await fetchLatestTemperature(role, id);
        console.log(`✅ [Latest Temp Service] Successfully retrieved latest temperature`);
        return Promise.resolve({
            status: "success",
            message: "Latest temperature retrieved successfully",
            temperature: temperature,
        });
    } catch (err) {
        console.error("❌ [Latest Temp Service] Error:", err.message);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving latest temperature",
        });
    }
};

module.exports = { getLatestTemperature };
