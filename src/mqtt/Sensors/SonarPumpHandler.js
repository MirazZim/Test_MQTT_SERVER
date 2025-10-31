// mqtt/sensors/SonarPumpHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema (ACTUATOR)

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

        // ✅ Keep payload as string (PO = ON, anything else = OFF)
        const isPumpOn = payload === 'PO';
        const state = isPumpOn ? 1 : 0;

        console.log(`💧 Pump State: ${isPumpOn ? 'ON' : 'OFF'} (payload: ${payload})`);
        this.updateCache('pump_state', payload);

        for (const [userId, rooms] of this.activeUsers) {
            try {
                for (const roomCode of rooms) {
                    await this.updateActuatorState(userId, roomCode, state);
                }

                // ✅ Emit with original payload string
                this.io.to(`user_${userId}`).emit('pumpUpdate', {
                    state: payload,  // Send original string (PO or other)
                    isPumpOn: isPumpOn,  // Boolean for frontend logic
                    timestamp: new Date()
                });
                console.log(`📡 [SonarPumpHandler] Emitted to user ${userId}: ${payload}`);
            } catch (error) {
                console.error(`❌ [SonarPumpHandler] Error:`, error.message);
            }
        }

        console.log(`💧 ========== END PUMP CONTROL ==========\n`);
    }

    async updateActuatorState(userId, roomCode, state) {
        try {
            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) return;

            const [actuators] = await pool.execute(
                `SELECT a.id FROM actuators a
         INNER JOIN actuator_types at ON a.actuator_type_id = at.id
         WHERE a.user_id = ? AND a.room_id = ? AND at.type_code = 'pump' AND a.is_active = 1
         LIMIT 1`,
                [userId, rooms[0].id]
            );

            if (actuators.length === 0) return;

            await pool.execute(
                'UPDATE actuators SET current_state = ?, target_state = ?, last_command_at = NOW(3) WHERE id = ?',
                [state, state, actuators[0].id]
            );

            await pool.execute(
                'INSERT INTO actuator_control_logs (actuator_id, command_value, command_source, executed_at, success) VALUES (?, ?, ?, NOW(3), 1)',
                [actuators[0].id, state, 'mqtt']
            );

            console.log(`✅ [SonarPumpHandler] Updated actuator state: ${state}`);
        } catch (error) {
            console.error(`❌ [SonarPumpHandler] Error:`, error.message);
        }
    }
}

module.exports = SonarPumpHandler;
