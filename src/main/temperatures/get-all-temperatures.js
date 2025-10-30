const { getAll, getAllForUser } = require("../../models/Temperature");

const fetchAllTemperatures = async (userRole, userId) => {
    try {
        const temps = userRole === "admin" ? await getAll() : await getAllForUser(userId);
        return temps;
    } catch (error) {
        throw error;
    }
};

const getAllTemperatures = async (userData) => {
    const { role, id } = userData;

    try {
        const temperatures = await fetchAllTemperatures(role, id);

        return Promise.resolve({
            status: "success",
            message: "Temperatures retrieved successfully",
            temperatures: temperatures,
        });

    } catch (err) {
        console.error("Error getting all temperatures:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving temperatures",
        });
    }
};

module.exports = { getAllTemperatures };
