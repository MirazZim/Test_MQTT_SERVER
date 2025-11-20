// ============================================
// UPDATED FanSpeedControlHandler.js
// Location: src/mqtt/Actuators/FanSpeedControlHandler.js
// ============================================

const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class FanSpeedControlHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [FanSpeedControlHandler] Initialized with Audit Logging`);
    }

    async handleFanSpeedData(topic, payload) {
        console.log(`\n🌀 ========== FAN SPEED CONTROL ==========`);
        console.log(`🌀 Topic: ${topic}, Payload: ${payload}`);

        const speed = parseInt(payload);

        // ✅ FIX #1: Added missing closing brace
        if (isNaN(speed) || speed < 0 || speed > 100) {
            console.warn(`⚠️ [FanSpeedControlHandler] Invalid speed: ${payload} (must be 0-100)`);
            return;
        }

        console.log(`🌀 Fan Speed: ${speed}%`);
        this.updateCache('fan_speed', speed);

        // ✅ FIX #3: Process each unique room only once (prevent race condition)
        const processedRooms = new Map(); // roomCode -> {roomId, userId, username}

        for (const [userId, rooms] of this.activeUsers) {
            for (const roomCode of rooms) {
                if (!processedRooms.has(roomCode)) {
                    // Get user info for the first user in this room
                    try {
                        const [userRows] = await pool.execute(
                            'SELECT username FROM users WHERE id = ? LIMIT 1',
                            [userId]
                        );

                        if (userRows.length > 0) {
                            const [roomRows] = await pool.execute(
                                'SELECT id FROM rooms WHERE room_code = ? AND user_id = ? LIMIT 1',
                                [roomCode, userId]
                            );

                            if (roomRows.length > 0) {
                                processedRooms.set(roomCode, {
                                    roomId: roomRows[0].id,
                                    userId: userId,
                                    username: userRows[0].username
                                });
                            }
                        }
                    } catch (error) {
                        console.error(`❌ [FanSpeedControlHandler] Error getting room info for ${roomCode}:`, error.message);
                    }
                }
            }
        }

        // Process each unique room
        for (const [roomCode, roomInfo] of processedRooms) {
            try {
                await this.processFanSpeedForRoom(topic, speed, roomCode, roomInfo);
            } catch (error) {
                console.error(`❌ [FanSpeedControlHandler] Error processing room ${roomCode}:`, error.message);
            }
        }

        console.log(`🌀 ========================================\n`);
    }

    async processFanSpeedForRoom(topic, speed, roomCode, roomInfo) {
        const { roomId, userId, username } = roomInfo;

        console.log(`\n🔍 Processing room: ${roomCode} (User: ${username})`);

        // ✅ FIX #4: Use database transaction for data consistency
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // Get actuator matching the topic and room
            const [actuatorRows] = await connection.execute(
                `SELECT id, actuator_name, current_state 
                 FROM actuators 
                 WHERE mqtt_topic = ? AND room_id = ? AND is_active = 1 
                 LIMIT 1`,
                [topic, roomId]
            );

            if (actuatorRows.length === 0) {
                console.log(`⚠️ No active actuator found for topic: ${topic} in room: ${roomCode}`);
                await connection.rollback();
                return;
            }

            const actuator = actuatorRows[0];
            const actuatorId = actuator.id;
            const actuatorName = actuator.actuator_name;
            const oldState = actuator.current_state || '0';

            console.log(`✅ Found actuator: ${actuatorName} (ID: ${actuatorId})`);
            console.log(`📊 Old State: ${oldState}%, New State: ${speed}%`);

            // Check if state actually changed
            if (oldState === speed.toString()) {
                console.log(`ℹ️ No state change detected. Skipping update.`);
                await connection.rollback();
                return;
            }

            // ✅ FIX #2: Update database FIRST, then log audit

            // 1. Update actuators table
            await connection.execute(
                'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                [speed.toString(), actuatorId]
            );
            console.log(`✅ Updated actuators table`);

            // 2. Log to actuator_control_logs
            await connection.execute(
                `INSERT INTO actuator_control_logs 
                 (actuator_id, command_value, command_source, user_id, executed_at) 
                 VALUES (?, ?, 'manual', ?, NOW())`,
                [actuatorId, speed, userId]
            );
            console.log(`✅ Logged to actuator_control_logs`);

            // 3. Insert/Update actuator_states
            const [existingState] = await connection.execute(
                `SELECT id FROM actuator_states 
                 WHERE user_id = ? AND room_id = ? AND actuator_type = ?
                 LIMIT 1`,
                [userId, roomId, actuatorName]
            );

            if (existingState.length > 0) {
                await connection.execute(
                    `UPDATE actuator_states 
                     SET status = ?, message = ?, state = 1, timestamp = NOW()
                     WHERE id = ?`,
                    [`${speed}%`, `Fan speed set to ${speed}%`, existingState[0].id]
                );
            } else {
                await connection.execute(
                    `INSERT INTO actuator_states 
                     (user_id, room_id, actuator_type, status, message, state, timestamp)
                     VALUES (?, ?, ?, ?, ?, 1, NOW())`,
                    [userId, roomId, actuatorName, `${speed}%`, `Fan speed set to ${speed}%`]
                );
            }
            console.log(`✅ Updated actuator_states`);

            // 4. NOW log to user_audit_log (after successful DB updates)
            await connection.execute(
                `INSERT INTO user_audit_log 
                 (user_id, room_id, action_type, action_description, entity_type, entity_id, old_value, new_value, created_at)
                 VALUES (?, ?, 'fan_speed_change', ?, 'actuator', ?, ?, ?, NOW())`,
                [
                    userId,
                    roomId,
                    `${username} changed fan speed in ${roomCode} from ${oldState}% to ${speed}%`,
                    actuatorId,
                    oldState,
                    speed.toString()
                ]
            );
            console.log(`✅ Logged to user_audit_log`);

            // Commit transaction
            await connection.commit();
            console.log(`✅ Transaction committed successfully`);

            // Emit Socket.IO event to all users in the room
            this.io.to(`room_${roomCode}`).emit('fanSpeedUpdated', {
                roomCode,
                actuatorId,
                actuatorName,
                oldSpeed: parseInt(oldState),
                newSpeed: speed,
                updatedBy: username,
                timestamp: new Date().toISOString()
            });
            console.log(`📡 Emitted fanSpeedUpdated to room_${roomCode}`);

            // Emit admin notification
            this.io.to('admin_room').emit('adminAuditLog', {
                type: 'fan_speed_change',
                user: username,
                userId,
                roomCode,
                roomId,
                actuatorName,
                oldValue: oldState,
                newValue: speed.toString(),
                timestamp: new Date().toISOString()
            });
            console.log(`📡 Emitted adminAuditLog notification`);

        } catch (error) {
            await connection.rollback();
            console.error(`❌ [FanSpeedControlHandler] Transaction failed:`, error);
            throw error;
        } finally {
            connection.release();
        }
    }

    updateCache(key, value) {
        if (this.sensorData) {
            this.sensorData[key] = value;
        }
    }
}

module.exports = FanSpeedControlHandler;
