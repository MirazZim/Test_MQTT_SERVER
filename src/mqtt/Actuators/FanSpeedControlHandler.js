// src/mqtt/Actuators/FanSpeedControlHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class FanSpeedControlHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [FanSpeedControlHandler] Initialized`);
    }

    async handleFanSpeedData(topic, payload) {
        console.log(`\n🌀 ========== FAN SPEED CONTROL ==========`);
        console.log(`🌀 Topic: ${topic}, Payload: ${payload}`);

        const speed = parseInt(payload);

        // Validate speed range (0-100)
        if (isNaN(speed) || speed < 0 || speed > 100) {
            console.warn(`⚠️ [FanSpeedControlHandler] Invalid speed: ${payload} (must be 0-100)`);
            return;
        }

        console.log(`🌀 Fan Speed: ${speed}%`);
        this.updateCache('fan_speed', speed);

        // ✅ Determine status based on speed
        let status = '';
        let statusMessage = '';

        if (speed === 0) {
            status = 'OFF';
            statusMessage = '⏸️ Fan is OFF';
        } else if (speed <= 33) {
            status = 'LOW';
            statusMessage = `🌀 Fan Speed: LOW (${speed}%)`;
        } else if (speed <= 66) {
            status = 'MEDIUM';
            statusMessage = `🌀 Fan Speed: MEDIUM (${speed}%)`;
        } else {
            status = 'HIGH';
            statusMessage = `🌀 Fan Speed: HIGH (${speed}%)`;
        }

        // ✅ Process for all active users and rooms
        for (const [userId, rooms] of this.activeUsers) {
            try {
                for (const roomCode of rooms) {
                    // Get room details
                    const [roomRows] = await pool.execute(
                        'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                        [userId, roomCode]
                    );

                    if (roomRows.length === 0) continue;
                    const roomId = roomRows[0].id;

                    // Get actuator details for this room and type
                    const [actuatorRows] = await pool.execute(
                        `SELECT a.id FROM actuators a
                         INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                         WHERE a.room_id = ? AND at.type_code = 'fan_speed_control' AND a.is_active = 1
                         LIMIT 1`,
                        [roomId]
                    );

                    if (actuatorRows.length === 0) {
                        console.log(`⚠️ No fan speed actuator found for room ${roomId}`);
                        continue;
                    }

                    const actuatorId = actuatorRows[0].id;

                    // ✅ Update actuators table with current state
                    await pool.execute(
                        'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                        [speed.toString(), actuatorId]
                    );

                    // ✅ Log to actuator_control_logs
                    await pool.execute(
                        `INSERT INTO actuator_control_logs 
                         (actuator_id, command_value, command_source, executed_at)
                         VALUES (?, ?, 'mqtt', NOW())`,
                        [actuatorId, speed]
                    );

                    // ✅ Insert or update actuator_states
                    await pool.execute(
                        `INSERT INTO actuator_states 
                         (user_id, room_id, actuator_type, status, message, state, timestamp)
                         VALUES (?, ?, 'fan_speed_control', ?, ?, ?, NOW())
                         ON DUPLICATE KEY UPDATE 
                         status = VALUES(status), 
                         message = VALUES(message), 
                         state = VALUES(state), 
                         timestamp = NOW()`,
                        [userId, roomId, status, statusMessage, speed]
                    );

                    console.log(`✅ [FanSpeedControlHandler] Updated for user ${userId}, room ${roomId}, speed: ${speed}%`);
                }

                // ✅ Emit to frontend via Socket.IO
                this.io.to(`user_${userId}_${roomCode}`).emit('fanSpeedUpdate', {
                    speed: speed,
                    status: status,
                    level: speed === 0 ? 'OFF' : (speed <= 33 ? 'LOW' : (speed <= 66 ? 'MEDIUM' : 'HIGH')),
                    timestamp: new Date().toISOString()
                });

                console.log(`📡 [FanSpeedControlHandler] Emitted to user ${userId}: ${speed}%`);

            } catch (error) {
                console.error(`❌ [FanSpeedControlHandler] Error processing user ${userId}:`, error.message);
            }
        }

        console.log(`🌀 ========== END FAN SPEED CONTROL ==========\n`);
    }
}

module.exports = FanSpeedControlHandler;
