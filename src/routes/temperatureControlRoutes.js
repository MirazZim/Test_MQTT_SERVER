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
const logUserAction = async (userId, actionType, actionDescription, oldValue, newValue, roomId = null, ipAddress = 'Unknown', userAgent = 'Unknown') => {
    try {
        console.log(`🔵 [Audit] Logging action: ${actionDescription} for user ${userId}`);

        await pool.execute(`
      INSERT INTO user_audit_log
      (user_id, room_id, action_type, action_description, old_value, new_value, entity_type, entity_id, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NOW())
    `, [
            userId,
            roomId,
            actionType,
            actionDescription,
            oldValue,
            newValue,
            ipAddress,
            userAgent
        ]);

        console.log(`✅ [Audit] Logged: User ${userId} - ${actionDescription} (${oldValue} → ${newValue})`);

        // Emit real-time update to admin dashboard
        if (global.io) {
            global.io.to('admin_dashboard').emit('userActionAudit', {
                id: Date.now(),
                user_id: userId,
                action_type: actionType,
                action_description: actionDescription,
                old_value: oldValue,
                new_value: newValue,
                room_id: roomId,
                created_at: new Date().toISOString()
            });
        }

        return true;
    } catch (error) {
        console.error('❌ [Audit] Error logging user action:', error.message);
        return false;
    }
};

// ============================================
// POST /setpoint - Set desired temperature
// ============================================
temperatureControlRouter.post("/setpoint", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /setpoint] User: ${req.user.id}`);

    try {
        const { targetTemperature } = req.body;
        const location = req.query.location || req.body.location || 'sensor-room';
        const userId = req.user.id;

        console.log(`🔵 [Route] Setting temperature for location: ${location}`);

        // Validate input
        if (targetTemperature === undefined || targetTemperature === null) {
            console.warn(`⚠️ [Route] Missing target temperature`);
            return res.status(400).json({
                status: "failed",
                message: "Target temperature is required"
            });
        }

        const temp = parseFloat(targetTemperature);
        if (isNaN(temp) || temp < -10 || temp > 50) {
            console.warn(`⚠️ [Route] Invalid temperature: ${temp}`);
            return res.status(400).json({
                status: "failed",
                message: "Target temperature must be a number between -10°C and 50°C"
            });
        }

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
        console.log(`✅ [Route] Found room_id: ${roomId}`);

        // Get old value for audit trail
        const [settingRows] = await pool.execute(
            'SELECT target_temperature FROM room_control_settings WHERE room_id = ?',
            [roomId]
        );

        let oldTemperature = null;

        if (settingRows.length > 0) {
            // Update existing setting
            oldTemperature = settingRows[0].target_temperature;
            await pool.execute(
                'UPDATE room_control_settings SET target_temperature = ?, updated_at = NOW() WHERE room_id = ?',
                [temp, roomId]
            );
            console.log(`✅ [Route] Updated temperature: ${oldTemperature} → ${temp}`);
        } else {
            // Insert new setting
            await pool.execute(
                'INSERT INTO room_control_settings (room_id, target_temperature, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                [roomId, temp]
            );
            console.log(`✅ [Route] Created new temperature setting: ${temp}`);
        }

        // Log to audit trail
        await logUserAction(
            userId,
            'TEMPERATURE_SET',
            'Temperature Setpoint Changed',
            oldTemperature,
            temp,
            roomId,
            req.ip || 'Unknown',
            req.headers['user-agent'] || 'Unknown'
        );

        // Publish to MQTT
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.publishSimple) {
            const topic = `${userId}/${location}/control/setpoint`;
            mqttClient.publishSimple(topic, temp.toString());
            console.log(`📡 [Route] Published to MQTT: ${topic} = ${temp}`);
        }

        // Response
        res.status(200).json({
            status: "success",
            message: "Target temperature set successfully",
            data: {
                userId,
                roomId,
                location,
                targetTemperature: temp,
                auditLogged: true
            }
        });
        console.log(`✅ [Route POST /setpoint] Success`);

    } catch (error) {
        console.error("❌ [Route POST /setpoint] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
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
