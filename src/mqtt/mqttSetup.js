const EnhancedMqttHandler = require("./EnhancedMqttHandler");
const SpatialTemperatureController = require("./spatialTemperatureController");

const initializeMQTT = (io, app) => {
    const mqttClient = new EnhancedMqttHandler(io);
    mqttClient.connect();

    // Store MQTT handler in app for route access
    if (app) {
        app.set('mqttHandler', mqttClient);
        console.log(`✅ [mqttSetup] MQTT handler stored in app`);
    }

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
