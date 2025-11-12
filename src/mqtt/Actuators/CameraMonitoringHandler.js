// src/mqtt/Actuators/CameraMonitoringHandler.js
const pool = require('../../config/db');

class CameraMonitoringHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        this.io = io;
        this.sensorData = sensorData;
        this.activeUsers = activeUsers;
        this.sensorDataMutex = sensorDataMutex;

        console.log('✅ [CameraMonitoringHandler] Initialized');
    }

    async handleCameraDetectionData(topic, payload) {
        console.log(`📹 [CameraMonitoringHandler] Topic: ${topic}, Detection: ${payload}`);

        try {
            // ✅ DYNAMIC: Find actuator by MQTT topic from database
            const [actuators] = await pool.execute(
                `SELECT a.*, at.type_code, at.type_name, r.room_name, r.room_code
                 FROM actuators a
                 INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                 LEFT JOIN rooms r ON a.room_id = r.id
                 WHERE a.mqtt_topic = ? AND a.is_active = 1
                 LIMIT 1`,
                [topic]
            );

            if (actuators.length === 0) {
                console.warn(`⚠️ [CameraMonitoringHandler] No actuator found for topic: ${topic}`);
                return;
            }

            const actuator = actuators[0];

            console.log(`📹 [CameraMonitoringHandler] Found actuator: ${actuator.actuator_name} (ID: ${actuator.id})`);

            // ✅ Store the ENTIRE message as-is in database
            const [result] = await pool.execute(
                `INSERT INTO camera_detection_logs 
                 (user_id, room_id, actuator_id, detection_message)
                 VALUES (?, ?, ?, ?)`,
                [
                    actuator.user_id,
                    actuator.room_id,
                    actuator.id,
                    payload  // Raw: "person detected in lab at 2025-11-12 09:19:15"
                ]
            );

            console.log(`✅ [CameraMonitoringHandler] Logged detection ID: ${result.insertId} - "${payload}"`);

            // Update actuator current_state
            await pool.execute(
                'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                ['active', actuator.id]
            );

            // Log to actuator_control_logs
            await pool.execute(
                `INSERT INTO actuator_control_logs 
                 (actuator_id, command_value, command_source, executed_at)
                 VALUES (?, 1, 'mqtt', NOW())`,
                [actuator.id]
            );

            // Update actuator_states table
            await this.updateActuatorState(actuator, payload);

            // Emit to frontend
            this.emitDetectionToFrontend(actuator, payload, result.insertId);

        } catch (error) {
            console.error(`❌ [CameraMonitoringHandler] Error:`, error.message);
            console.error(`❌ Stack:`, error.stack);
        }
    }

    async updateActuatorState(actuator, detectionMessage) {
        try {
            // Use type_code from actuator
            const [existingState] = await pool.execute(
                `SELECT id FROM actuator_states 
                 WHERE user_id = ? AND room_id = ? AND actuator_type = ?`,
                [actuator.user_id, actuator.room_id, actuator.type_code]
            );

            const status = 'DETECTED';

            if (existingState.length > 0) {
                await pool.execute(
                    `UPDATE actuator_states 
                     SET status = ?, message = ?, state = 1, timestamp = NOW()
                     WHERE id = ?`,
                    [status, detectionMessage, existingState[0].id]
                );
                console.log(`✅ [CameraMonitoringHandler] Updated actuator_states ID: ${existingState[0].id}`);
            } else {
                const [insertResult] = await pool.execute(
                    `INSERT INTO actuator_states 
                     (user_id, room_id, actuator_type, status, message, state, timestamp)
                     VALUES (?, ?, ?, ?, ?, 1, NOW())`,
                    [actuator.user_id, actuator.room_id, actuator.type_code, status, detectionMessage]
                );
                console.log(`✅ [CameraMonitoringHandler] Created actuator_states ID: ${insertResult.insertId}`);
            }

        } catch (error) {
            console.error(`❌ Error updating actuator state:`, error.message);
        }
    }

    emitDetectionToFrontend(actuator, detectionMessage, logId) {
        const roomCode = actuator.room_code || actuator.room_name || 'unknown';
        const timestamp = new Date().toISOString();

        const detectionData = {
            logId: logId,
            actuatorId: actuator.id,
            actuatorType: actuator.type_code,
            actuatorName: actuator.actuator_name,
            roomCode: roomCode,
            roomName: actuator.room_name,
            detectionMessage: detectionMessage,
            timestamp: timestamp,
            topic: actuator.mqtt_topic
        };

        // Emit camera detection event
        this.io.to(`user_${actuator.user_id}_${roomCode}`).emit('cameraDetection', detectionData);

        // Also emit as actuator update
        this.io.to(`user_${actuator.user_id}_${roomCode}`).emit('actuatorUpdate', {
            ...detectionData,
            state: 'DETECTED',
            numericState: 1,
            message: detectionMessage
        });

        console.log(`📤 [CameraMonitoringHandler] Emitted to room: user_${actuator.user_id}_${roomCode}`);
    }
}

module.exports = CameraMonitoringHandler;
