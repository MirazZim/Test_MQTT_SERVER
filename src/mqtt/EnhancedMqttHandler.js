const { Mutex } = require("async-mutex");
const MqttConnection = require('./connection/MqttConnection');
const pool = require('../config/db');

class EnhancedMqttHandler {
    constructor(io) {
        console.log(`🔵 [EnhancedMqttHandler] Initializing FULLY DYNAMIC MQTT Handler...`);
        this.io = io;
        this.mqttConnection = new MqttConnection();
        this.mqttClient = null;
        this.activeUsers = new Map();
        this.subscribedTopics = new Set();
        this.sensorData = {
            // ✅ KEEP: Original sensor data cache for backward compatibility
            temperature: null,
            humidity: null,
            bowl_temp: null,
            bowl_fan_status: null,
            sonar_distance: null,
            sonar_pump_status: null,
            co2_level: null,
            co2_fermentation_status: null,
            sugar_level: null,
            sugar_fermentation_status: null,
            esp3_data: null
        };
        this.sensorDataMutex = new Mutex();
        this.locationMutexes = new Map();
        this.cleanupInterval = null;

        console.log(`✅ [EnhancedMqttHandler] Initialized with dynamic handler`);
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 Client connected: ${socket.id}`);

            socket.on('joinRoom', (room) => {
                socket.join(room);
                console.log(`✅ Socket ${socket.id} joined room: ${room}`);
            });

            socket.on('leaveRoom', (room) => {
                socket.leave(room);
                console.log(`❌ Socket ${socket.id} left room: ${room}`);
            });

            socket.on('disconnect', () => {
                console.log(`🔌 Client disconnected: ${socket.id}`);
            });
        });
    }

    connect() {
        console.log(`🔵 [EnhancedMqttHandler] Connecting to MQTT broker...`);
        this.setupSocketHandlers();

        this.mqttConnection.connect(
            (client) => this.onConnect(client),
            (topic, message) => this.onMessage(topic, message),
            (error) => this.onError(error)
        );

        if (this.mqttConnection.mqttClient) {
            this.mqttConnection.mqttClient.on('reconnect', () => {
                console.log('🔄 Reconnecting to MQTT broker...');
                this.subscribedTopics.clear();
            });

            this.mqttConnection.mqttClient.on('close', () => {
                console.log('🔌 MQTT connection closed');
                if (this.cleanupInterval) {
                    clearInterval(this.cleanupInterval);
                    this.cleanupInterval = null;
                }
            });
        }
    }

    async onConnect(client) {
        console.log(`🔵 [EnhancedMqttHandler] Connected to MQTT broker`);

        if (!client || !client.connected) {
            console.error('❌ [EnhancedMqttHandler] Client not properly connected');
            return;
        }

        this.mqttClient = client;

        try {
            // ✅ KEEP: Subscribe to legacy topics for backward compatibility
            await this.subscribeLegacyTopics(client);

            // ✅ NEW: Subscribe to dynamic database topics
            await this.subscribeToAllActiveSensors(client);
            await this.subscribeToAllActiveActuators(client);

            // Periodic cleanup
            if (this.cleanupInterval) clearInterval(this.cleanupInterval);
            this.cleanupInterval = setInterval(() => {
                this.cleanupInactiveSubscriptions().catch(err =>
                    console.error('❌ Cleanup error:', err)
                );
            }, 5 * 60 * 1000);

        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error during initial subscription:', error);
        }
    }

    // ✅ KEEP: Legacy topic support for existing devices
    async subscribeLegacyTopics(client) {
        const legacyTopics = [
            'ESP', 'ESP2', 'bowl', 'bowlT', 'sonar', 'sonarT',
            'CO2', 'CO2T', 'sugar', 'sugarT', 'ESP3', 'ESPX', 'ESPX2', 'ESPX3'
        ];

        for (const topic of legacyTopics) {
            if (!this.subscribedTopics.has(topic)) {
                try {
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                        client.subscribe(topic, { qos: 1 }, (err) => {
                            clearTimeout(timeout);
                            if (!err) {
                                this.subscribedTopics.add(topic);
                                console.log(`📡 [EnhancedMqttHandler] Subscribed to legacy topic: ${topic}`);
                                resolve();
                            } else {
                                reject(err);
                            }
                        });
                    });
                } catch (error) {
                    console.error(`❌ Failed to subscribe to legacy topic ${topic}:`, error.message);
                }
            }
        }
    }

    async subscribeToAllActiveSensors(client) {
        try {
            const [sensors] = await pool.execute(
                `SELECT DISTINCT s.mqtt_topic, st.type_code, st.type_name
                 FROM sensors s
                 INNER JOIN sensor_types st ON s.sensor_type_id = st.id
                 WHERE s.is_active = 1 AND s.mqtt_topic IS NOT NULL AND s.mqtt_topic != ''`
            );

            console.log(`📡 [EnhancedMqttHandler] Found ${sensors.length} active sensor topics`);

            for (const sensor of sensors) {
                if (!this.subscribedTopics.has(sensor.mqtt_topic)) {
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                            client.subscribe(sensor.mqtt_topic, { qos: 1 }, (err) => {
                                clearTimeout(timeout);
                                if (!err) {
                                    this.subscribedTopics.add(sensor.mqtt_topic);
                                    console.log(`✅ Subscribed to sensor: ${sensor.mqtt_topic} (${sensor.type_name})`);
                                    resolve();
                                } else {
                                    reject(err);
                                }
                            });
                        });
                    } catch (subscribeError) {
                        console.error(`❌ Subscribe error for ${sensor.mqtt_topic}:`, subscribeError.message);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Database error subscribing to sensors:', error.message);
        }
    }

    async subscribeToAllActiveActuators(client) {
        try {
            const [actuators] = await pool.execute(
                `SELECT DISTINCT a.mqtt_topic, at.type_code, at.type_name
                 FROM actuators a
                 INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                 WHERE a.is_active = 1 AND a.mqtt_topic IS NOT NULL AND a.mqtt_topic != ''`
            );

            console.log(`📡 [EnhancedMqttHandler] Found ${actuators.length} active actuator topics`);

            for (const actuator of actuators) {
                if (!this.subscribedTopics.has(actuator.mqtt_topic)) {
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                            client.subscribe(actuator.mqtt_topic, { qos: 1 }, (err) => {
                                clearTimeout(timeout);
                                if (!err) {
                                    this.subscribedTopics.add(actuator.mqtt_topic);
                                    console.log(`✅ Subscribed to actuator: ${actuator.mqtt_topic} (${actuator.type_name})`);
                                    resolve();
                                } else {
                                    reject(err);
                                }
                            });
                        });
                    } catch (subscribeError) {
                        console.error(`❌ Subscribe error for ${actuator.mqtt_topic}:`, subscribeError.message);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Database error subscribing to actuators:', error.message);
        }
    }

    async cleanupInactiveSubscriptions() {
        try {
            const [activeTopics] = await pool.execute(
                `SELECT DISTINCT mqtt_topic FROM sensors WHERE is_active = 1 AND mqtt_topic IS NOT NULL
                 UNION
                 SELECT DISTINCT mqtt_topic FROM actuators WHERE is_active = 1 AND mqtt_topic IS NOT NULL`
            );

            const legacyTopics = new Set([
                'ESP', 'ESP2', 'bowl', 'bowlT', 'sonar', 'sonarT',
                'CO2', 'CO2T', 'sugar', 'sugarT', 'ESP3', 'ESPX', 'ESPX2', 'ESPX3'
            ]);

            const activeSet = new Set(activeTopics.map(t => t.mqtt_topic));

            for (const topic of this.subscribedTopics) {
                // Don't cleanup legacy topics
                if (!legacyTopics.has(topic) && !activeSet.has(topic)) {
                    console.log(`🧹 Cleaning up inactive topic: ${topic}`);
                    await this.unsubscribeFromTopic(topic);
                }
            }
        } catch (error) {
            console.error('❌ Error cleaning up subscriptions:', error.message);
        }
    }

    async subscribeToDynamicTopic(topic) {
        if (!this.mqttClient || !this.mqttClient.connected) {
            console.error('❌ MQTT client not connected');
            return false;
        }

        if (!topic || topic.trim() === '') {
            console.error('❌ Invalid topic');
            return false;
        }

        if (this.subscribedTopics.has(topic)) {
            console.log(`⚠️ Already subscribed to topic: ${topic}`);
            return true;
        }

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                this.mqttClient.subscribe(topic, { qos: 1 }, (err) => {
                    clearTimeout(timeout);
                    if (!err) {
                        this.subscribedTopics.add(topic);
                        console.log(`✅ Dynamically subscribed to: ${topic}`);
                        resolve(true);
                    } else {
                        reject(err);
                    }
                });
            });
            return true;
        } catch (error) {
            console.error(`❌ Failed to subscribe to ${topic}:`, error.message);
            return false;
        }
    }

    async unsubscribeFromTopic(topic) {
        if (!this.mqttClient || !this.mqttClient.connected) {
            return false;
        }

        if (!this.subscribedTopics.has(topic)) {
            return true;
        }

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Unsubscribe timeout')), 5000);

                this.mqttClient.unsubscribe(topic, (err) => {
                    clearTimeout(timeout);
                    if (!err) {
                        this.subscribedTopics.delete(topic);
                        console.log(`✅ Unsubscribed from: ${topic}`);
                        resolve(true);
                    } else {
                        reject(err);
                    }
                });
            });
            return true;
        } catch (error) {
            console.error(`❌ Failed to unsubscribe from ${topic}:`, error.message);
            return false;
        }
    }

    async onMessage(topic, message) {
        if (message.length > 10000) {
            console.warn(`⚠️ Payload too large for ${topic}: ${message.length} bytes`);
            return;
        }

        const payload = message.toString('utf8');
        console.log(`📥 [EnhancedMqttHandler] MQTT Message - Topic: ${topic}, Payload: ${payload}`);

        try {
            // ✅ KEEP: Check legacy topics first for backward compatibility
            if (this.isLegacyTopic(topic)) {
                await this.handleLegacyTopic(topic, payload);
            } else {
                // ✅ NEW: Handle dynamic database topics
                await this.handleDynamicMessage(topic, payload);
            }
        } catch (error) {
            console.error(`❌ Error processing ${topic}:`, error.message);
        }
    }

    // ✅ KEEP: Legacy topic checker
    isLegacyTopic(topic) {
        const legacyTopics = [
            'ESP', 'ESP2', 'bowl', 'bowlT', 'sonar', 'sonarT',
            'CO2', 'CO2T', 'sugar', 'sugarT', 'ESP3', 'ESPX', 'ESPX2', 'ESPX3'
        ];
        return legacyTopics.includes(topic);
    }

    // ✅ KEEP: Legacy topic handler (maps to dynamic system)
    async handleLegacyTopic(topic, payload) {
        console.log(`📜 [Legacy] Handling legacy topic: ${topic}`);

        // Map legacy topics to sensor types
        const legacyMapping = {
            'ESP2': 'temperature',
            'ESP': 'humidity',
            'bowl': 'bowl_temp',
            'bowlT': 'bowl_fan_status',
            'sonar': 'sonar_distance',
            'sonarT': 'sonar_pump_status',
            'CO2': 'co2_level',
            'CO2T': 'co2_fermentation_status',
            'sugar': 'sugar_level',
            'sugarT': 'sugar_fermentation_status',
            'ESP3': 'airflow',
            'ESPX': 'temperature',
            'ESPX2': 'temperature',
            'ESPX3': 'temperature'
        };

        const sensorType = legacyMapping[topic];
        if (!sensorType) {
            console.warn(`⚠️ Unknown legacy topic: ${topic}`);
            return;
        }

        // Find sensor with this legacy topic or type
        const [sensors] = await pool.execute(
            `SELECT s.*, st.type_code, st.type_name, st.unit, r.room_code, r.room_name, r.id as room_id
             FROM sensors s
             INNER JOIN sensor_types st ON s.sensor_type_id = st.id
             LEFT JOIN rooms r ON s.room_id = r.id
             WHERE (s.mqtt_topic = ? OR st.type_code = ?) AND s.is_active = 1
             LIMIT 1`,
            [topic, sensorType]
        );

        if (sensors.length > 0) {
            await this.handleSensorMessage(sensors[0], payload);
        } else {
            console.warn(`⚠️ No sensor found for legacy topic: ${topic}`);
        }
    }

    async handleDynamicMessage(topic, payload) {
        try {
            if (!topic || topic.length > 100 || /[^\w\/\-_]/.test(topic)) {
                console.warn(`⚠️ Invalid topic format: ${topic}`);
                return;
            }

            const [sensors] = await pool.execute(
                `SELECT s.*, st.type_code, st.type_name, st.unit, 
            r.room_code, r.room_name, r.id as room_id
     FROM sensors s
     INNER JOIN sensor_types st ON s.sensor_type_id = st.id
     LEFT JOIN rooms r ON s.room_id = r.id
     WHERE s.mqtt_topic = ? AND s.is_active = 1
     LIMIT 1`,
                [topic]
            );

            if (sensors.length > 0) {
                await this.handleSensorMessage(sensors[0], payload);
                return;
            }

            const [actuators] = await pool.execute(
                `SELECT a.*, at.type_code, at.type_name, r.room_code, r.room_name, r.id as room_id
                 FROM actuators a
                 INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                 LEFT JOIN rooms r ON a.room_id = r.id
                 WHERE a.mqtt_topic = ? AND a.is_active = 1
                 LIMIT 1`,
                [topic]
            );

            if (actuators.length > 0) {
                await this.handleActuatorMessage(actuators[0], payload);
                return;
            }

            console.warn(`⚠️ No active sensor/actuator found for topic: ${topic}`);
        } catch (error) {
            console.error(`❌ Error handling dynamic message:`, error.message);
        }
    }

    async handleSensorMessage(sensor, payload) {
        const release = await this.sensorDataMutex.acquire();

        try {
            console.log(`📊 Processing sensor: ${sensor.sensor_name} (${sensor.type_code})`);

            if (!sensor.id || !sensor.user_id) {
                console.error('❌ Invalid sensor data');
                return;
            }

            let value;

            if (sensor.type_code.includes('status') || sensor.unit === 'status') {
                value = payload.toUpperCase() === 'ON' ? 1 : 0;
            } else {
                value = parseFloat(payload);
                if (!Number.isFinite(value) || Math.abs(value) > 1e10) {
                    console.warn(`⚠️ Invalid value: ${payload}`);
                    return;
                }
            }

            // Update sensorData cache
            if (this.sensorData.hasOwnProperty(sensor.type_code)) {
                this.sensorData[sensor.type_code] = value;
            }

            await pool.execute(
                `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator)
             VALUES (?, ?, NOW(3), 100)`,
                [sensor.id, value]
            );

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensor.id]
            );

            console.log(`✅ Saved: ${value} for ${sensor.sensor_name}`);

            const timestamp = new Date().toISOString();

            // ✅ FIX: Get room identifier from database query
            const roomCode = sensor.room_code || sensor.room_name || 'unknown';

            console.log(`📡 Emitting sensorUpdate to user_${sensor.user_id}_${roomCode}:`, {
                sensorType: sensor.type_code,
                value: value,
                roomCode: roomCode,
                roomName: sensor.room_name
            });

            // ✅ CRITICAL FIX: Add roomCode, roomName, and location fields
            this.io.to(`user_${sensor.user_id}_${roomCode}`).emit('sensorUpdate', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                sensorName: sensor.sensor_name,
                roomCode: roomCode,           // ✅ ADD THIS
                roomName: sensor.room_name,   // ✅ ADD THIS
                location: roomCode,           // ✅ ADD THIS (for backward compatibility)
                roomId: sensor.room_id,
                value: value,
                unit: sensor.unit || '',
                timestamp: timestamp,
                topic: sensor.mqtt_topic
            });

            this.io.to(`location_${roomCode}`).emit('chartData', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                value: value,
                timestamp: timestamp
            });

        } catch (error) {
            console.error(`❌ Error handling sensor:`, error.message);
        } finally {
            release();
        }
    }


    async handleActuatorMessage(actuator, payload) {
        try {
            console.log(`🎛️ Processing actuator: ${actuator.actuator_name} (${actuator.type_code})`);

            if (!actuator.id || !actuator.user_id) {
                console.error('❌ Invalid actuator data');
                return;
            }

            const state = payload.toUpperCase();
            const numericState = state === 'ON' ? 1 : 0;

            await pool.execute(
                `INSERT INTO actuator_control_logs (actuator_id, command_issued, executed_at, execution_status)
                 VALUES (?, ?, NOW(3), 'success')`,
                [actuator.id, state]
            );

            console.log(`✅ Logged actuator: ${state} for ${actuator.actuator_name}`);

            const timestamp = new Date().toISOString();
            const roomCode = actuator.room_code || 'unknown';

            this.io.to(`user_${actuator.user_id}_${roomCode}`).emit('actuatorUpdate', {
                actuatorId: actuator.id,
                actuatorType: actuator.type_code,
                actuatorName: actuator.actuator_name,
                roomCode: roomCode,
                roomName: actuator.room_name || 'Unknown Room',
                state: state,
                numericState: numericState,
                timestamp: timestamp,
                topic: actuator.mqtt_topic
            });

        } catch (error) {
            console.error(`❌ Error handling actuator:`, error.message);
        }
    }

    onError(error) {
        console.error('🚨 [EnhancedMqttHandler] MQTT Error:', error.message);
    }

    getUserLocationMutex(userId, location) {
        const key = `${userId}_${location}`;
        if (!this.locationMutexes.has(key)) {
            this.locationMutexes.set(key, new Mutex());
        }
        return this.locationMutexes.get(key);
    }

    async logUserAction(userId, actionType, actionDescription, oldValue = null, newValue = null, roomId = null, ipAddress = 'Unknown', userAgent = 'Unknown') {
        try {
            const [result] = await pool.execute(
                `INSERT INTO user_audit_log
                 (user_id, room_id, action_type, action_description, old_value, new_value, ip_address, user_agent, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [userId, roomId, actionType, actionDescription, oldValue, newValue, ipAddress, userAgent]
            );

            const auditEntry = {
                id: result.insertId,
                userId,
                actionType,
                actionDescription,
                oldValue,
                newValue,
                roomId,
                created_at: new Date().toISOString()
            };

            this.io.to('admin_dashboard').emit('userActionAudit', auditEntry);
            return auditEntry;
        } catch (error) {
            console.error('❌ Error logging user action:', error.message);
            return null;
        }
    }

    registerUser(userId, location = 'sensor-room') {
        if (!this.activeUsers.has(userId)) {
            this.activeUsers.set(userId, new Set());
        }
        this.activeUsers.get(userId).add(location);
        console.log(`✅ Registered user ${userId} for ${location}`);
        console.log(`📊 Total active users: ${this.activeUsers.size}`);
    }

    unregisterUser(userId) {
        this.activeUsers.delete(userId);
        console.log(`❌ Unregistered user ${userId}`);
    }

    // ✅ KEEP: All original publish methods
    publishToESP(topic, message) {
        return this.publishToTopic(topic, message);
    }

    publishToActuator(userId, location, message) {
        const topic = `home/${userId}/${location}/actuator`;
        return this.publishToTopic(topic, message.toString());
    }

    publishESPCommand(espDevice, command, value = '') {
        const message = value ? `${command}:${value}` : command;
        console.log(`🎛️ Sending command to ${espDevice}: ${message}`);
        return this.publishToTopic(espDevice, message);
    }

    publishSimple(topic, message) {
        return this.publishToTopic(topic, message);
    }

    publishToTopic(topic, message) {
        if (!this.mqttClient || !this.mqttClient.connected) {
            console.error('❌ MQTT client not connected');
            return false;
        }

        try {
            const payload = typeof message === 'number' ? message.toString() : message;
            this.mqttClient.publish(topic, payload, { qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`❌ Failed to publish to ${topic}:`, err);
                } else {
                    console.log(`📤 Published to ${topic}: ${payload}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ Error publishing:', error.message);
            return false;
        }
    }

    disconnect() {
        console.log(`🔵 Disconnecting...`);

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        this.mqttConnection.disconnect();
    }
}

module.exports = EnhancedMqttHandler;