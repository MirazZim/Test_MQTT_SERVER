// src/mqtt/sensors/SpatialSensorHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');

class SpatialSensorHandler extends BaseSensorHandler {
    async handleSpatialSensorData(topic, message) {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📡 Spatial sensor data: ${topic}`, data);

            this.io.emit("spatialSensorData", {
                topic,
                data,
                timestamp: new Date()
            });

        } catch (error) {
            console.error(`❌ Error handling spatial sensor:`, error);
        }
    }
}

module.exports = SpatialSensorHandler;
