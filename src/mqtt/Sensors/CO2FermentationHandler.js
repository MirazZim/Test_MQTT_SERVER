// CO2FermentationHandler.js - SIMPLE VERSION
const BaseSensorHandler = require('../base/BaseSensorHandler');

class CO2FermentationHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [CO2FermentationHandler] Initialized`);
    }

    async handleCO2FermentationData(topic, payload) {
        console.log(`\n🫧 ========== CO2 FERMENTATION ==========`);
        console.log(`🫧 Payload received: ${payload}`);

        // ✅ Send as-is without validation
        this.updateCache('co2_fermentation', payload);

        for (const [userId] of this.activeUsers) {
            this.io.to(`user_${userId}`).emit('co2FermentationUpdate', {
                value: payload,
                timestamp: new Date()
            });
            console.log(`📡 [CO2FermentationHandler] Emitted to user ${userId}`);
        }

        console.log(`🫧 ========== END CO2 FERMENTATION ==========\n`);
    }
}

module.exports = CO2FermentationHandler;
