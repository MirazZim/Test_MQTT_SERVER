// mqtt/sensors/SugarFermentationHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class SugarFermentationHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [SugarFermentationHandler] Initialized`);
    }

    async handleSugarFermentationData(topic, payload) {
        console.log(`\n🍯 ========== SUGAR FERMENTATION ==========`);
        console.log(`🍯 Payload received: ${payload}`);

        const isFermentationComplete = payload === 'FFC';

        console.log(`🍯 Sugar Fermentation: ${isFermentationComplete ? 'COMPLETE' : 'CLOSED'} (payload: ${payload})`);
        this.updateCache('sugar_fermentation', payload);

        // ✅ Update actuator_states table
        for (const [userId, rooms] of this.activeUsers) {
            try {
                for (const roomCode of rooms) {
                    // Get room ID
                    const [roomRows] = await pool.execute(
                        'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                        [userId, roomCode]
                    );

                    if (roomRows.length === 0) continue;
                    const roomId = roomRows[0].id;

                    // Insert or update in actuator_states
                    await pool.execute(
                        `INSERT INTO actuator_states (user_id, room_id, actuator_type, status, message, state, timestamp)
             VALUES (?, ?, 'sugar_fermentation', ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), state = VALUES(state), timestamp = NOW()`,
                        [userId, roomId, isFermentationComplete ? 'COMPLETE' : 'CLOSED',
                            isFermentationComplete ? '✅ Fermentation complete' : '❌ Fermentation closed',
                            isFermentationComplete ? 1 : 0]
                    );

                    console.log(`✅ [SugarFermentationHandler] Updated actuator_states for user ${userId}, room ${roomId}`);
                }

                // ✅ Emit to frontend
                this.io.to(`user_${userId}`).emit('sugarFermentationUpdate', {
                    value: payload,
                    isFermentationComplete: isFermentationComplete,
                    timestamp: new Date()
                });
                console.log(`📡 [SugarFermentationHandler] Emitted to user ${userId}: ${payload}`);
            } catch (error) {
                console.error(`❌ [SugarFermentationHandler] Error:`, error.message);
            }
        }

        console.log(`🍯 ========== END SUGAR FERMENTATION ==========\n`);
    }
}

module.exports = SugarFermentationHandler;
