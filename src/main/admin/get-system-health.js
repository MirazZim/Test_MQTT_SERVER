const Admin = require("../../models/admin");

const getSystemHealth = async () => {
    try {
        // Get all system health data
        const activeDevices = await Admin.getActiveDevicesCount();
        const totalDevices = await Admin.getTotalDevicesCount();
        const recentMeasurements = await Admin.getRecentMeasurementsCount();
        const mqttConnections = await Admin.getMqttConnections();
        const anomalies = await Admin.getAnomaliesCount();
        const usersCount = await Admin.getUsersCount();

        const onlineUsers = await Admin.getOnlineUsersCount();
        // Process MQTT connections data
        const mqttData = mqttConnections.reduce((acc, item) => {
            acc[item.action] = item.count;
            return acc;
        }, {});

        const healthData = {
            devices: {
                active: activeDevices.active_sensors,
                total: totalDevices.total_sensors,
                offline: totalDevices.total_sensors - activeDevices.active_sensors
            },
            users: {
                active: onlineUsers.online_users, // NEW: Get from database
                total: usersCount.total
            },
            measurements: {
                recent: recentMeasurements.recent_measurements
            },
            mqtt: mqttData,
            anomalies: anomalies.anomalies,
            timestamp: new Date()
        };

        return {
            status: "success",
            message: "System health retrieved successfully",
            data: healthData
        };

    } catch (error) {
        console.error("Error getting system health:", error);
        return {
            status: "error",
            message: error.message || "Failed to get system health"
        };
    }
};

module.exports = { getSystemHealth };
