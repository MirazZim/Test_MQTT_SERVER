const getLatestTemperature = async (userData) => {
    const { role, id } = userData;

    try {
        const latest = await fetchLatestTemperature(role, id);

        return Promise.resolve({
            status: "success",
            message: "Latest temperature retrieved successfully",
            temperature: latest, // Make sure this matches what React expects
        });

    } catch (err) {
        console.error("Error getting latest temperature:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving latest temperature",
        });
    }
};
