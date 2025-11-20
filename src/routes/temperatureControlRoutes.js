// routes/temperatureControlRoutes.js
// ✅ UPDATED FOR redesigned_iot_database schema
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");

const temperatureControlRouter = express.Router();

console.log("🔵 [Temperature Control Routes] Initializing routes");

// ============================================
// AUDIT LOGGER HELPER FUNCTION
// ============================================
const logUserAction = async (
    userId,
    actionType,
    actionDescription,
    oldValue,
    newValue,
    roomId = null,
    ipAddress = 'Unknown',
    userAgent = 'Unknown'
) => {
    try {
        console.log(`📝 [Audit] Attempting to log:`, {
            userId,
            roomId,
            actionType,
            actionDescription,
            oldValue,
            newValue,
            ipAddress,
            userAgent
        });

        const [result] = await pool.execute(
            `INSERT INTO userauditlog 
            (userid, roomid, actiontype, actiondescription, oldvalue, newvalue, entitytype, entityid, ipaddress, useragent, createdat)
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NOW())`,
            [userId, roomId, actionType, actionDescription, oldValue, newValue, ipAddress, userAgent]
        );

        console.log(`✅ [Audit] Successfully logged. Insert ID: ${result.insertId}`);

        // Emit real-time update to admin dashboard
        if (global.io) {
            global.io.to('admin-dashboard').emit('userActionAudit', {
                id: result.insertId,
                userid: userId,
                actiontype: actionType,
                actiondescription: actionDescription,
                oldvalue: oldValue,
                newvalue: newValue,
                roomid: roomId,
                createdat: new Date().toISOString()
            });
            console.log(`📡 [Audit] Emitted to admin dashboard`);
        }

        return true;
    } catch (error) {
        console.error(`❌ [Audit] FAILED to log user action:`);
        console.error(`   - Error Message: ${error.message}`);
        console.error(`   - Error Code: ${error.code}`);
        console.error(`   - SQL State: ${error.sqlState}`);
        console.error(`   - SQL Message: ${error.sqlMessage}`);
        console.error(`   - Parameters:`, { userId, roomId, actionType, actionDescription, oldValue, newValue });
        return false;
    }
};

// ============================================
// 📡 POST /setpoint - Set desired temperature OR fan speed
// ============================================
temperatureControlRouter.post("/setpoint", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /setpoint] User: ${req.user.id}`);

    try {
        const {
            targetTemperature,
            targetHumidity,
            targetAirflow,
            fanSpeed,      // ✅ NEW
            actuatorId,    // ✅ NEW
            oldValue,      // ✅ NEW
            newValue       // ✅ NEW
        } = req.body;

        const location = req.query.location || req.body.location || 'sensor-room';
        const userId = req.user.id;

        console.log(`🔵 [Route] Request body:`, req.body);

        // Get room_id first
        const [roomRows] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (roomRows.length === 0) {
            console.warn(`⚠️ [Route] Room not found for location: ${location}`);
            return res.status(404).json({
                status: "failed",
                message: `Room not found for location: ${location}`
            });
        }

        const roomId = roomRows[0].id;
        console.log(`✅ [Route] Found room_id: ${roomId}`);

        // ============================================
        // ✅ HANDLE FAN SPEED CHANGE (IMPROVED)
        // ============================================
        if (fanSpeed !== undefined && actuatorId) {
            console.log(`🌀 [Route] Handling fan speed change: ${oldValue} → ${fanSpeed} (Actuator ID: ${actuatorId})`);

            try {
                // Step 1: Verify actuator exists and belongs to user
                const [actuatorRows] = await pool.execute(
                    `SELECT a.id, a.mqtt_topic, a.actuator_name, a.current_state, r.id as room_id
                     FROM actuators a
                     INNER JOIN rooms r ON a.room_id = r.id
                     WHERE a.id = ? AND r.user_id = ? AND a.is_active = 1`,
                    [actuatorId, userId]
                );

                if (actuatorRows.length === 0) {
                    console.error(`❌ [Route] Actuator ${actuatorId} not found or unauthorized`);
                    return res.status(404).json({
                        status: "failed",
                        message: "Actuator not found or unauthorized"
                    });
                }

                const actuator = actuatorRows[0];
                const actuatorRoomId = actuator.room_id;
                console.log(`✅ [Route] Actuator verified: ${actuator.actuator_name} in room ${actuatorRoomId}`);

                // Step 2: Update actuator current_state
                const [updateResult] = await pool.execute(
                    'UPDATE actuators SET current_state = ?, target_state = ?, last_command_at = NOW() WHERE id = ?',
                    [fanSpeed.toString(), fanSpeed.toString(), actuatorId]
                );

                console.log(`✅ [Route] Updated actuator ${actuatorId} to ${fanSpeed}% (${updateResult.affectedRows} rows affected)`);

                // Step 3: Log to actuator_control_logs
                const [logResult] = await pool.execute(
                    `INSERT INTO actuator_control_logs 
                    (actuator_id, command_value, command_source, executed_at, success) 
                    VALUES (?, ?, 'manual', NOW(), 1)`,
                    [actuatorId, fanSpeed]
                );

                console.log(`✅ [Route] Logged to actuator_control_logs (ID: ${logResult.insertId})`);

                // Step 4: Log to audit trail WITH ERROR CHECKING
                const auditLogged = await logUserAction(
                    userId,
                    'FAN_SPEED_SET',
                    `Fan Speed Changed from ${oldValue || 'N/A'}% to ${fanSpeed}%`,
                    oldValue?.toString() || null,
                    fanSpeed.toString(),
                    actuatorRoomId,  // Use the room ID from actuator query
                    req.ip || req.connection?.remoteAddress || '127.0.0.1',
                    req.headers['user-agent'] || 'Unknown'
                );

                if (!auditLogged) {
                    console.error(`❌ [Route] CRITICAL: Audit trail failed for fan speed change!`);
                } else {
                    console.log(`✅ [Route] Audit logged successfully for fan speed change`);
                }

                // Step 5: Publish to MQTT
                if (actuator.mqtt_topic) {
                    const mqttTopic = actuator.mqtt_topic;

                    // Try to get mqttClient from server or global
                    const { mqttClient } = require("../server");
                    if (mqttClient && mqttClient.publishSimple) {
                        mqttClient.publishSimple(mqttTopic, fanSpeed.toString());
                        console.log(`📡 [Route] Published to MQTT: ${mqttTopic} = ${fanSpeed}`);
                    } else if (global.mqttHandler && global.mqttHandler.mqttClient) {
                        global.mqttHandler.mqttClient.publish(
                            mqttTopic,
                            fanSpeed.toString(),
                            { qos: 1 },
                            (err) => {
                                if (err) {
                                    console.error(`❌ [Route] MQTT publish error:`, err);
                                } else {
                                    console.log(`📡 [Route] Published to MQTT: ${mqttTopic} = ${fanSpeed}`);
                                }
                            }
                        );
                    } else {
                        console.warn(`⚠️ [Route] MQTT client not available`);
                    }
                }

                // Step 6: Emit real-time update via Socket.IO
                if (global.io) {
                    global.io.to(`user_${userId}_${location}`).emit('actuatorUpdate', {
                        actuatorType: 'fan_speed_control',
                        value: fanSpeed,
                        state: fanSpeed > 0 ? 'ON' : 'OFF',
                        roomCode: location,
                        roomId: actuatorRoomId,
                        timestamp: new Date().toISOString()
                    });
                    console.log(`📡 [Route] Emitted actuatorUpdate via Socket.IO`);
                }

                // Step 7: Return success response
                return res.status(200).json({
                    status: "success",
                    message: "Fan speed set successfully",
                    data: {
                        userId,
                        roomId: actuatorRoomId,
                        location,
                        fanSpeed: fanSpeed,
                        actuatorId,
                        actuatorName: actuator.actuator_name,
                        auditLogged: auditLogged  // ✅ Include audit status
                    }
                });

            } catch (fanError) {
                console.error(`❌ [Route] Error in fan speed handler:`, fanError);
                return res.status(500).json({
                    status: "failed",
                    message: "Failed to update fan speed",
                    error: fanError.message
                });
            }
        }

        // ============================================
        // ✅ HANDLE TEMPERATURE CHANGE (existing code)
        // ============================================
        if (targetTemperature !== undefined) {
            const temp = parseFloat(targetTemperature);

            // Validate input
            if (isNaN(temp) || temp < -10 || temp > 50) {
                console.warn(`⚠️ [Route] Invalid temperature: ${temp}`);
                return res.status(400).json({
                    status: "failed",
                    message: "Target temperature must be a number between -10°C and 50°C"
                });
            }

            // Get old value for audit trail
            const [settingRows] = await pool.execute(
                'SELECT target_temperature FROM room_control_settings WHERE room_id = ?',
                [roomId]
            );

            let oldTemperature = null;

            if (settingRows.length > 0) {
                oldTemperature = settingRows[0].target_temperature;
                await pool.execute(
                    'UPDATE room_control_settings SET target_temperature = ?, updated_at = NOW() WHERE room_id = ?',
                    [temp, roomId]
                );
                console.log(`✅ [Route] Updated temperature: ${oldTemperature} → ${temp}`);
            } else {
                await pool.execute(
                    'INSERT INTO room_control_settings (room_id, target_temperature, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                    [roomId, temp]
                );
                console.log(`✅ [Route] Created new temperature setting: ${temp}`);
            }

            // Log to audit trail
            const auditLogged = await logUserAction(
                userId,
                'TEMPERATURE_SET',
                `Temperature Setpoint Changed from ${oldTemperature}°C to ${temp}°C`,
                oldTemperature,
                temp,
                roomId,
                req.ip || req.connection?.remoteAddress || '127.0.0.1',
                req.headers['user-agent'] || 'Unknown'
            );

            if (!auditLogged) {
                console.error(`❌ [Route] Audit trail failed for temperature change`);
            }

            // Publish to MQTT
            const { mqttClient } = require("../server");
            if (mqttClient && mqttClient.publishSimple) {
                const topic = `${userId}/${location}/control/setpoint`;
                mqttClient.publishSimple(topic, temp.toString());
                console.log(`📡 [Route] Published to MQTT: ${topic} = ${temp}`);
            }

            return res.status(200).json({
                status: "success",
                message: "Target temperature set successfully",
                data: {
                    userId,
                    roomId,
                    location,
                    targetTemperature: temp,
                    auditLogged: auditLogged
                }
            });
        }

        // ============================================
        // ✅ HANDLE HUMIDITY CHANGE
        // ============================================
        if (targetHumidity !== undefined) {
            const humidity = parseFloat(targetHumidity);

            const [settingRows] = await pool.execute(
                'SELECT target_humidity FROM room_control_settings WHERE room_id = ?',
                [roomId]
            );

            let oldHumidity = null;

            if (settingRows.length > 0) {
                oldHumidity = settingRows[0].target_humidity;
                await pool.execute(
                    'UPDATE room_control_settings SET target_humidity = ?, updated_at = NOW() WHERE room_id = ?',
                    [humidity, roomId]
                );
            } else {
                await pool.execute(
                    'INSERT INTO room_control_settings (room_id, target_humidity, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                    [roomId, humidity]
                );
            }

            const auditLogged = await logUserAction(
                userId,
                'HUMIDITY_SET',
                `Humidity Setpoint Changed from ${oldHumidity}% to ${humidity}%`,
                oldHumidity,
                humidity,
                roomId,
                req.ip || req.connection?.remoteAddress || '127.0.0.1',
                req.headers['user-agent'] || 'Unknown'
            );

            return res.status(200).json({
                status: "success",
                message: "Target humidity set successfully",
                data: {
                    userId,
                    roomId,
                    location,
                    targetHumidity: humidity,
                    auditLogged: auditLogged
                }
            });
        }

        // ============================================
        // ✅ HANDLE AIRFLOW CHANGE
        // ============================================
        if (targetAirflow !== undefined) {
            const airflow = parseFloat(targetAirflow);

            const [settingRows] = await pool.execute(
                'SELECT target_airflow FROM room_control_settings WHERE room_id = ?',
                [roomId]
            );

            let oldAirflow = null;

            if (settingRows.length > 0) {
                oldAirflow = settingRows[0].target_airflow;
                await pool.execute(
                    'UPDATE room_control_settings SET target_airflow = ?, updated_at = NOW() WHERE room_id = ?',
                    [airflow, roomId]
                );
            } else {
                await pool.execute(
                    'INSERT INTO room_control_settings (room_id, target_airflow, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                    [roomId, airflow]
                );
            }

            const auditLogged = await logUserAction(
                userId,
                'AIRFLOW_SET',
                `Airflow Setpoint Changed from ${oldAirflow} to ${airflow}`,
                oldAirflow,
                airflow,
                roomId,
                req.ip || req.connection?.remoteAddress || '127.0.0.1',
                req.headers['user-agent'] || 'Unknown'
            );

            return res.status(200).json({
                status: "success",
                message: "Target airflow set successfully",
                data: {
                    userId,
                    roomId,
                    location,
                    targetAirflow: airflow,
                    auditLogged: auditLogged
                }
            });
        }

        // If nothing was provided
        return res.status(400).json({
            status: "failed",
            message: "No valid setpoint parameters provided"
        });

    } catch (error) {
        console.error("❌ [Route POST /setpoint] Error:", error.message);
        console.error("Stack:", error.stack);
        res.status(500).json({
            status: "failed",
            message: "Internal server error",
            error: error.message
        });
    }
});

// ============================================
// GET /setpoint - Get current setpoint and control state
// ============================================
temperatureControlRouter.get("/setpoint", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /setpoint] User: ${req.user.id}`);

    try {
        const location = req.query.location || 'sensor-room';
        const userId = req.user.id;

        console.log(`🔵 [Route] Getting setpoint for location: ${location}`);

        // Get room_id
        const [roomRows] = await pool.execute(
            'SELECT id, room_name FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (roomRows.length === 0) {
            console.warn(`⚠️ [Route] Room not found for location: ${location}`);
            return res.status(404).json({
                status: "failed",
                message: `Room not found for location: ${location}`
            });
        }

        const roomId = roomRows[0].id;
        const roomName = roomRows[0].room_name;
        console.log(`✅ [Route] Found room: ${roomName} (ID: ${roomId})`);

        // Get target temperature from room_control_settings
        const [settingRows] = await pool.execute(
            'SELECT target_temperature, control_mode, updated_at FROM room_control_settings WHERE room_id = ?',
            [roomId]
        );

        let targetTemperature = 25.0; // Default
        let controlMode = 'auto';

        if (settingRows.length > 0) {
            targetTemperature = parseFloat(settingRows[0].target_temperature);
            controlMode = settingRows[0].control_mode || 'auto';
            console.log(`✅ [Route] Found settings: temp=${targetTemperature}, mode=${controlMode}`);
        } else {
            console.log(`⚠️ [Route] No settings found, using defaults`);
        }

        // Get actuator states
        const [actuators] = await pool.execute(
            `SELECT 
        a.actuator_name,
        at.type_code,
        a.current_state,
        a.target_state,
        a.last_command_at
      FROM actuators a
      INNER JOIN actuator_types at ON a.actuator_type_id = at.id
      WHERE a.room_id = ? AND a.is_active = 1
      ORDER BY at.type_code`,
            [roomId]
        );

        console.log(`✅ [Route] Retrieved ${actuators.length} actuators`);

        // Organize actuator states
        const controlState = {
            heaterState: false,
            coolerState: false,
            fanState: false,
            pumpState: false,
            controlMode: controlMode,
            lastAction: null
        };

        actuators.forEach(actuator => {
            const state = actuator.current_state === 1 || actuator.current_state === 'ON';

            switch (actuator.type_code) {
                case 'heater':
                    controlState.heaterState = state;
                    break;
                case 'cooler':
                    controlState.coolerState = state;
                    break;
                case 'fan':
                    controlState.fanState = state;
                    break;
                case 'pump':
                    controlState.pumpState = state;
                    break;
            }

            if (actuator.last_command_at) {
                controlState.lastAction = actuator.last_command_at;
            }
        });

        res.status(200).json({
            status: "success",
            message: "Setpoint and control state retrieved successfully",
            data: {
                userId,
                roomId,
                location,
                roomName,
                desiredTemperature: targetTemperature,
                controlState,
                actuators: actuators.map(a => ({
                    name: a.actuator_name,
                    type: a.type_code,
                    currentState: a.current_state,
                    targetState: a.target_state,
                    lastCommand: a.last_command_at
                }))
            }
        });
        console.log(`✅ [Route GET /setpoint] Success`);

    } catch (error) {
        console.error("❌ [Route GET /setpoint] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// ============================================
// GET /control-history - Get control history
// ============================================
temperatureControlRouter.get("/control-history", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /control-history] User: ${req.user.id}`);

    try {
        const location = req.query.location || 'sensor-room';
        const userId = req.user.id;
        const days = parseInt(req.query.days) || 7;

        console.log(`🔵 [Route] Getting ${days} days of history for location: ${location}`);

        // Get room_id
        const [roomRows] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (roomRows.length === 0) {
            console.warn(`⚠️ [Route] Room not found for location: ${location}`);
            return res.status(404).json({
                status: "failed",
                message: `Room not found for location: ${location}`
            });
        }

        const roomId = roomRows[0].id;

        // Get actuator control logs
        const [historyRows] = await pool.execute(`
      SELECT 
        acl.id,
        acl.actuator_id,
        a.actuator_name,
        at.type_code as actuator_type,
        acl.command_value,
        acl.command_source,
        acl.executed_at,
        acl.success
      FROM actuator_control_logs acl
      INNER JOIN actuators a ON acl.actuator_id = a.id
      INNER JOIN actuator_types at ON a.actuator_type_id = at.id
      WHERE a.room_id = ?
        AND acl.executed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY acl.executed_at DESC
      LIMIT 100
    `, [roomId, days]);

        console.log(`✅ [Route] Retrieved ${historyRows.length} control history records`);

        res.status(200).json({
            status: "success",
            message: "Control history retrieved successfully",
            data: {
                userId,
                roomId,
                location,
                days,
                history: historyRows
            }
        });
        console.log(`✅ [Route GET /control-history] Success`);

    } catch (error) {
        console.error("❌ [Route GET /control-history] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// ============================================
// POST /control/actuator - Manual actuator control
// ============================================
temperatureControlRouter.post("/control/actuator", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /control/actuator] User: ${req.user.id}`);

    try {
        const { actuatorType, state, location } = req.body;
        const userId = req.user.id;
        const roomCode = location || 'sensor-room';

        console.log(`🔵 [Route] Controlling ${actuatorType} in ${roomCode}: ${state}`);

        // Validate input
        if (!actuatorType || state === undefined) {
            return res.status(400).json({
                status: "failed",
                message: "actuatorType and state are required"
            });
        }

        // Get room_id
        const [roomRows] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, roomCode]
        );

        if (roomRows.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: "Room not found"
            });
        }

        const roomId = roomRows[0].id;

        // Get actuator
        const [actuators] = await pool.execute(
            `SELECT a.id, a.actuator_name, a.current_state 
       FROM actuators a
       INNER JOIN actuator_types at ON a.actuator_type_id = at.id
       WHERE a.room_id = ? AND at.type_code = ? AND a.is_active = 1
       LIMIT 1`,
            [roomId, actuatorType]
        );

        if (actuators.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: `Actuator type '${actuatorType}' not found in room`
            });
        }

        const actuator = actuators[0];
        const oldState = actuator.current_state;
        const newState = state ? 1 : 0;

        // Update actuator state
        await pool.execute(
            'UPDATE actuators SET current_state = ?, target_state = ?, last_command_at = NOW() WHERE id = ?',
            [newState, newState, actuator.id]
        );

        // Log to actuator_control_logs
        await pool.execute(
            `INSERT INTO actuator_control_logs 
       (actuator_id, command_value, command_source, executed_at, success) 
       VALUES (?, ?, 'manual', NOW(), 1)`,
            [actuator.id, newState]
        );

        // Log to audit trail
        await logUserAction(
            userId,
            'ACTUATOR_CONTROL',
            `${actuator.actuator_name} ${state ? 'ON' : 'OFF'}`,
            oldState,
            newState,
            roomId,
            req.ip || 'Unknown',
            req.headers['user-agent'] || 'Unknown'
        );

        // Publish to MQTT
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.publishSimple) {
            const topic = `${userId}/${roomCode}/control/${actuatorType}`;
            mqttClient.publishSimple(topic, newState.toString());
            console.log(`📡 [Route] Published to MQTT: ${topic} = ${newState}`);
        }

        res.status(200).json({
            status: "success",
            message: `Actuator ${state ? 'activated' : 'deactivated'} successfully`,
            data: {
                actuatorId: actuator.id,
                actuatorName: actuator.actuator_name,
                actuatorType,
                state: newState,
                location: roomCode
            }
        });
        console.log(`✅ [Route POST /control/actuator] Success`);

    } catch (error) {
        console.error("❌ [Route POST /control/actuator] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

console.log("✅ [Temperature Control Routes] All routes initialized");
module.exports = temperatureControlRouter;
