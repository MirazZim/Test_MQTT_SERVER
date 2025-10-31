// mqtt/sensors/ESP3Handler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');

class ESP3Handler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [ESP3Handler] Initialized`);
    }

    async handleESP3Data(topic, payload) {
        console.log(`\n🚨 ========== ESP3 ALERT ==========`);
        const value = parseFloat(payload);

        if (!Number.isFinite(value)) {
            console.warn(`⚠️ [ESP3Handler] Invalid value: ${payload}`);
            return;
        }

        console.log(`🚨 ESP3 Value: ${value}`);
        console.log(`🚨 Active users: ${this.activeUsers.size}`);

        this.updateCache('esp3_data', value);

        // Emit alert to all active users
        for (const [userId] of this.activeUsers) {
            this.io.to(`user_${userId}`).emit('esp3Alert', {
                value: value,
                timestamp: new Date(),
                alert_level: value > 100 ? 'high' : 'normal'
            });
        }

        console.log(`🚨 ========== END ESP3 ALERT ==========\n`);
    }
}

module.exports = ESP3Handler;
