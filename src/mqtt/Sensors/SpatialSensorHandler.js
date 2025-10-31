// mqtt/sensors/SpatialSensorHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');

class SpatialSensorHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [SpatialSensorHandler] Initialized`);
    }

    async handleSpatialData(sensorId, x, y, value, type) {
        console.log(`📍 [SpatialSensorHandler] Sensor ${sensorId} at (${x},${y}): ${value} ${type}`);

        const spatialData = {
            sensorId,
            x,
            y,
            value,
            type,
            timestamp: new Date()
        };

        for (const [userId] of this.activeUsers) {
            this.io.to(`user_${userId}`).emit('spatialSensorUpdate', spatialData);
        }
    }
}

module.exports = SpatialSensorHandler;
