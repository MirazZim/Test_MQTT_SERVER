// src/mqtt/Actuators/ResultsHandler.js - FIXED VERSION
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class ResultsHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [ResultsHandler] Initialized`);
    }

    async handleResultsData(topic, payload) {
        console.log(`\n📊 ========== RESULTS DATA ==========`);
        console.log(`📊 Payload received: ${payload}`);

        const resultMessage = payload.toString().trim();
        let status = 'UNKNOWN';
        let state = 0;

        // Determine status
        if (resultMessage.includes('Complete')) {
            status = 'COMPLETE';
            state = 1;
        } else if (resultMessage.includes('Ongoing')) {
            status = 'ONGOING';
            state = 1;
        } else if (resultMessage.includes('OFF') || resultMessage.includes('Check')) {
            status = 'OFF';
            state = 0;
        }

        console.log(`📊 Status: ${status}, Message: ${resultMessage}`);
        this.updateCache('results', resultMessage);

        // Update actuator_states for all active users
        for (const [userId, rooms] of this.activeUsers) {
            try {
                console.log(`🔵 [ResultsHandler] Processing user ${userId} with rooms:`, Array.from(rooms));

                for (const roomCode of rooms) {
                    // ✅ Get BOTH room ID and room code
                    const [roomRows] = await pool.execute(
                        'SELECT id, room_code FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                        [userId, roomCode]
                    );

                    if (roomRows.length === 0) {
                        console.warn(`⚠️ [ResultsHandler] No room found for user ${userId}, room: ${roomCode}`);
                        continue;
                    }

                    const roomId = roomRows[0].id;
                    const roomCodeFromDb = roomRows[0].room_code;
                    console.log(`✅ [ResultsHandler] Found room - ID: ${roomId}, Code: ${roomCodeFromDb}`);

                    // Check if actuator_states entry exists
                    const [existingState] = await pool.execute(
                        `SELECT id FROM actuator_states 
                         WHERE user_id = ? AND room_id = ? AND actuator_type = 'results'`,
                        [userId, roomId]
                    );

                    if (existingState.length > 0) {
                        await pool.execute(
                            `UPDATE actuator_states 
                             SET status = ?, message = ?, state = ?, timestamp = NOW() 
                             WHERE id = ?`,
                            [status, resultMessage, state, existingState[0].id]
                        );
                        console.log(`✅ [ResultsHandler] Updated actuator_states ID: ${existingState[0].id}`);
                    } else {
                        await pool.execute(
                            `INSERT INTO actuator_states 
                             (user_id, room_id, actuator_type, status, message, state, timestamp) 
                             VALUES (?, ?, 'results', ?, ?, ?, NOW())`,
                            [userId, roomId, status, resultMessage, state]
                        );
                        console.log(`✅ [ResultsHandler] Created new actuator_states`);
                    }

                    // Update actuators table if exists
                    const [actuatorRows] = await pool.execute(
                        `SELECT a.id FROM actuators a
                         INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                         WHERE a.user_id = ? AND a.room_id = ? AND at.type_code = 'results' AND a.is_active = 1`,
                        [userId, roomId]
                    );

                    if (actuatorRows.length > 0) {
                        const actuatorId = actuatorRows[0].id;

                        await pool.execute(
                            'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                            [status, actuatorId]
                        );

                        await pool.execute(
                            `INSERT INTO actuator_control_logs 
                             (actuator_id, command_value, command_source, executed_at) 
                             VALUES (?, ?, 'mqtt', NOW())`,
                            [actuatorId, state]
                        );

                        console.log(`✅ [ResultsHandler] Updated actuators table ID: ${actuatorId}`);
                    }

                    // ✅ CRITICAL FIX: Emit with roomCode (string) not just roomId
                    const emitData = {
                        actuatorType: 'results',
                        roomCode: roomCodeFromDb,  // ✅ String like "Test"
                        roomId: roomId,            // Numeric like 41
                        status: status,
                        state: state,
                        message: resultMessage,
                        numericState: state,
                        timestamp: new Date().toISOString()
                    };

                    // Emit to room-based channel (for components that join specific rooms)
                    this.io.to(`room_${roomId}`).emit('actuatorUpdate', emitData);

                    // ✅ ALSO emit to location-based channel (for components using roomCode)
                    this.io.to(`location_${roomCodeFromDb}`).emit('actuatorUpdate', emitData);

                    console.log(`📡 [ResultsHandler] Emitted to room_${roomId} AND location_${roomCodeFromDb}: ${resultMessage}`);
                }
            } catch (error) {
                console.error(`❌ [ResultsHandler] Error for user ${userId}:`, error.message);
            }
        }

        console.log(`📊 ========== END RESULTS DATA ==========\n`);
    }
}

module.exports = ResultsHandler;
