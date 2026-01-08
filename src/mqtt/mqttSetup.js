const EnhancedMqttHandler = require("./EnhancedMqttHandler");
const SpatialTemperatureController = require("./spatialTemperatureController");
const CO2SensorHandler = require("./Sensors/CO2SensorHandler");
const LevelSensorHandler = require("./Sensors/LevelSensorHandler");

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

    // Initialize standalone CO2 handler (separate from main MQTT)
    const co2Handler = new CO2SensorHandler(io);
    co2Handler.connect();
    console.log(`✅ [mqttSetup] Standalone CO2 handler initialized`);

    // Initialize standalone Level/Sonar handler (separate from main MQTT)
    const levelHandler = new LevelSensorHandler(io);
    levelHandler.connect();
    console.log(`✅ [mqttSetup] Standalone Level handler initialized`);

    // Handle graceful shutdown
    const handleShutdown = () => {
        mqttClient.stopSimulation();
        co2Handler.disconnect();
        levelHandler.disconnect();
        process.exit();
    };

    process.on("SIGINT", handleShutdown);
    process.on("SIGTERM", handleShutdown);

    return {
        mqttClient,
        spatialController,
        co2Handler,
        levelHandler
    };
};

module.exports = { initializeMQTT };
