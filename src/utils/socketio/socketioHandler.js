const jwt = require("jsonwebtoken");
const pool = require("../../config/db");

let mqttHandler = null;
const activeUsers = new Set();

const createSocketIOServer = (server) => {
    const io = require("socket.io")(server, {
        transports: ["websocket", "polling"],
        allowUpgrades: true,
        cors: {
            origin: "http://localhost:5173",
            methods: ["GET", "POST"],
            credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });

    io.setMqtt = (handler) => {
        mqttHandler = handler;
        console.log('✅ MQTT handler set in Socket.IO');
    };

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("Unauthorized"));

        try {
            socket.user = jwt.verify(token, process.env.JWT_SECRET);
            next();
        } catch {
            next(new Error("Invalid token"));
        }
    });

    // Auto-join user room and track active users
    io.on("connection", (socket) => {
        const userId = socket.user.id;
        const username = socket.user.username;

        activeUsers.add(userId);
        socket.join(`user_${userId}`);

        // 🔥 NEW: Register user with MQTT handler
        if (mqttHandler?.registerUser) {
            mqttHandler.registerUser(userId, "sensor-room");
            console.log(`✅ User ${userId} (${username}) registered with MQTT handler`);
        } else {
            console.warn(`⚠️ MQTT handler not available for user ${userId}`);
        }

        console.log(`✅ User ${userId} (${username}) connected`);

        socket.on("locationAdded", (data = {}) => {
            if (!data.location) return;
            console.log(`📍 User ${userId} added location: ${data.location}`);

            // 🔥 NEW: Register user for this location with MQTT handler
            if (mqttHandler?.registerUser) {
                mqttHandler.registerUser(userId, data.location);
            }

            if (mqttHandler?.handleLocationAddition) {
                mqttHandler.handleLocationAddition(userId, data.location);
            }

            if (mqttHandler?.addLocationForUser) {
                mqttHandler.addLocationForUser(userId, data.location);
            }
        });

        socket.on("ping", (ack) => { if (typeof ack === "function") ack(); });

        socket.on("publishToESP", async (data = {}) => {
            try {
                const { espDevice, command, value } = data;
                if (!espDevice || !command) {
                    socket.emit('publishResult', { success: false, error: 'Missing device or command' });
                    return;
                }

                if (!['ESP', 'ESP2'].includes(espDevice)) {
                    socket.emit('publishResult', { success: false, error: 'Invalid ESP device' });
                    return;
                }

                // Use the connected instance that contains this.mqttClient
                const success = mqttHandler?.publishESPCommand
                    ? mqttHandler.publishESPCommand(espDevice, command, value)
                    : false;

                socket.emit('publishResult', {
                    success,
                    espDevice,
                    command,
                    value,
                    timestamp: new Date()
                });
                console.log(`📤 User ${userId} sent command ${command} to ${espDevice}`);
            } catch (error) {
                console.error('❌ Error handling ESP publish request:', error);
                socket.emit('publishResult', { success: false, error: error.message });
            }
        });



        // ============================================
        // FAN SPEED CONTROL HANDLER (Socket.IO)
        // ============================================
        socket.on('setFanSpeed', async (data) => {
            console.log(`\n🌀 [Socket.IO] setFanSpeed event received from ${username}`);
            console.log(`🌀 Data:`, data);

            const { roomCode, speed } = data;

            // Validate input
            if (!roomCode) {
                socket.emit('fanSpeedError', {
                    message: 'Room code is required',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            if (speed === undefined || speed === null) {
                socket.emit('fanSpeedError', {
                    message: 'Speed value is required',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            const speedValue = parseInt(speed);
            if (isNaN(speedValue) || speedValue < 0 || speedValue > 100) {
                socket.emit('fanSpeedError', {
                    message: 'Speed must be between 0 and 100',
                    timestamp: new Date().toISOString()
                });
                return;
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
                    socket.emit('fanSpeedError', {
                        message: 'Room not found or access denied',
                        timestamp: new Date().toISOString()
                    });
                    await connection.rollback();
                    return;
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
                    socket.emit('fanSpeedError', {
                        message: 'Fan speed controller not found in this room',
                        timestamp: new Date().toISOString()
                    });
                    await connection.rollback();
                    return;
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
                if (mqttHandler && mqttTopic) {
                    try {
                        const published = mqttHandler.publishToTopic(mqttTopic, speedValue.toString());
                        if (published) {
                            console.log(`✅ Published to MQTT topic: ${mqttTopic}`);
                        } else {
                            console.warn(`⚠️ MQTT publish returned false for topic: ${mqttTopic}`);
                        }
                    } catch (mqttError) {
                        console.error(`❌ MQTT publish error:`, mqttError);
                        // Don't fail the entire operation, just log the error
                    }
                } else {
                    console.warn(`⚠️ MQTT handler unavailable or no topic configured`);
                }

                // Emit success to requesting socket
                socket.emit('fanSpeedSuccess', {
                    roomCode,
                    actuatorId,
                    actuatorName,
                    oldSpeed: parseInt(oldSpeed),
                    newSpeed: speedValue,
                    timestamp: new Date().toISOString()
                });

                // Broadcast to all users in the room
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

                console.log(`✅ Fan speed control completed successfully\n`);

            } catch (error) {
                await connection.rollback();
                console.error(`❌ [Socket.IO setFanSpeed] Error:`, error);

                socket.emit('fanSpeedError', {
                    message: 'Failed to set fan speed. Please try again.',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            } finally {
                connection.release();
            }
        });


        socket.on('sendActuatorCommand', (data) => {
            const { userId, location, command } = data;
            console.log(`🎛️ Actuator command: ${command} for user ${userId} in ${location}`);
            const success = mqttHandler.publishToActuator(userId, location, command);
            socket.emit('publishResult', {
                success,
                topic: `home/${userId}/${location}/actuator`,
                message: command,
                error: success ? null : 'Failed to send actuator command'
            });
        });

        socket.on("publishTextToMQTT", async (data = {}) => {
            try {
                const { topic, message, location } = data;
                if (!topic || !message) {
                    socket.emit('publishResult', {
                        success: false,
                        error: 'Missing topic or message',
                        topic
                    });
                    return;
                }

                // Use the connected MQTT instance to publish simple text
                const success = mqttHandler?.publishSimple
                    ? mqttHandler.publishSimple(topic, message)
                    : false;

                socket.emit('publishResult', {
                    success,
                    topic,
                    message,
                    timestamp: new Date()
                });
                console.log(`📤 User ${userId} sent text message "${message}" to topic "${topic}"`);
            } catch (error) {
                console.error('❌ Error handling text MQTT publish:', error);
                socket.emit('publishResult', {
                    success: false,
                    error: error.message,
                    topic: data.topic
                });
            }
        });

        // Updated chart data request handler
        socket.on("requestChartData", async ({ sensorId, period = "24h" }) => {
            try {
                const periodMap = {
                    "1h": "1 HOUR",
                    "6h": "6 HOUR",
                    "24h": "24 HOUR",
                    "7d": "7 DAY",
                    "30d": "30 DAY"
                };
                const interval = periodMap[period] || "24 HOUR";

                const [measurements] = await pool.execute(`
      SELECT 
        sm.measured_value as value,
        sm.measured_at as timestamp,
        sm.quality_indicator,
        s.sensor_name,
        st.unit
      FROM sensor_measurements sm
      JOIN sensors s ON sm.sensor_id = s.id
      JOIN sensor_types st ON s.sensor_type_id = st.id
      WHERE sm.sensor_id = ?
      AND s.user_id = ?
      AND sm.measured_at >= NOW() - INTERVAL ${interval}
      ORDER BY sm.measured_at ASC
      LIMIT 10000
    `, [sensorId, userId]);

                socket.emit('chartDataUpdate', {
                    sensorId,
                    measurements: measurements.map(m => ({
                        timestamp: m.timestamp,
                        value: parseFloat(m.value),
                        quality: m.quality_indicator
                    }))
                });
            } catch (error) {
                socket.emit('chartError', { sensorId, message: error.message });
            }
        });

        socket.on('joinSensor', (sensorId) => {
            socket.join(`sensor_${sensorId}`);
            console.log(`📊 User ${userId} joined sensor room: sensor_${sensorId}`);
        });

        socket.on('leaveSensor', (sensorId) => {
            socket.leave(`sensor_${sensorId}`);
            console.log(`📊 User ${userId} left sensor room: sensor_${sensorId}`);
        });


        // Join location-specific rooms (when user selects locations)
        socket.on("joinLocation", (location) => {
            // 🔥 NEW: Register user for this location with MQTT handler
            if (mqttHandler?.registerUser) {
                mqttHandler.registerUser(userId, location);
                console.log(`📍 User ${userId} registered with MQTT for location: ${location}`);
            }

            // Join both room formats for complete coverage
            socket.join(`user_${userId}_${location}`); // For environmentUpdate, controlUpdate
            socket.join(`location_${location}`); // For newMeasurement (charts)
            console.log(`📍🔗 User ${userId} joined dual rooms for ${location}:`);
            console.log(` • user_${userId}_${location} (environment updates)`);
            console.log(` • location_${location} (chart real-time data)`);
        });

        socket.on("leaveLocation", (location) => {
            // 🔥 NEW: Unregister user from this location with MQTT handler
            if (mqttHandler?.unregisterUser) {
                mqttHandler.unregisterUser(userId, location);
                console.log(`📤 User ${userId} unregistered from MQTT location: ${location}`);
            }

            // Leave both room formats
            socket.leave(`user_${userId}_${location}`);
            socket.leave(`location_${location}`);
            console.log(`📤🔗 User ${userId} left dual rooms for ${location}`);
        });

        socket.on("disconnect", async () => {
            activeUsers.delete(userId);

            // 🔥 NEW: Unregister user from MQTT handler
            if (mqttHandler?.unregisterUser) {
                mqttHandler.unregisterUser(userId);
                console.log(`📤 User ${userId} unregistered from MQTT handler`);
            }

            try {
                // Set user as offline in database
                await pool.query("UPDATE users SET is_active = 0 WHERE id = ?", [userId]);
                console.log(`📤 User ${userId} set to offline in database`);
            } catch (error) {
                console.error(`❌ Failed to set user ${userId} offline:`, error);
            }

            console.log(`❌ User ${userId} (${username}) disconnected`);
            console.log(`👥 Active users (${activeUsers.size}): [${Array.from(activeUsers).join(', ')}]`);
        });

        socket.on("logout", async () => {
            activeUsers.delete(userId);

            // 🔥 NEW: Unregister user from MQTT handler on logout
            if (mqttHandler?.unregisterUser) {
                mqttHandler.unregisterUser(userId);
                console.log(`🚪 User ${userId} unregistered from MQTT handler on logout`);
            }

            try {
                await pool.query("UPDATE users SET is_active = 0 WHERE id = ?", [userId]);
                console.log(`🚪 User ${userId} logged out - set to offline in database`);
            } catch (error) {
                console.error(`❌ Failed to set user ${userId} offline on logout:`, error);
            }

            socket.leave(`user_${userId}`);
            console.log(`🚪 User ${userId} (${username}) logged out`);
        });
    });

    io.getActiveUsers = () => Array.from(activeUsers);
    io.isUserActive = (userId) => activeUsers.has(parseInt(userId));

    return io;
};

module.exports = { createSocketIOServer };
