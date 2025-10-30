// src/mqtt/sensors/SugarFermentationHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');

class SugarFermentationHandler extends BaseSensorHandler {
    async handleSugarFermentationStatus(topic, messageValue) {
        console.log(`\n🍬⚗️ ========== SUGAR FERMENTATION ==========`);
        console.log(`🍬⚗️ Value: ${messageValue}`);
        console.log(`🍬⚗️ Active users: ${this.activeUsers.size}`);

        try {
            const status = messageValue.toString().trim();
            await this.updateSensorCache('sugar_fermentation_status', status);

            let statusMessage = status === 'FFC' ? 'Fermentation Complete' : 'Fermentation Closed';
            let fermentationComplete = status === 'FFC';

            console.log(`🍬 Status: ${statusMessage}`);

            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const payload = {
                        status,
                        message: statusMessage,
                        fermentationComplete,
                        location
                    };

                    this.io.to(`location_${location}`).emit('sugarFermentationStatus', payload);
                    this.io.to(`user_${userId}`).emit('sugarFermentationStatus', payload);
                }
            }

            console.log(`🍬⚗️ ========== END SUGAR FERMENTATION ==========\n`);
        } catch (error) {
            console.error(`❌ Error handling sugar fermentation:`, error);
        }
    }
}

module.exports = SugarFermentationHandler;
