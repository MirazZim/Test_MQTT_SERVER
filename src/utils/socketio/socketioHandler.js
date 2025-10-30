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

        socket.on("requestChartData", async ({ location, days = 7 }) => {
            try {
                const [measurements] = await pool.execute(`
                    SELECT temperature, humidity, airflow, created_at
                    FROM measurements
                    WHERE location = ?
                    AND created_at >= NOW() - INTERVAL ? DAY
                    AND user_id = ?
                    ORDER BY created_at ASC
                    LIMIT 1000
                `, [location, days, userId]);

                socket.emit('chartDataUpdate', {
                    location,
                    measurements: measurements
                });
                console.log(`📊 Sent ${measurements.length} chart data points for ${location} to user ${userId}`);
            } catch (error) {
                console.error('Error fetching chart data:', error);
                socket.emit('chartError', {
                    location,
                    message: error.message
                });
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
