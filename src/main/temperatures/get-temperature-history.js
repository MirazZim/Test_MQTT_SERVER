// main/temperatures/get-temperature-history.js
// ✅ UPDATED FOR redesigned_iot_database schema
const { getHistoryForDays, getHistoryForUserAndDays } = require("../../models/Temperature");

const fetchTemperatureHistory = async (userRole, userId, days) => {
    console.log(`🔵 [Temp History] Fetching ${days} days - Role: ${userRole}, UserID: ${userId}`);
    try {
        const history = userRole === "admin"
            ? await getHistoryForDays(days)
            : await getHistoryForUserAndDays(userId, days);
        console.log(`✅ [Temp History] Retrieved ${history.length} history records`);
        return history;
    } catch (error) {
        console.error(`❌ [Temp History] Error:`, error.message);
        throw error;
    }
};

const getTemperatureHistory = async (userData, options = {}) => {
    const { role, id } = userData;
    const { days = 7 } = options;
    console.log(`🔵 [Temp History Service] Request from user ${id} for ${days} days`);

    try {
        const history = await fetchTemperatureHistory(role, id, days);
        console.log(`✅ [Temp History Service] Successfully retrieved history`);
        return Promise.resolve({
            status: "success",
            message: `Temperature history for ${days} days`,
            history: history,
        });
    } catch (err) {
        console.error("❌ [Temp History Service] Error:", err.message);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving history",
        });
    }
};

module.exports = { getTemperatureHistory };
