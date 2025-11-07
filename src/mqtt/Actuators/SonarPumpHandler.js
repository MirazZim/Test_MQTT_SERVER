// mqtt/sensors/SonarPumpHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class SonarPumpHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [SonarPumpHandler] Initialized`);
    }

    async handleSonarPumpData(topic, payload) {
        console.log(`\n💧 ========== PUMP CONTROL ==========`);
        console.log(`💧 Payload received: ${payload}`);

        const isPumpOn = payload === 'PO';
        const state = isPumpOn ? 1 : 0;

        console.log(`💧 Pump State: ${isPumpOn ? 'ON' : 'OFF'} (payload: ${payload})`);
        this.updateCache('pump_state', payload);

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
             VALUES (?, ?, 'sonar_pump', ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), state = VALUES(state), timestamp = NOW()`,
                        [userId, roomId, isPumpOn ? 'ON' : 'OFF', isPumpOn ? '💧 Water level low, Pump is ON' : '✅ Water level normal, Pump is Off', state]
                    );

                    console.log(`✅ [SonarPumpHandler] Updated actuator_states for user ${userId}, room ${roomId}`);
                }

                // ✅ Emit to frontend
                this.io.to(`user_${userId}`).emit('pumpUpdate', {
                    state: payload,
                    isPumpOn: isPumpOn,
                    timestamp: new Date()
                });
                console.log(`📡 [SonarPumpHandler] Emitted to user ${userId}: ${payload}`);
            } catch (error) {
                console.error(`❌ [SonarPumpHandler] Error:`, error.message);
            }
        }

        console.log(`💧 ========== END PUMP CONTROL ==========\n`);
    }
}

module.exports = SonarPumpHandler;
