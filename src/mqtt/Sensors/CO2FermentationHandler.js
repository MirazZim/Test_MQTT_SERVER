// src/mqtt/sensors/CO2FermentationHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');

class CO2FermentationHandler extends BaseSensorHandler {
    async handleCO2FermentationStatus(topic, messageValue) {
        console.log(`\n🫧⚗️ ========== CO2 FERMENTATION ==========`);
        console.log(`🫧⚗️ Value: ${messageValue}`);
        console.log(`🫧⚗️ Active users: ${this.activeUsers.size}`);

        try {
            const status = messageValue.toString().trim();
            await this.updateSensorCache('co2_fermentation_status', status);

            let statusMessage = status === 'AF' ? 'Fermentation Going' : 'Fermentation is OFF, Something is Wrong';
            let fermentationActive = status === 'AF';

            console.log(`🫧 Status: ${statusMessage}`);

            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const payload = {
                        status,
                        message: statusMessage,
                        fermentationActive,
                        location
                    };

                    this.io.to(`location_${location}`).emit('co2FermentationStatus', payload);
                    this.io.to(`user_${userId}`).emit('co2FermentationStatus', payload);
                }
            }

            console.log(`🫧⚗️ ========== END CO2 FERMENTATION ==========\n`);
        } catch (error) {
            console.error(`❌ Error handling CO2 fermentation:`, error);
        }
    }
}

module.exports = CO2FermentationHandler;
