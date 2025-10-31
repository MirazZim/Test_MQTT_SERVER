// const express = require("express");
// const { adminOrUser } = require("../middleware/auth");
// const pool = require("../config/db");

// const temperatureControlRouter = express.Router();


// // Create audit logger helper function (ADD THIS - NEW)
// const logUserAction = async (userId, username, actionType, actionDescription, oldValue, newValue, location = 'main-room', ipAddress = 'Unknown') => {
//     try {
//         await pool.execute(`
//             INSERT INTO user_action_audit
//             (user_id, username, action_type, action_description, old_value, new_value, location, ip_address, session_id, created_at)
//             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
//         `, [
//             userId,
//             username,
//             actionType,
//             actionDescription,
//             oldValue,
//             newValue,
//             location,
//             ipAddress,
//             `session_${Date.now()}_${userId}`
//         ]);

//         console.log(`📋 AUDIT: ${username} - ${actionDescription} (${oldValue} → ${newValue})`);

//         // Emit real-time update to admin dashboard
//         if (global.io) {
//             global.io.to('admin_dashboard').emit('userActionAudit', {
//                 id: Date.now(),
//                 user_id: userId,
//                 username: username,
//                 action_type: actionType,
//                 action_description: actionDescription,
//                 old_value: oldValue,
//                 new_value: newValue,
//                 location: location,
//                 created_at: new Date().toISOString()
//             });
//         }

//         return true;
//     } catch (error) {
//         console.error('❌ Error logging user action:', error);
//         return false;
//     }
// };

// // Set desired temperature (update user's setpoint) - ENHANCED WITH AUDIT TRAIL
// temperatureControlRouter.post("/setpoint", adminOrUser, async (req, res) => {
//     try {
//         const { targetTemperature } = req.body;
//         const userId = req.user.id;

//         if (targetTemperature === undefined || targetTemperature === null) {
//             return res.status(400).json({
//                 status: "failed",
//                 message: "Target temperature is required"
//             });
//         }

//         const temp = parseFloat(targetTemperature);
//         if (isNaN(temp) || temp < -10 || temp > 50) {
//             return res.status(400).json({
//                 status: "failed",
//                 message: "Target temperature must be a number between -10°C and 50°C"
//             });
//         }

//         // GET OLD VALUE AND USERNAME FOR AUDIT TRAIL (ADD THIS - NEW)
//         const [userRows] = await pool.execute(
//             "SELECT username, desired_temperature FROM users WHERE id = ?",
//             [userId]
//         );

//         let oldTemperature = null;
//         let username = 'Unknown User';
//         if (userRows.length > 0) {
//             oldTemperature = userRows[0].desired_temperature;
//             username = userRows[0].username;
//         }

//         // Update user's desired temperature (EXISTING - NO CHANGE)
//         await pool.execute(
//             "UPDATE users SET desired_temperature = ? WHERE id = ?",
//             [temp, userId]
//         );

//         // LOG TO AUDIT TRAIL (ADD THIS - NEW)
//         logUserAction(
//             userId,
//             username,
//             'TEMPERATURE_SET',
//             'Temperature Setpoint Changed',
//             oldTemperature,
//             temp,
//             'main-room',
//             req.ip || 'Unknown'
//         ).catch(err => console.error('Audit logging failed:', err));

//         // Get the MQTT client to publish setpoint change (EXISTING - NO CHANGE)
//         const { mqttClient } = require("../server");
//         if (mqttClient && mqttClient.mqttClient) {
//             mqttClient.mqttClient.publish(
//                 `home/${userId}/setpoint`,
//                 temp.toString(),
//                 { qos: 0 }
//             );
//         }

//         // ENHANCED RESPONSE WITH AUDIT INFO (SLIGHTLY MODIFIED)
//         res.status(200).json({
//             status: "success",
//             message: "Target temperature set successfully",
//             data: {
//                 userId,
//                 targetTemperature: temp,
//                 auditLogged: true // ADD THIS - NEW
//             }
//         });

//     } catch (error) {
//         console.error("Error setting target temperature:", error);
//         res.status(500).json({
//             status: "failed",
//             message: "Internal server error"
//         });
//     }
// });

// // Set desired temperature (update user's setpoint)
// temperatureControlRouter.post("/setpoint", adminOrUser, async (req, res) => {
//     try {
//         const { targetTemperature } = req.body;
//         const userId = req.user.id;

//         if (targetTemperature === undefined || targetTemperature === null) {
//             return res.status(400).json({
//                 status: "failed",
//                 message: "Target temperature is required"
//             });
//         }

//         const temp = parseFloat(targetTemperature);
//         if (isNaN(temp) || temp < -10 || temp > 50) {
//             return res.status(400).json({
//                 status: "failed",
//                 message: "Target temperature must be a number between -10°C and 50°C"
//             });
//         }

//         // Update user's desired temperature - FIX HERE
//         await pool.execute(
//             "UPDATE users SET desired_temperature = ? WHERE id = ?",
//             [temp, userId]
//         );

//         // Get the MQTT client to publish setpoint change
//         const { mqttClient } = require("../server");
//         if (mqttClient && mqttClient.mqttClient) {
//             mqttClient.mqttClient.publish(
//                 `home/${userId}/setpoint`,
//                 temp.toString(),
//                 { qos: 0 }
//             );
//         }

//         res.status(200).json({
//             status: "success",
//             message: "Target temperature set successfully",
//             data: {
//                 userId,
//                 targetTemperature: temp
//             }
//         });

//     } catch (error) {
//         console.error("Error setting target temperature:", error);
//         res.status(500).json({
//             status: "failed",
//             message: "Internal server error"
//         });
//     }
// });

// // Get current setpoint and control state
// temperatureControlRouter.get("/setpoint", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;

//         // Get user's desired temperature - FIX HERE
//         const [userRows] = await pool.execute(
//             "SELECT desired_temperature FROM users WHERE id = ?",
//             [userId]
//         );

//         if (userRows.length === 0) {
//             return res.status(404).json({
//                 status: "failed",
//                 message: "User not found"
//             });
//         }

//         // Get current control state - FIX HERE
//         const [controlRows] = await pool.execute(
//             "SELECT * FROM device_control_states WHERE user_id = ?",
//             [userId]
//         );

//         const controlState = controlRows[0] || {
//             heater_state: false,
//             cooler_state: false,
//             control_mode: 'auto'
//         };

//         res.status(200).json({
//             status: "success",
//             message: "Setpoint and control state retrieved successfully",
//             data: {
//                 userId,
//                 desiredTemperature: parseFloat(userRows[0].desired_temperature),
//                 controlState: {
//                     heaterState: controlState.heater_state,
//                     coolerState: controlState.cooler_state,
//                     controlMode: controlState.control_mode,
//                     lastAction: controlState.last_control_action
//                 }
//             }
//         });

//     } catch (error) {
//         console.error("Error getting setpoint:", error);
//         res.status(500).json({
//             status: "failed",
//             message: "Internal server error"
//         });
//     }
// });

// // Get control history for user
// temperatureControlRouter.get("/control-history", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const days = parseInt(req.query.days) || 7;

//         const [historyRows] = await pool.execute(`
//             SELECT
//                 heater_state,
//                 cooler_state,
//                 control_mode,
//                 last_control_action
//             FROM device_control_states
//             WHERE user_id = ? AND last_control_action >= DATE_SUB(NOW(), INTERVAL ? DAY)
//             ORDER BY last_control_action DESC
//         `, [userId, days]);

//         res.status(200).json({
//             status: "success",
//             message: "Control history retrieved successfully",
//             data: {
//                 userId,
//                 history: historyRows
//             }
//         });

//     } catch (error) {
//         console.error("Error getting control history:", error);
//         res.status(500).json({
//             status: "failed",
//             message: "Internal server error"
//         });
//     }
// });

// module.exports = temperatureControlRouter;
// routes/temperatureControlRoutes.js
// Updated to use room_control_settings for targets (requires location param for room).
// Used actuator_states for control states (heater/cooler).
// Adjusted audit to match user_audit_log schema.
// Removed duplicate POST route.
// Added location to routes (query param, default 'main-room').

const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");

const temperatureControlRouter = express.Router();


// Create audit logger helper function (UPDATED to match schema)
const logUserAction = async (userId, actionType, actionDescription, oldValue, newValue, roomId = null, ipAddress = 'Unknown', userAgent = 'Unknown') => {
    try {
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

        console.log(`📋 AUDIT: User ${userId} - ${actionDescription} (${oldValue} → ${newValue})`);

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
        console.error('❌ Error logging user action:', error);
        return false;
    }
};

// Set desired temperature (update room_control_settings target_temperature) - ENHANCED WITH AUDIT TRAIL
temperatureControlRouter.post("/setpoint", adminOrUser, async (req, res) => {
    try {
        const { targetTemperature } = req.body;
        const location = req.query.location || 'main-room'; // Add location param
        const userId = req.user.id;

        if (targetTemperature === undefined || targetTemperature === null) {
            return res.status(400).json({
                status: "failed",
                message: "Target temperature is required"
            });
        }

        const temp = parseFloat(targetTemperature);
        if (isNaN(temp) || temp < -10 || temp > 50) {
            return res.status(400).json({
                status: "failed",
                message: "Target temperature must be a number between -10°C and 50°C"
            });
        }

        // Get room_id
        const [roomRows] = await pool.execute(
            "SELECT id FROM rooms WHERE user_id = ? AND room_code = ?",
            [userId, location]
        );
        const roomId = roomRows[0]?.id;
        if (!roomId) {
            return res.status(404).json({
                status: "failed",
                message: "Room not found"
            });
        }

        // GET OLD VALUE FOR AUDIT TRAIL
        const [settingRows] = await pool.execute(
            "SELECT target_temperature FROM room_control_settings WHERE room_id = ?",
            [roomId]
        );

        let oldTemperature = null;
        if (settingRows.length > 0) {
            oldTemperature = settingRows[0].target_temperature;
        }

        // Update room_control_settings target_temperature
        await pool.execute(
            "UPDATE room_control_settings SET target_temperature = ? WHERE room_id = ?",
            [temp, roomId]
        );

        // LOG TO AUDIT TRAIL
        logUserAction(
            userId,
            'TEMPERATURE_SET',
            'Temperature Setpoint Changed',
            oldTemperature,
            temp,
            roomId,
            req.ip || 'Unknown',
            req.headers['user-agent'] || 'Unknown'
        ).catch(err => console.error('Audit logging failed:', err));

        // Get the MQTT client to publish setpoint change
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.mqttClient) {
            mqttClient.mqttClient.publish(
                `home/${userId}/${location}/setpoint`,
                temp.toString(),
                { qos: 0 }
            );
        }

        // RESPONSE
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

    } catch (error) {
        console.error("Error setting target temperature:", error);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get current setpoint and control state
temperatureControlRouter.get("/setpoint", adminOrUser, async (req, res) => {
    try {
        const location = req.query.location || 'main-room';
        const userId = req.user.id;

        // Get room_id
        const [roomRows] = await pool.execute(
            "SELECT id FROM rooms WHERE user_id = ? AND room_code = ?",
            [userId, location]
        );
        const roomId = roomRows[0]?.id;
        if (!roomId) {
            return res.status(404).json({
                status: "failed",
                message: "Room not found"
            });
        }

        // Get target_temperature from room_control_settings
        const [settingRows] = await pool.execute(
            "SELECT target_temperature FROM room_control_settings WHERE room_id = ?",
            [roomId]
        );

        if (settingRows.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: "Settings not found"
            });
        }

        // Get current control state from actuator_states (for heater and cooler)
        const [heaterRows] = await pool.execute(
            "SELECT state, control_mode FROM actuator_states WHERE user_id = ? AND room_id = ? AND actuator_type = 'heater'",
            [userId, roomId]
        );
        const [coolerRows] = await pool.execute(
            "SELECT state, control_mode FROM actuator_states WHERE user_id = ? AND room_id = ? AND actuator_type = 'cooler'",
            [userId, roomId]
        );

        const controlState = {
            heaterState: heaterRows[0]?.state || 0,
            coolerState: coolerRows[0]?.state || 0,
            controlMode: heaterRows[0]?.control_mode || 'auto', // Assume same for both
            lastAction: heaterRows[0]?.timestamp || new Date() // Use timestamp as last action
        };

        res.status(200).json({
            status: "success",
            message: "Setpoint and control state retrieved successfully",
            data: {
                userId,
                roomId,
                location,
                desiredTemperature: parseFloat(settingRows[0].target_temperature),
                controlState
            }
        });

    } catch (error) {
        console.error("Error getting setpoint:", error);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get control history for user
temperatureControlRouter.get("/control-history", adminOrUser, async (req, res) => {
    try {
        const location = req.query.location || 'main-room';
        const userId = req.user.id;
        const days = parseInt(req.query.days) || 7;

        // Get room_id
        const [roomRows] = await pool.execute(
            "SELECT id FROM rooms WHERE user_id = ? AND room_code = ?",
            [userId, location]
        );
        const roomId = roomRows[0]?.id;
        if (!roomId) {
            return res.status(404).json({
                status: "failed",
                message: "Room not found"
            });
        }

        // Use actuator_control_logs for history (adjust columns as needed)
        const [historyRows] = await pool.execute(`
            SELECT 
                actuator_id,
                command_value AS state,
                command_source AS control_mode,
                executed_at AS last_control_action
            FROM actuator_control_logs
            WHERE actuator_id IN (
                SELECT id FROM actuators WHERE room_id = ? AND actuator_type_id IN (1,2)  -- 1=heater, 2=cooler
            ) AND executed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            ORDER BY executed_at DESC
        `, [roomId, days]);

        res.status(200).json({
            status: "success",
            message: "Control history retrieved successfully",
            data: {
                userId,
                roomId,
                location,
                history: historyRows
            }
        });

    } catch (error) {
        console.error("Error getting control history:", error);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

module.exports = temperatureControlRouter;