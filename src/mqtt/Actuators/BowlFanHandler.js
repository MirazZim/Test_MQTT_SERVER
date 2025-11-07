// mqtt/sensors/BowlFanHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class BowlFanHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [BowlFanHandler] Initialized`);
    }

    async handleBowlFanData(topic, payload) {
        console.log(`\n🌀 ========== BOWL FAN CONTROL ==========`);
        console.log(`🌀 Payload received: ${payload}`);

        const isFanOn = payload === 'FO';
        const state = isFanOn ? 1 : 0;

        console.log(`🌀 Fan State: ${isFanOn ? 'ON' : 'OFF'} (payload: ${payload})`);
        this.updateCache('bowl_fan_state', payload);

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
             VALUES (?, ?, 'bowl_fan', ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), state = VALUES(state), timestamp = NOW()`,
                        [userId, roomId, isFanOn ? 'ON' : 'OFF', isFanOn ? '🌡️ Temp High, Fan is ON' : '✅ Temp normal, Fan off', state]
                    );

                    console.log(`✅ [BowlFanHandler] Updated actuator_states for user ${userId}, room ${roomId}`);
                }

                // ✅ Emit to frontend
                this.io.to(`user_${userId}`).emit('bowlFanUpdate', {
                    state: payload,
                    isFanOn: isFanOn,
                    timestamp: new Date()
                });
                console.log(`📡 [BowlFanHandler] Emitted to user ${userId}: ${payload}`);
            } catch (error) {
                console.error(`❌ [BowlFanHandler] Error:`, error.message);
            }
        }

        console.log(`🌀 ========== END BOWL FAN CONTROL ==========\n`);
    }
}

module.exports = BowlFanHandler;
