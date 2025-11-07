// mqtt/sensors/CO2FermentationHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class CO2FermentationHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [CO2FermentationHandler] Initialized`);
    }

    async handleCO2FermentationData(topic, payload) {
        console.log(`\n🫧 ========== CO2 FERMENTATION ==========`);
        console.log(`🫧 Payload received: ${payload}`);

        const isFermentationGoing = payload === 'AF';

        console.log(`🫧 CO2 Fermentation: ${isFermentationGoing ? 'GOING' : 'OFF'} (payload: ${payload})`);
        this.updateCache('co2_fermentation', payload);

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
             VALUES (?, ?, 'co2_fermentation', ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), state = VALUES(state), timestamp = NOW()`,
                        [userId, roomId, isFermentationGoing ? 'ACTIVE' : 'OFF',
                            isFermentationGoing ? '🫧 Fermentation going' : '⚠️ Fermentation is Off',
                            isFermentationGoing ? 1 : 0]
                    );

                    console.log(`✅ [CO2FermentationHandler] Updated actuator_states for user ${userId}, room ${roomId}`);
                }

                // ✅ Emit to frontend
                this.io.to(`user_${userId}`).emit('co2FermentationUpdate', {
                    value: payload,
                    isFermentationGoing: isFermentationGoing,
                    timestamp: new Date()
                });
                console.log(`📡 [CO2FermentationHandler] Emitted to user ${userId}: ${payload}`);
            } catch (error) {
                console.error(`❌ [CO2FermentationHandler] Error:`, error.message);
            }
        }

        console.log(`🫧 ========== END CO2 FERMENTATION ==========\n`);
    }
}

module.exports = CO2FermentationHandler;
