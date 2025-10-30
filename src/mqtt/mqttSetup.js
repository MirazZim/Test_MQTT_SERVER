const EnhancedMqttHandler = require("./EnhancedMqttHandler");
const SpatialTemperatureController = require("./spatialTemperatureController");

const initializeMQTT = (io) => {
    const mqttClient = new EnhancedMqttHandler(io);
    mqttClient.connect();

    // Initialize spatial temperature controller
    const spatialController = new SpatialTemperatureController(io);
    spatialController.connect();

    // Handle graceful shutdown
    const handleShutdown = () => {
        mqttClient.stopSimulation();
        process.exit();
    };

    process.on("SIGINT", handleShutdown);
    process.on("SIGTERM", handleShutdown);

    return {
        mqttClient,
        spatialController
    };
};

module.exports = { initializeMQTT };
