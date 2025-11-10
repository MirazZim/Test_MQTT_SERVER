// routes/locationRoutes.js
// ✅ UPDATED FOR redesigned_iot_database schema
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const Measurement = require("../models/Measurement");
const pool = require("../config/db");
const mqtt = require('mqtt');
const fs = require('fs');

const locationRouter = express.Router();

console.log("🔵 [Location Routes] Initializing routes");

// Get user's locations (rooms)
locationRouter.get("/locations", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations] GET user locations - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const locations = await Measurement.getUserLocations(userId);

        console.log(`✅ [Route /locations] Retrieved ${locations.length} locations`);
        res.json({
            status: "success",
            message: "User locations retrieved successfully",
            locations
        });
    } catch (error) {
        console.error("❌ [Route /locations] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Initialize location (create room with sensors)
locationRouter.post("/locations/:location/initialize", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/initialize] POST - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        console.log(`🔵 [Route] Initializing location: ${location}`);

        // Check if room already exists
        const [existingRooms] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ?',
            [userId, location]
        );

        let roomId;

        if (existingRooms.length === 0) {
            // Create new room
            const [roomResult] = await pool.execute(
                `INSERT INTO rooms (user_id, room_name, room_code, description, is_active) 
         VALUES (?, ?, ?, ?, 1)`,
                [userId, `Room ${location}`, location, `Auto-created room for ${location}`]
            );

            roomId = roomResult.insertId;
            console.log(`✅ [Route] Created new room with ID: ${roomId}`);

            // Create sensors for this room
            await pool.execute(
                `INSERT INTO sensors (user_id, room_id, sensor_type_id, sensor_code, sensor_name, mqtt_topic, is_active)
         SELECT 
           ?,
           ?,
           id,
           CONCAT(type_code, '_', UPPER(?), '_001'),
           CONCAT(type_name, ' - ', ?),
           CONCAT(?, '/', ?, '/', type_code),
           1
         FROM sensor_types
         WHERE is_system_type = 1`,
                [userId, roomId, location, location, userId, location]
            );

            console.log(`✅ [Route] Created sensors for room ${location}`);
        } else {
            roomId = existingRooms[0].id;
            console.log(`✅ [Route] Room already exists with ID: ${roomId}`);
        }

        // Register location with MQTT handler
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.registerUser) {
            mqttClient.registerUser(userId, location);
            console.log(`✅ [Route] Registered user ${userId} with MQTT for location: ${location}`);
        }

        res.json({
            status: "success",
            message: `Location "${location}" initialized successfully`,
            location,
            roomId
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/initialize] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get measurements for specific location
locationRouter.get("/locations/:location/measurements", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/measurements] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const measurements = await Measurement.getAllByUserAndLocation(userId, location, days);

        console.log(`✅ [Route] Retrieved ${measurements.length} measurements for ${location}`);
        res.json({
            status: "success",
            message: `Measurements for ${location} retrieved successfully`,
            location,
            measurements
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/measurements] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get latest measurement for specific location
// GET /locations/:location/latest - Get latest measurements (FIXED)
locationRouter.get("/locations/:location/latest", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/latest] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        console.log(`🔵 [Route] Getting latest measurements for: ${location}`);

        // Get room_id first
        const [rooms] = await pool.execute(
            'SELECT id, room_name FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (rooms.length === 0) {
            console.warn(`⚠️ [Route] No room found for location: ${location}`);
            return res.json({
                status: "success",
                message: `No room found for location: ${location}`,
                location,
                measurement: null
            });
        }

        const roomId = rooms[0].id;
        console.log(`✅ [Route] Found room_id: ${roomId}`);

        // Get latest measurement for each sensor type
        const [measurements] = await pool.execute(
            `SELECT 
        st.type_code,
        sm.measured_value,
        sm.measured_at,
        TIMESTAMPDIFF(SECOND, sm.measured_at, NOW()) as seconds_ago
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      WHERE s.user_id = ? 
        AND s.room_id = ? 
        AND s.is_active = 1
        AND sm.measured_at >= NOW() - INTERVAL 1 HOUR
      ORDER BY sm.measured_at DESC`,
            [userId, roomId]
        );

        console.log(`✅ [Route] Found ${measurements.length} measurements`);

        // Build the measurement object
        const measurement = {
            temperature: null,
            humidity: null,
            airflow: null,
            bowl_temp: null,
            sonar_distance: null,
            co2_level: null,
            sugar_level: null,
            created_at: null
        };

        let latestTimestamp = null;
        const processedTypes = new Set();

        // Get the LATEST value for each sensor type (only once per type)
        measurements.forEach(row => {
            if (!processedTypes.has(row.type_code)) {
                measurement[row.type_code] = row.measured_value;
                processedTypes.add(row.type_code);

                if (!latestTimestamp || new Date(row.measured_at) > latestTimestamp) {
                    latestTimestamp = new Date(row.measured_at);
                }

                console.log(`✅ [Route] ${row.type_code}: ${row.measured_value} (${row.seconds_ago}s ago)`);
            }
        });

        if (latestTimestamp) {
            measurement.created_at = latestTimestamp;
        }

        console.log(`✅ [Route] Returning measurement:`, measurement);

        res.json({
            status: "success",
            message: `Latest measurement for ${location} retrieved`,
            location,
            measurement: measurement
        });

    } catch (error) {
        console.error("❌ [Route /locations/:location/latest] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});


// Get all sensor data for a location
locationRouter.get("/locations/:location/sensors", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/sensors] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const sensorData = await Measurement.getLocationSensorData(userId, location);

        console.log(`✅ [Route] Retrieved data for ${sensorData.length} sensors in ${location}`);
        res.json({
            status: "success",
            message: `Sensor data for ${location} retrieved successfully`,
            location,
            sensors: sensorData
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/sensors] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get statistics for a location
locationRouter.get("/locations/:location/stats", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/stats] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const stats = await Measurement.getLocationStats(userId, location, days);

        console.log(`✅ [Route] Retrieved stats for ${location}`);
        res.json({
            status: "success",
            message: `Statistics for ${location} retrieved successfully`,
            location,
            stats,
            days
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/stats] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// GET /api/locations/:location/actuators - Get actuators for a room
locationRouter.get("/locations/:location/actuators", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const [rooms] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (rooms.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: "Room not found"
            });
        }

        const roomId = rooms[0].id;

        const [actuators] = await pool.execute(
            `SELECT 
                a.id,
                a.actuator_code,
                a.actuator_name,
                a.mqtt_topic,
                at.type_code,
                at.type_name,
                a.current_state,
                a.updated_at
             FROM actuators a
             INNER JOIN actuator_types at ON a.actuator_type_id = at.id
             WHERE a.room_id = ? AND a.user_id = ? AND a.is_active = 1
             ORDER BY at.type_name`,
            [roomId, userId]
        );

        res.json({
            status: "success",
            roomId: roomId,
            location: location,
            actuators: actuators
        });

    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get control state for specific location (actuators)
locationRouter.get("/locations/:location/control", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/control] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        // Get actuator states for this room
        const [actuators] = await pool.execute(
            `SELECT 
        a.id,
        a.actuator_name,
        a.actuator_code,
        at.type_code,
        at.type_name,
        a.current_state,
        a.target_state,
        a.last_command_at
      FROM actuators a
      INNER JOIN actuator_types at ON a.actuator_type_id = at.id
      INNER JOIN rooms r ON a.room_id = r.id
      WHERE a.user_id = ? 
        AND r.room_code = ? 
        AND a.is_active = 1`,
            [userId, location]
        );

        console.log(`✅ [Route] Retrieved ${actuators.length} actuators for ${location}`);
        res.json({
            status: "success",
            message: `Control state for ${location} retrieved`,
            location,
            actuators
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/control] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// GET /locations/:location/latest - Get latest measurements (BACKWARD COMPATIBLE)



// Get bowl temperature history for location
locationRouter.get("/locations/:location/bowl-history", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/bowl-history] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const history = await Measurement.getBowlTempHistory(userId, location, days);

        console.log(`✅ [Route] Retrieved ${history.length} bowl temp records for ${location}`);
        res.json({
            status: "success",
            message: `Bowl temperature history for ${location} retrieved`,
            location,
            history,
            days
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/bowl-history] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});


// routes/locationRoutes.js - ADD these new endpoints

// POST /api/locations/create-room - Create room with MQTT auto-subscription
// POST /api/locations/create-room - Create room with MQTT auto-subscription
// POST /api/locations/create-room - Create room with MQTT auto-subscription
// POST /api/locations/create-room - Create room with MQTT auto-subscription
locationRouter.post("/locations/create-room", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /locations/create-room] User: ${req.user.id}`);

    try {
        const userId = req.user.id;
        const { roomName, roomId, sensorTopics, actuatorTopics } = req.body;

        // Validate input
        if (!roomName || !roomId) {
            return res.status(400).json({
                status: "failed",
                message: "roomName and roomId are required"
            });
        }

        if (!sensorTopics || !actuatorTopics) {
            return res.status(400).json({
                status: "failed",
                message: "sensorTopics and actuatorTopics are required"
            });
        }

        console.log(`🔵 [Route] Creating room: ${roomName} (ID: ${roomId})`);
        console.log(`📡 Sensor topics:`, sensorTopics);
        console.log(`🎛️ Actuator topics:`, actuatorTopics);

        // Create room
        const [roomResult] = await pool.execute(
            `INSERT INTO rooms (user_id, room_name, room_code, description, is_active) 
             VALUES (?, ?, ?, ?, 1)`,
            [userId, roomName, roomName, `Room ${roomName}`]
        );

        const autoGeneratedRoomId = roomResult.insertId;
        console.log(`✅ [Route] Created room with auto-generated ID: ${autoGeneratedRoomId}`);

        // Create sensors with custom MQTT topics
        const sensors = [];
        const createdSensorTopics = [];

        for (const [sensorType, mqttTopic] of Object.entries(sensorTopics)) {
            const [sensorTypeRows] = await pool.execute(
                `SELECT id, type_name, unit FROM sensor_types WHERE type_code = ?`,
                [sensorType]
            );

            if (sensorTypeRows.length === 0) {
                console.warn(`⚠️ Sensor type not found: ${sensorType}`);
                continue;
            }

            const sensorTypeId = sensorTypeRows[0].id;
            const sensorName = sensorTypeRows[0].type_name;
            const unit = sensorTypeRows[0].unit;

            const [sensorResult] = await pool.execute(
                `INSERT INTO sensors 
                 (user_id, room_id, sensor_type_id, sensor_code, sensor_name, mqtt_topic, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [
                    userId,
                    autoGeneratedRoomId,
                    sensorTypeId,
                    `${sensorType.toUpperCase()}_${autoGeneratedRoomId}`,
                    `${sensorName} - ${roomName}`,
                    mqttTopic
                ]
            );

            sensors.push({
                id: sensorResult.insertId,
                type: sensorType,
                name: sensorName,
                unit: unit,
                mqttTopic: mqttTopic
            });
            createdSensorTopics.push(mqttTopic);
            console.log(`✅ [Route] Created sensor: ${sensorType} - ${mqttTopic}`);
        }

        // ✅ FIXED: Fetch ALL actuator types from database (removed is_active check)
        const [allActuatorTypes] = await pool.execute(
            `SELECT id, type_code, type_name FROM actuator_types ORDER BY id`
        );

        console.log(`🔵 [Route] Found ${allActuatorTypes.length} actuator types in database`);

        const actuators = [];
        const createdActuatorTopics = [];

        // Loop through ALL actuator types from database
        for (const actuatorTypeRow of allActuatorTypes) {
            const actuatorType = actuatorTypeRow.type_code;
            const mqttTopic = actuatorTopics[actuatorType]; // Get topic from frontend

            if (!mqttTopic) {
                console.warn(`⚠️ No MQTT topic provided for actuator type: ${actuatorType}`);
                continue; // Skip if frontend didn't provide a topic
            }

            const actuatorTypeId = actuatorTypeRow.id;
            const actuatorName = actuatorTypeRow.type_name;

            const [actuatorResult] = await pool.execute(
                `INSERT INTO actuators 
                 (user_id, room_id, actuator_type_id, actuator_code, actuator_name, mqtt_topic, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [
                    userId,
                    autoGeneratedRoomId,
                    actuatorTypeId,
                    `${actuatorType.toUpperCase()}_${autoGeneratedRoomId}`,
                    `${actuatorName} - ${roomName}`,
                    mqttTopic
                ]
            );

            actuators.push({
                id: actuatorResult.insertId,
                type: actuatorType,
                name: actuatorName,
                mqttTopic: mqttTopic
            });
            createdActuatorTopics.push(mqttTopic);
            console.log(`✅ [Route] Created actuator: ${actuatorType} - ${mqttTopic}`);
        }

        // MQTT subscription logic
        const mqttClient = require("../server");
        if (mqttClient?.mqttConnection?.mqttClient) {
            const client = mqttClient.mqttConnection.mqttClient;

            createdSensorTopics.forEach(topic => {
                client.subscribe(topic, { qos: 1 }, (err) => {
                    if (!err) {
                        console.log(`🔌 MQTT: Auto-subscribed to sensor topic: ${topic}`);
                    } else {
                        console.error(`❌ MQTT: Failed to subscribe to ${topic}:`, err);
                    }
                });
            });

            createdActuatorTopics.forEach(topic => {
                client.subscribe(topic, { qos: 1 }, (err) => {
                    if (!err) {
                        console.log(`🔌 MQTT: Auto-subscribed to actuator topic: ${topic}`);
                    } else {
                        console.error(`❌ MQTT: Failed to subscribe to ${topic}:`, err);
                    }
                });
            });

            if (mqttClient.registerUser) {
                mqttClient.registerUser(userId, roomName);
                console.log(`✅ [Route] Registered user ${userId} with MQTT for room: ${roomName}`);
            }
        } else {
            console.warn(`⚠️ [Route] MQTT client not available for auto-subscription`);
        }

        // Create room control settings
        await pool.execute(
            `INSERT INTO room_control_settings (room_id, control_mode, target_temperature) 
             VALUES (?, 'auto', 22.00)`,
            [autoGeneratedRoomId]
        );

        res.status(201).json({
            status: "success",
            message: `Room "${roomName}" created successfully`,
            roomId: autoGeneratedRoomId,
            roomCode: roomName,
            roomName: roomName,
            sensors: sensors,
            actuators: actuators,
            mqttTopics: {
                sensors: sensorTopics,
                actuators: actuatorTopics
            },
            autoSubscribed: true,
            subscriptionInfo: {
                sensorTopics: createdSensorTopics,
                actuatorTopics: createdActuatorTopics,
                message: "System is now listening for data on these topics"
            }
        });

        console.log(`✅ [Route POST /locations/create-room] Success - Room created and subscribed to ${createdSensorTopics.length + createdActuatorTopics.length} topics`);

    } catch (error) {
        console.error(`❌ [Route POST /locations/create-room] Error:`, error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error",
            error: error.message
        });
    }
});


// GET /api/actuator-types - Get all available actuator types
// GET /api/actuator-types - Get all available actuator types
// GET /api/actuator-types - Get all available actuator types
locationRouter.get("/actuator-types", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /actuator-types] User: ${req.user.id}`);

    try {
        const [actuatorTypes] = await pool.execute(
            `SELECT 
                id,
                type_code,
                type_name,
                description,
                control_type,
                category
             FROM actuator_types
             ORDER BY id`
        );

        console.log(`✅ [Route] Found ${actuatorTypes.length} actuator types`);
        console.log('Raw data:', actuatorTypes);

        const formattedTypes = actuatorTypes.map(type => ({
            code: type.type_code,
            name: type.type_name,
            icon: getActuatorIcon(type.type_code),
            description: type.description
        }));

        console.log('Formatted types:', formattedTypes);

        res.json({
            status: "success",
            actuator_types: formattedTypes
        });

    } catch (error) {
        console.error("❌ [Route GET /actuator-types] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error",
            error: error.message
        });
    }
});

function getActuatorIcon(typeCode) {
    const iconMap = {
        'bowl_fan_status': '🫧',
        'sonar_pump_status': '⚡',
        'co2_fermentation_status': '🫧',
        'sugar_fermentation_status': '🍬'
    };
    return iconMap[typeCode] || '🔧';
}





// PUT /api/locations/:roomId/update - Update room and MQTT topics
locationRouter.put("/locations/:roomId/update", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route PUT /locations/:roomId/update] User: ${req.user.id}`);

    try {
        const userId = req.user.id;
        const roomId = req.params.roomId;
        const { roomName, sensorTopics, actuatorTopics } = req.body;

        // Validate input
        if (!roomName) {
            return res.status(400).json({
                status: "failed",
                message: "roomName is required"
            });
        }

        console.log(`🔵 [Route] Updating room ID: ${roomId}`);

        // Check if room belongs to user
        const [rooms] = await pool.execute(
            'SELECT room_name FROM rooms WHERE user_id = ? AND id = ? AND is_active = 1',
            [userId, roomId]
        );

        if (rooms.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: "Room not found or access denied"
            });
        }

        // Update room name
        await pool.execute(
            'UPDATE rooms SET room_name = ?, room_code = ?, description = ? WHERE id = ? AND user_id = ?',
            [roomName, roomName, `Room ${roomName}`, roomId, userId]
        );

        console.log(`✅ [Route] Updated room name to: ${roomName}`);

        // Get MQTT client for topic management
        const mqttClient = require("../server");
        const client = mqttClient?.mqttConnection?.mqttClient;

        // Update sensor MQTT topics if provided
        if (sensorTopics && Object.keys(sensorTopics).length > 0) {
            for (const [sensorType, newMqttTopic] of Object.entries(sensorTopics)) {
                // Get existing sensor
                const [existingSensors] = await pool.execute(
                    `SELECT s.id, s.mqtt_topic, st.type_code 
                     FROM sensors s
                     JOIN sensor_types st ON s.sensor_type_id = st.id
                     WHERE s.room_id = ? AND s.user_id = ? AND st.type_code = ? AND s.is_active = 1`,
                    [roomId, userId, sensorType]
                );

                if (existingSensors.length > 0) {
                    const oldTopic = existingSensors[0].mqtt_topic;
                    const sensorId = existingSensors[0].id;

                    // Update MQTT topic in database
                    await pool.execute(
                        'UPDATE sensors SET mqtt_topic = ? WHERE id = ?',
                        [newMqttTopic, sensorId]
                    );

                    // MQTT: Unsubscribe from old topic and subscribe to new one
                    if (client && oldTopic !== newMqttTopic) {
                        // Unsubscribe from old topic
                        client.unsubscribe(oldTopic, (err) => {
                            if (!err) {
                                console.log(`🔌 MQTT: Unsubscribed from old sensor topic: ${oldTopic}`);
                            } else {
                                console.error(`❌ MQTT: Failed to unsubscribe from ${oldTopic}:`, err);
                            }
                        });

                        // Subscribe to new topic
                        client.subscribe(newMqttTopic, { qos: 1 }, (err) => {
                            if (!err) {
                                console.log(`🔌 MQTT: Subscribed to new sensor topic: ${newMqttTopic}`);
                            } else {
                                console.error(`❌ MQTT: Failed to subscribe to ${newMqttTopic}:`, err);
                            }
                        });
                    }

                    console.log(`✅ [Route] Updated sensor ${sensorType}: ${oldTopic} → ${newMqttTopic}`);
                }
            }
        }

        // Update actuator MQTT topics if provided
        if (actuatorTopics && Object.keys(actuatorTopics).length > 0) {
            for (const [actuatorType, newMqttTopic] of Object.entries(actuatorTopics)) {
                // Get existing actuator
                const [existingActuators] = await pool.execute(
                    `SELECT a.id, a.mqtt_topic, at.type_code 
                     FROM actuators a
                     JOIN actuator_types at ON a.actuator_type_id = at.id
                     WHERE a.room_id = ? AND a.user_id = ? AND at.type_code = ? AND a.is_active = 1`,
                    [roomId, userId, actuatorType]
                );

                if (existingActuators.length > 0) {
                    const oldTopic = existingActuators[0].mqtt_topic;
                    const actuatorId = existingActuators[0].id;

                    // Update MQTT topic in database
                    await pool.execute(
                        'UPDATE actuators SET mqtt_topic = ? WHERE id = ?',
                        [newMqttTopic, actuatorId]
                    );

                    // MQTT: Unsubscribe from old topic and subscribe to new one
                    if (client && oldTopic !== newMqttTopic) {
                        // Unsubscribe from old topic
                        client.unsubscribe(oldTopic, (err) => {
                            if (!err) {
                                console.log(`🔌 MQTT: Unsubscribed from old actuator topic: ${oldTopic}`);
                            } else {
                                console.error(`❌ MQTT: Failed to unsubscribe from ${oldTopic}:`, err);
                            }
                        });

                        // Subscribe to new topic
                        client.subscribe(newMqttTopic, { qos: 1 }, (err) => {
                            if (!err) {
                                console.log(`🔌 MQTT: Subscribed to new actuator topic: ${newMqttTopic}`);
                            } else {
                                console.error(`❌ MQTT: Failed to subscribe to ${newMqttTopic}:`, err);
                            }
                        });
                    }

                    console.log(`✅ [Route] Updated actuator ${actuatorType}: ${oldTopic} → ${newMqttTopic}`);
                }
            }
        }

        // Get updated devices
        const [sensors] = await pool.execute(
            `SELECT s.id, s.sensor_code, s.sensor_name, s.mqtt_topic, st.type_code, st.type_name, st.unit
             FROM sensors s
             JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE s.room_id = ? AND s.user_id = ? AND s.is_active = 1`,
            [roomId, userId]
        );

        const [actuators] = await pool.execute(
            `SELECT a.id, a.actuator_code, a.actuator_name, a.mqtt_topic, at.type_code, at.type_name
             FROM actuators a
             JOIN actuator_types at ON a.actuator_type_id = at.id
             WHERE a.room_id = ? AND a.user_id = ? AND a.is_active = 1`,
            [roomId, userId]
        );

        res.json({
            status: "success",
            message: `Room "${roomName}" updated successfully`,
            roomId: roomId,
            roomName: roomName,
            sensors: sensors,
            actuators: actuators
        });

        console.log(`✅ [Route PUT /locations/:roomId/update] Success`);

    } catch (error) {
        console.error(`❌ [Route PUT /locations/:roomId/update] Error:`, error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error",
            error: error.message
        });
    }
});


// ==================== DELETE ROUTE (FIXED) ====================

// DELETE /api/locations/:roomId - Delete room and unsubscribe from MQTT topics
// DELETE /api/locations/:roomId - Delete room and unsubscribe from MQTT topics
// DELETE /api/locations/:roomId - Hard delete room and all related data
locationRouter.delete("/locations/:roomId", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route DELETE /locations/:roomId] User: ${req.user.id}`);
    console.log(`🔵 [Route DELETE] Request params:`, req.params);
    console.log(`🔵 [Route DELETE] Room ID to delete:`, req.params.roomId);

    try {
        const userId = req.user.id;
        const roomId = req.params.roomId;

        console.log(`🔵 [Route] Attempting to delete room: ${roomId} for user: ${userId}`);

        // Check if room belongs to user and is active
        const [rooms] = await pool.execute(
            'SELECT id, room_name FROM rooms WHERE user_id = ? AND id = ? AND is_active = 1',
            [userId, roomId]
        );

        console.log(`🔵 [Route] Found rooms:`, rooms);

        if (rooms.length === 0) {
            console.warn(`⚠️ [Route] Room ${roomId} not found or already deleted`);
            return res.status(404).json({
                status: "failed",
                message: "Room not found or access denied"
            });
        }

        const roomName = rooms[0].room_name;
        console.log(`🔵 [Route] Deleting room: ${roomName}`);

        // Get all MQTT topics for this room before deleting
        const [sensors] = await pool.execute(
            'SELECT id, mqtt_topic FROM sensors WHERE room_id = ? AND user_id = ? AND is_active = 1',
            [roomId, userId]
        );

        const [actuators] = await pool.execute(
            'SELECT id, mqtt_topic FROM actuators WHERE room_id = ? AND user_id = ? AND is_active = 1',
            [roomId, userId]
        );

        console.log(`🔵 [Route] Found ${sensors.length} sensors and ${actuators.length} actuators to delete`);

        // MQTT: Unsubscribe from all topics before deletion
        const mqttClient = require("../server");
        const client = mqttClient?.mqttConnection?.mqttClient;

        if (client) {
            // Unsubscribe from sensor topics
            sensors.forEach(sensor => {
                if (sensor.mqtt_topic) {
                    client.unsubscribe(sensor.mqtt_topic, (err) => {
                        if (!err) {
                            console.log(`🔌 MQTT: Unsubscribed from sensor topic: ${sensor.mqtt_topic}`);
                        } else {
                            console.error(`❌ MQTT: Failed to unsubscribe from ${sensor.mqtt_topic}:`, err);
                        }
                    });
                }
            });

            // Unsubscribe from actuator topics
            actuators.forEach(actuator => {
                if (actuator.mqtt_topic) {
                    client.unsubscribe(actuator.mqtt_topic, (err) => {
                        if (!err) {
                            console.log(`🔌 MQTT: Unsubscribed from actuator topic: ${actuator.mqtt_topic}`);
                        } else {
                            console.error(`❌ MQTT: Failed to unsubscribe from ${actuator.mqtt_topic}:`, err);
                        }
                    });
                }
            });
        } else {
            console.warn(`⚠️ [Route] MQTT client not available for unsubscription`);
        }

        // ✅ HARD DELETE: Delete room (CASCADE will automatically delete sensors, actuators, measurements, etc.)
        const [deleteResult] = await pool.execute(
            'DELETE FROM rooms WHERE id = ? AND user_id = ?',
            [roomId, userId]
        );

        console.log(`✅ [Route] Hard delete result:`, deleteResult);

        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({
                status: "failed",
                message: "Room could not be deleted"
            });
        }

        console.log(`✅ [Route] Successfully HARD DELETED room ${roomId} and all related data via CASCADE`);
        console.log(`📊 [Route] Cascade deleted: ${sensors.length} sensors, ${actuators.length} actuators, and all measurements`);

        res.json({
            status: "success",
            message: `Room "${roomName}" permanently deleted`,
            roomId: parseInt(roomId),
            deletedData: {
                sensors: sensors.length,
                actuators: actuators.length,
                cascadeDeleted: true
            }
        });

    } catch (error) {
        console.error("❌ [Route DELETE /locations/:roomId] Error:", error);
        console.error("❌ [Route DELETE] Error stack:", error.stack);
        res.status(500).json({
            status: "failed",
            message: "Internal server error",
            error: error.message
        });
    }
});

// GET /api/locations/:location/sensors - Get active sensors for a room
locationRouter.get("/locations/:location/sensors", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /locations/:location/sensors] User: ${req.user.id}`);

    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        console.log(`🔵 [Route] Looking for room: "${location}"`);

        // ✅ SIMPLIFIED: Try exact match first, then flexible match
        const [rooms] = await pool.execute(
            `SELECT id, room_name, room_code 
             FROM rooms 
             WHERE user_id = ? 
             AND is_active = 1
             AND (room_code = ? OR room_name = ?)
             LIMIT 1`,
            [userId, location, location]
        );

        console.log(`🔵 [Route] Found rooms:`, rooms);

        if (rooms.length === 0) {
            console.warn(`⚠️ [Route] No room found for location: ${location}`);

            // Try to find ANY active room for debugging
            const [debugRooms] = await pool.execute(
                'SELECT id, room_name, room_code FROM rooms WHERE user_id = ? AND is_active = 1',
                [userId]
            );
            console.log(`🔵 [Route] All available rooms for user:`, debugRooms);

            return res.status(404).json({
                status: "failed",
                message: `Room not found for location: ${location}`,
                searchedFor: location,
                availableRooms: debugRooms.map(r => ({ name: r.room_name, code: r.room_code }))
            });
        }

        const roomId = rooms[0].id;
        console.log(`✅ [Route] Found room_id: ${roomId} (${rooms[0].room_name})`);

        // Get all active sensors for this room
        const [sensors] = await pool.execute(
            `SELECT 
                s.id,
                s.sensor_code,
                s.sensor_name,
                s.mqtt_topic,
                st.type_code,
                st.type_name,
                st.unit,
                s.last_reading_at
             FROM sensors s
             INNER JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE s.room_id = ? AND s.user_id = ? AND s.is_active = 1
             ORDER BY st.type_name`,
            [roomId, userId]
        );

        console.log(`✅ [Route] Found ${sensors.length} active sensors for ${location}`);
        console.log(`📊 [Route] Sensors:`, sensors.map(s => ({ name: s.sensor_name, type: s.type_code })));

        res.json({
            status: "success",
            roomId: roomId,
            roomName: rooms[0].room_name,
            roomCode: rooms[0].room_code,
            sensors: sensors
        });

    } catch (error) {
        console.error("❌ [Route GET /locations/:location/sensors] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error",
            error: error.message
        });
    }
});

// GET /api/locations/:roomId/devices - Get all sensors and actuators for a room
locationRouter.get("/locations/:roomId/devices", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /locations/:roomId/devices] User: ${req.user.id}`);

    try {
        const userId = req.user.id;
        const roomId = req.params.roomId;

        // Get sensors
        const [sensors] = await pool.execute(
            `SELECT 
                s.id, s.sensor_code, s.sensor_name, s.mqtt_topic,
                st.type_code, st.type_name, st.unit
             FROM sensors s
             JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE s.user_id = ? AND s.room_id = ? AND s.is_active = 1`,
            [userId, roomId]
        );

        // Get actuators
        const [actuators] = await pool.execute(
            `SELECT 
                a.id, a.actuator_code, a.actuator_name, a.mqtt_topic,
                at.type_code, at.type_name
             FROM actuators a
             JOIN actuator_types at ON a.actuator_type_id = at.id
             WHERE a.user_id = ? AND a.room_id = ? AND a.is_active = 1`,
            [userId, roomId]
        );

        res.json({
            status: "success",
            roomId: roomId,
            sensors: sensors,
            actuators: actuators
        });

    } catch (error) {
        console.error("❌ [Route GET /locations/:roomId/devices] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});


// ==================== MQTT TOPIC TEST ROUTE (TLS ENABLED) ====================
// Add this to your locationRoutes.js

/**
 * Helper function to prepare TLS options for test client
 * Reuses the same logic as MqttConnection.js
 */
function prepareTLSOptionsForTest() {
    try {
        const caCertPath = process.env.MQTT_CA_CERT_PATH;
        const clientCertPath = process.env.MQTT_CLIENT_CERT_PATH;
        const clientKeyPath = process.env.MQTT_CLIENT_KEY_PATH;

        // Check if broker.crt exists with multiple path attempts
        const possiblePaths = [
            caCertPath,
            './src/mqtt/Connection/broker (1).crt',
            './src/mqtt/connection/broker (1).crt',
        ];

        let validCertPath = null;
        for (const path of possiblePaths) {
            if (fs.existsSync(path)) {
                validCertPath = path;
                console.log(`✅ [Test Client] Found certificate at: ${path}`);
                break;
            }
        }

        if (!validCertPath) {
            console.warn(`⚠️ [Test Client] No certificate found, attempting without TLS`);
            return null;
        }

        const tlsOptions = {
            ca: fs.readFileSync(validCertPath),
            rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true',
            ...(clientCertPath && fs.existsSync(clientCertPath) && {
                cert: fs.readFileSync(clientCertPath)
            }),
            ...(clientKeyPath && fs.existsSync(clientKeyPath) && {
                key: fs.readFileSync(clientKeyPath)
            }),
            secureProtocol: 'TLSv1_2_method',
            checkServerIdentity: () => undefined,
            requestCert: false,
            agent: false
        };

        console.log(`🔒 [Test Client] TLS configured successfully`);
        return tlsOptions;
    } catch (error) {
        console.error('❌ [Test Client] Failed to configure TLS:', error.message);
        return null;
    }
}

/**
 * POST /api/locations/test-mqtt-topic
 * Test if an MQTT topic is publishing data in real-time
 * Supports both secure (TLS) and non-secure connections
 */
locationRouter.post("/locations/test-mqtt-topic", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /locations/test-mqtt-topic] User: ${req.user.id}`);

    try {
        const userId = req.user.id;
        const { topic, roomId } = req.body;

        // Validation
        if (!topic) {
            return res.status(400).json({
                success: false,
                message: 'Topic is required'
            });
        }

        if (topic.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Topic cannot be empty'
            });
        }

        if (topic.includes(' ')) {
            return res.status(400).json({
                success: false,
                message: 'Topic name cannot contain spaces'
            });
        }

        console.log(`🔍 [MQTT Test] Testing topic: ${topic} for user: ${userId}`);

        // ✅ Use the same MQTT broker as your main handler
        const MQTT_HOST = process.env.MQTT_HOST || "mqtts://192.168.88.221:8883";
        const MQTT_USERNAME = process.env.MQTT_USERNAME || "admin";
        const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "StrongPassword123";

        // ✅ Get TLS options (same as MqttConnection.js)
        const tlsOptions = prepareTLSOptionsForTest();

        // ✅ Build connection options
        const connectOptions = {
            clientId: `test_${userId}_${Date.now()}`,
            keepalive: 60,
            clean: true, // Clean session for testing
            username: MQTT_USERNAME,
            password: MQTT_PASSWORD,
            ...(tlsOptions || {}), // Spread TLS options if available
            connectTimeout: 5000,
            reconnectPeriod: 0, // Don't auto-reconnect for test
            protocolVersion: 4
        };

        console.log(`🔗 [MQTT Test] Connecting to: ${MQTT_HOST}`);
        console.log(`🔒 [MQTT Test] TLS Enabled: ${tlsOptions ? 'Yes' : 'No'}`);

        // ✅ Create temporary test client
        const testClient = mqtt.connect(MQTT_HOST, connectOptions);

        let dataReceived = false;
        let receivedData = null;
        let timeoutId = null;

        // Promise-based test with 10-second timeout
        const testPromise = new Promise((resolve, reject) => {
            // Set 10-second timeout
            timeoutId = setTimeout(() => {
                console.log(`⏱️ [MQTT Test] Timeout - No data on: ${topic}`);
                testClient.end(true);
                resolve({
                    success: false,
                    message: `Timeout: No data received on topic "${topic}" within 10 seconds. Ensure your sensor/publisher is active.`,
                    dataReceived: false,
                    topic: topic
                });
            }, 10000); // 10 seconds

            // Handle successful connection
            testClient.on('connect', () => {
                console.log(`✅ [MQTT Test] Test client connected to broker`);

                // Validate TLS if enabled
                if (testClient.stream && testClient.stream.encrypted) {
                    console.log(`🔒 [MQTT Test] Secure TLS connection established`);
                }

                testClient.subscribe(topic, { qos: 0 }, (err) => {
                    if (err) {
                        console.error(`❌ [MQTT Test] Subscribe error:`, err);
                        clearTimeout(timeoutId);
                        testClient.end(true);
                        reject({
                            success: false,
                            message: `Failed to subscribe to topic "${topic}": ${err.message}`,
                            dataReceived: false
                        });
                    } else {
                        console.log(`👂 [MQTT Test] Listening for data on: ${topic}`);
                    }
                });
            });

            // Handle incoming MQTT messages
            testClient.on('message', (receivedTopic, message) => {
                if (receivedTopic === topic && !dataReceived) {
                    dataReceived = true;
                    receivedData = message.toString();

                    console.log(`📊 [MQTT Test] ✅ Data received from ${topic}:`, receivedData.substring(0, 100));

                    clearTimeout(timeoutId);
                    testClient.end(true);

                    // Try to parse as JSON
                    let parsedData = null;
                    let dataType = 'raw';

                    try {
                        parsedData = JSON.parse(receivedData);
                        dataType = 'json';
                    } catch (e) {
                        // Not JSON, treat as raw string/number
                        parsedData = receivedData;
                    }

                    resolve({
                        success: true,
                        message: `✅ Successfully received data from topic: ${topic}`,
                        dataReceived: true,
                        topic: receivedTopic,
                        sampleData: parsedData,
                        dataType: dataType,
                        rawData: receivedData,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // Handle MQTT connection errors
            testClient.on('error', (err) => {
                console.error(`❌ [MQTT Test] Connection error:`, err.message);
                clearTimeout(timeoutId);
                testClient.end(true);
                reject({
                    success: false,
                    message: `MQTT connection error: ${err.message}. Check broker settings and certificate.`,
                    dataReceived: false
                });
            });

            // Handle disconnection during test
            testClient.on('close', () => {
                console.log(`🔌 [MQTT Test] Test client disconnected for topic: ${topic}`);
            });

            // Handle offline event
            testClient.on('offline', () => {
                console.warn(`📴 [MQTT Test] Test client went offline`);
            });
        });

        // Execute the test and return result
        const result = await testPromise;
        console.log(`✅ [MQTT Test] Test completed for topic: ${topic}, Success: ${result.success}`);
        return res.json(result);

    } catch (error) {
        console.error(`❌ [Route POST /locations/test-mqtt-topic] Error:`, error.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error during topic test",
            error: error.message
        });
    }
});





console.log("✅ [Location Routes] All routes initialized");
module.exports = locationRouter;
