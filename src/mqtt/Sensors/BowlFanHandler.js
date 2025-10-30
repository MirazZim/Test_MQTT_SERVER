// src/mqtt/sensors/BowlFanHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');

class BowlFanHandler extends BaseSensorHandler {
    async handleBowlFanStatus(topic, messageValue) {
        console.log(`\n🌀 ========== BOWL FAN STATUS ==========`);
        console.log(`🌀 Value: ${messageValue}`);

        try {
            const status = messageValue.toString().trim();
            await this.updateSensorCache('bowl_fan_status', status);

            let statusMessage = status === 'FO' ? 'Temp High, Fan is ON' : 'Temp Normal, Fan OFF';
            let fanState = status === 'FO';

            console.log(`🌀 Status: ${statusMessage}`);

            // Emit to all users
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const payload = {
                        status,
                        message: statusMessage,
                        fanState,
                        location
                    };

                    this.io.to(`location_${location}`).emit('bowlFanStatus', payload);
                    this.io.to(`user_${userId}`).emit('bowlFanStatus', payload);
                }
            }

            console.log(`🌀 ========== END BOWL FAN STATUS ==========\n`);
        } catch (error) {
            console.error(`❌ Error handling bowl fan:`, error);
        }
    }
}

module.exports = BowlFanHandler;
