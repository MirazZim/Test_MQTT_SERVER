// main/temperatures/get-all-temperatures.js
// ✅ UPDATED FOR redesigned_iot_database schema
const { getAll, getAllForUser } = require("../../models/Temperature");

const fetchAllTemperatures = async (userRole, userId) => {
    console.log(`🔵 [Get All Temps] Fetching temperatures - Role: ${userRole}, UserID: ${userId}`);
    try {
        const temps = userRole === "admin" ? await getAll() : await getAllForUser(userId);
        console.log(`✅ [Get All Temps] Fetched ${temps.length} temperature records`);
        return temps;
    } catch (error) {
        console.error(`❌ [Get All Temps] Error:`, error.message);
        throw error;
    }
};

const getAllTemperatures = async (userData) => {
    const { role, id } = userData;
    console.log(`🔵 [Get All Temps Service] Request from user ${id} (${role})`);

    try {
        const temperatures = await fetchAllTemperatures(role, id);
        console.log(`✅ [Get All Temps Service] Successfully retrieved temperatures`);
        return Promise.resolve({
            status: "success",
            message: "Temperatures retrieved successfully",
            temperatures: temperatures,
        });
    } catch (err) {
        console.error("❌ [Get All Temps Service] Error:", err.message);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving temperatures",
        });
    }
};

module.exports = { getAllTemperatures };
