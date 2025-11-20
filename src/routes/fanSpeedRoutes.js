// ============================================
// UPDATED API ENDPOINT - Fan Speed Control
// Location: src/routes/fanSpeedRoutes.js
// ============================================

const express = require('express');
const { adminOrUser } = require('../middleware/auth');
const pool = require('../config/db');

const fanSpeedRouter = express.Router();

/**
 * POST /api/fan-speed/control
 * Control fan speed with audit logging
 */
fanSpeedRouter.post('/control', adminOrUser, async (req, res) => {
    const { roomCode, speed } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    console.log(`\n🌀 [Route POST /fan-speed/control] User: ${username} (${userId}), Room: ${roomCode}, Speed: ${speed}%`);

    // Validate input
    if (!roomCode) {
        return res.status(400).json({
            status: 'failed',
            message: 'Room code is required'
        });
    }

    if (speed === undefined || speed === null) {
        return res.status(400).json({
            status: 'failed',
            message: 'Speed value is required'
        });
    }

    const speedValue = parseInt(speed);
    if (isNaN(speedValue) || speedValue < 0 || speedValue > 100) {
        return res.status(400).json({
            status: 'failed',
            message: 'Speed must be between 0 and 100'
        });
    }

    // ✅ FIX #4: Use database transaction
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Get room details
        const [roomRows] = await connection.execute(
            'SELECT id FROM rooms WHERE room_code = ? AND user_id = ? LIMIT 1',
            [roomCode, userId]
        );

        if (roomRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'failed',
                message: 'Room not found or access denied'
            });
        }

        const roomId = roomRows[0].id;

        // Get fan speed actuator
        const [actuatorRows] = await connection.execute(
            `SELECT id, actuator_name, mqtt_topic, current_state 
             FROM actuators 
             WHERE room_id = ? 
             AND actuator_type_id = (SELECT id FROM actuator_types WHERE type_code = 'fan_speed_control')
             AND is_active = 1
             LIMIT 1`,
            [roomId]
        );

        if (actuatorRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'failed',
                message: 'Fan speed controller not found in this room'
            });
        }

        const actuator = actuatorRows[0];
        const actuatorId = actuator.id;
        const actuatorName = actuator.actuator_name;
        const mqttTopic = actuator.mqtt_topic;
        const oldSpeed = actuator.current_state || '0';

        console.log(`✅ Found actuator: ${actuatorName} (ID: ${actuatorId})`);
        console.log(`📊 Old Speed: ${oldSpeed}%, New Speed: ${speedValue}%`);

        // ✅ FIX #2: Update database FIRST

        // 1. Update actuators table
        await connection.execute(
            'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
            [speedValue.toString(), actuatorId]
        );

        // 2. Log to actuator_control_logs
        await connection.execute(
            `INSERT INTO actuator_control_logs 
             (actuator_id, command_value, command_source, user_id, executed_at) 
             VALUES (?, ?, 'manual', ?, NOW())`,
            [actuatorId, speedValue, userId]
        );

        // 3. Update actuator_states
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
                [`${speedValue}%`, `Fan speed set to ${speedValue}%`, existingState[0].id]
            );
        } else {
            await connection.execute(
                `INSERT INTO actuator_states 
                 (user_id, room_id, actuator_type, status, message, state, timestamp)
                 VALUES (?, ?, ?, ?, ?, 1, NOW())`,
                [userId, roomId, actuatorName, `${speedValue}%`, `Fan speed set to ${speedValue}%`]
            );
        }

        // 4. Log to user_audit_log (only if state changed)
        if (oldSpeed !== speedValue.toString()) {
            await connection.execute(
                `INSERT INTO user_audit_log 
                 (user_id, room_id, action_type, action_description, entity_type, entity_id, old_value, new_value, created_at)
                 VALUES (?, ?, 'fan_speed_change', ?, 'actuator', ?, ?, ?, NOW())`,
                [
                    userId,
                    roomId,
                    `${username} changed fan speed in ${roomCode} from ${oldSpeed}% to ${speedValue}%`,
                    actuatorId,
                    oldSpeed,
                    speedValue.toString()
                ]
            );
            console.log(`✅ Audit log created`);
        }

        // Commit transaction
        await connection.commit();
        console.log(`✅ Transaction committed`);

        // ✅ FIX #5: Improved MQTT error handling
        let mqttPublished = false;
        if (mqttTopic) {
            try {
                const { mqttClient } = require('../server');
                if (mqttClient?.publishToTopic) {
                    mqttPublished = mqttClient.publishToTopic(mqttTopic, speedValue.toString());
                    if (mqttPublished) {
                        console.log(`✅ Published to MQTT topic: ${mqttTopic}`);
                    } else {
                        console.warn(`⚠️ MQTT publish returned false for topic: ${mqttTopic}`);
                    }
                } else {
                    console.warn(`⚠️ MQTT client unavailable`);
                }
            } catch (mqttError) {
                console.error(`❌ MQTT publish error:`, mqttError);
                // Don't fail the API response, just log the error
            }
        }

        // Get Socket.IO instance and broadcast
        try {
            const { getIO } = require('../server');
            const io = getIO();

            if (io) {
                // Broadcast to room
                io.to(`room_${roomCode}`).emit('fanSpeedUpdated', {
                    roomCode,
                    actuatorId,
                    actuatorName,
                    oldSpeed: parseInt(oldSpeed),
                    newSpeed: speedValue,
                    updatedBy: username,
                    timestamp: new Date().toISOString()
                });

                // Notify admins
                io.to('admin_room').emit('adminAuditLog', {
                    type: 'fan_speed_change',
                    user: username,
                    userId,
                    roomCode,
                    roomId,
                    actuatorName,
                    oldValue: oldSpeed,
                    newValue: speedValue.toString(),
                    timestamp: new Date().toISOString()
                });

                console.log(`📡 Broadcasted to Socket.IO`);
            }
        } catch (ioError) {
            console.error(`⚠️ Socket.IO broadcast error:`, ioError);
            // Don't fail the response
        }

        return res.status(200).json({
            status: 'success',
            message: 'Fan speed updated successfully',
            data: {
                roomCode,
                roomId,
                actuatorId,
                actuatorName,
                oldSpeed: parseInt(oldSpeed),
                newSpeed: speedValue,
                mqttPublished,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error(`❌ [Route POST /fan-speed/control] Error:`, error);

        return res.status(500).json({
            status: 'failed',
            message: 'Failed to update fan speed',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

/**
 * GET /api/fan-speed/history
 * Get fan speed change history with audit logs
 */
fanSpeedRouter.get('/history', adminOrUser, async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { roomCode, limit = 50, offset = 0 } = req.query;

    console.log(`🔍 [Route GET /fan-speed/history] User: ${userId}, Room: ${roomCode}`);

    try {
        // ✅ FIX #9: Safe limit with whitelist approach
        const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 1000);
        const safeOffset = Math.max(parseInt(offset) || 0, 0);

        let query = `
            SELECT 
                ual.id,
                ual.user_id,
                u.username,
                ual.room_id,
                r.room_code,
                ual.action_description,
                ual.entity_id as actuator_id,
                ual.old_value,
                ual.new_value,
                ual.created_at
            FROM user_audit_log ual
            INNER JOIN users u ON ual.user_id = u.id
            INNER JOIN rooms r ON ual.room_id = r.id
            WHERE ual.action_type = 'fan_speed_change'
        `;

        const params = [];

        // Non-admin users can only see their own rooms
        if (userRole !== 'admin') {
            query += ` AND ual.user_id = ?`;
            params.push(userId);
        }

        // Filter by room if specified
        if (roomCode) {
            query += ` AND r.room_code = ?`;
            params.push(roomCode);
        }

        query += ` ORDER BY ual.created_at DESC LIMIT ? OFFSET ?`;
        params.push(safeLimit, safeOffset);

        const [rows] = await pool.execute(query, params);

        return res.status(200).json({
            status: 'success',
            data: {
                history: rows,
                limit: safeLimit,
                offset: safeOffset,
                count: rows.length
            }
        });

    } catch (error) {
        console.error(`❌ [Route GET /fan-speed/history] Error:`, error);

        return res.status(500).json({
            status: 'failed',
            message: 'Failed to fetch history',
            error: error.message
        });
    }
});

/**
 * GET /api/fan-speed/current/:roomCode
 * Get current fan speed for a room
 */
fanSpeedRouter.get('/current/:roomCode', adminOrUser, async (req, res) => {
    const userId = req.user.id;
    const { roomCode } = req.params;

    console.log(`🔍 [Route GET /fan-speed/current] User: ${userId}, Room: ${roomCode}`);

    try {
        // Get room
        const [roomRows] = await pool.execute(
            'SELECT id FROM rooms WHERE room_code = ? AND user_id = ? LIMIT 1',
            [roomCode, userId]
        );

        if (roomRows.length === 0) {
            return res.status(404).json({
                status: 'failed',
                message: 'Room not found or access denied'
            });
        }

        const roomId = roomRows[0].id;

        // Get current fan speed
        const [actuatorRows] = await pool.execute(
            `SELECT 
                a.id,
                a.actuator_name,
                a.mqtt_topic,
                a.current_state,
                a.updated_at
             FROM actuators a
             WHERE a.room_id = ? 
             AND a.actuator_type_id = (SELECT id FROM actuator_types WHERE type_code = 'fan_speed_control')
             AND a.is_active = 1
             LIMIT 1`,
            [roomId]
        );

        if (actuatorRows.length === 0) {
            return res.status(404).json({
                status: 'failed',
                message: 'Fan speed controller not found in this room'
            });
        }

        const actuator = actuatorRows[0];

        return res.status(200).json({
            status: 'success',
            data: {
                roomCode,
                roomId,
                actuatorId: actuator.id,
                actuatorName: actuator.actuator_name,
                currentSpeed: parseInt(actuator.current_state || '0'),
                lastUpdated: actuator.updated_at
            }
        });

    } catch (error) {
        console.error(`❌ [Route GET /fan-speed/current] Error:`, error);

        return res.status(500).json({
            status: 'failed',
            message: 'Failed to fetch current fan speed',
            error: error.message
        });
    }
});

module.exports = fanSpeedRouter;
