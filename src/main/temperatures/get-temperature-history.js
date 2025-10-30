const { getHistoryForDays, getHistoryForUserAndDays } = require("../../models/Temperature");

const fetchTemperatureHistory = async (userRole, userId, days) => {
    try {
        const history = userRole === "admin"
            ? await getHistoryForDays(days)
            : await getHistoryForUserAndDays(userId, days);
        return history;
    } catch (error) {
        throw error;
    }
};

const getTemperatureHistory = async (userData, requestData) => {
    const { role, id } = userData;
    const { days = 7 } = requestData;

    try {
        const history = await fetchTemperatureHistory(role, id, days);

        return Promise.resolve({
            status: "success",
            message: "Temperature history retrieved successfully",
            history: history,
        });

    } catch (err) {
        console.error("Error getting temperature history:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving temperature history",
        });
    }
};

module.exports = { getTemperatureHistory };
