// src/mqtt/sensors/SonarPumpHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');

class SonarPumpHandler extends BaseSensorHandler {
    async handleSonarPumpStatus(topic, messageValue) {
        console.log(`\n💦 ========== SONAR PUMP STATUS ==========`);
        console.log(`💦 Value: ${messageValue}`);
        console.log(`💦 Active users: ${this.activeUsers.size}`);

        try {
            const status = messageValue.toString().trim();
            await this.updateSensorCache('sonar_pump_status', status);

            let statusMessage = status === 'PO' ? 'Water Level Low, Pump is ON' : 'Water Level Normal, Pump OFF';
            let pumpState = status === 'PO';

            console.log(`💦 Status: ${statusMessage}`);

            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const payload = {
                        status,
                        message: statusMessage,
                        pumpState,
                        location
                    };

                    this.io.to(`location_${location}`).emit('sonarPumpStatus', payload);
                    this.io.to(`user_${userId}`).emit('sonarPumpStatus', payload);
                }
            }

            console.log(`💦 ========== END SONAR PUMP STATUS ==========\n`);
        } catch (error) {
            console.error(`❌ Error handling sonar pump:`, error);
        }
    }
}

module.exports = SonarPumpHandler;
