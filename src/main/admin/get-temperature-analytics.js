const Admin = require("../../models/admin");

const getTemperatureAnalytics = async (queryParams) => {
    try {
        const { days = 7 } = queryParams;

        // Get temperature trends
        const { result: trends, params, whereClause } = await Admin.getTemperatureTrends(queryParams);

        // Get location statistics
        const locationStats = await Admin.getLocationStats(whereClause, params);

        // Get temperature anomalies
        const anomalies = await Admin.getTemperatureAnomalies(whereClause, params);

        // Get temperature alerts
        const alerts = await Admin.getTemperatureAlerts(whereClause, params);

        // Calculate summary
        const summary = {
            totalReadings: trends.reduce((sum, t) => sum + t.reading_count, 0),
            avgTemperature: locationStats.length > 0 ?
                locationStats.reduce((sum, l) => sum + l.avg_temp, 0) / locationStats.length : 0,
            alertCount: alerts.length,
            anomalyCount: anomalies.length,
            locationCount: locationStats.length
        };

        return {
            status: "success",
            message: "Temperature analytics retrieved successfully",
            data: {
                trends,
                locationStats,
                anomalies,
                alerts,
                summary
            }
        };

    } catch (error) {
        console.error("Error getting temperature analytics:", error);
        return {
            status: "error",
            message: error.message || "Failed to get temperature analytics"
        };
    }
};

module.exports = { getTemperatureAnalytics };
