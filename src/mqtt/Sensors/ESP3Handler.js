// src/mqtt/sensors/ESP3Handler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');

class ESP3Handler extends BaseSensorHandler {
    async handleESP3Data(topic, messageValue) {
        console.log(`\n🚨 ========== ESP3 ALERT ==========`);
        console.log(`🚨 Value: ${messageValue}`);
        console.log(`🚨 Active users: ${this.activeUsers.size}`);

        try {
            const validation = this.validateNumeric(messageValue);
            if (!validation.valid) return;

            const value = validation.value;
            await this.updateSensorCache('esp3_data', value);

            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const payload = {
                        message: `ESP3 Data Alert: Received value ${value}`,
                        value: value,
                        alert_type: 'ESP3_PERIODIC_DATA',
                        severity: 'info',
                        location
                    };

                    this.io.to(`location_${location}`).emit('esp3Alert', payload);
                    this.io.to(`user_${userId}`).emit('esp3Alert', payload);
                }
            }

            console.log(`🚨 ========== END ESP3 ALERT ==========\n`);
        } catch (error) {
            console.error(`❌ Error handling ESP3:`, error);
        }
    }
}

module.exports = ESP3Handler;
