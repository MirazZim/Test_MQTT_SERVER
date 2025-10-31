// SugarFermentationHandler.js - SIMPLE VERSION
const BaseSensorHandler = require('../base/BaseSensorHandler');

class SugarFermentationHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [SugarFermentationHandler] Initialized`);
    }

    async handleSugarFermentationData(topic, payload) {
        console.log(`\n🍯 ========== SUGAR FERMENTATION ==========`);
        console.log(`🍯 Payload received: ${payload}`);

        // ✅ Send as-is without validation
        this.updateCache('sugar_fermentation', payload);

        for (const [userId] of this.activeUsers) {
            this.io.to(`user_${userId}`).emit('sugarFermentationUpdate', {
                value: payload,
                timestamp: new Date()
            });
            console.log(`📡 [SugarFermentationHandler] Emitted to user ${userId}`);
        }

        console.log(`🍯 ========== END SUGAR FERMENTATION ==========\n`);
    }
}

module.exports = SugarFermentationHandler;
