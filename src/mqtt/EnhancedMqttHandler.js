// src/mqtt/EnhancedMqttHandler.js - FIXED VERSION
const { Mutex } = require("async-mutex");
const MqttConnection = require('./connection/MqttConnection');
const pool = require('../config/db');

// Import actuator handlers
const BowlFanHandler = require('./Actuators/BowlFanHandler');
const SonarPumpHandler = require('./Actuators/SonarPumpHandler');
const CO2FermentationHandler = require('./Actuators/CO2FermentationHandler');
const SugarFermentationHandler = require('./Actuators/SugarFermentationHandler');

class EnhancedMqttHandler {
    constructor(io) {
        console.log(`🔵 [EnhancedMqttHandler] Initializing FULLY DYNAMIC MQTT Handler...`);
        this.io = io;
        this.mqttConnection = new MqttConnection();
        this.mqttClient = null;
        this.activeUsers = new Map();
        this.subscribedTopics = new Set();

        // Sensor data cache
        this.sensorData = {
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

        // ✅ CRITICAL FIX: Initialize actuator handlers
        this.initializeActuatorHandlers();

        console.log(`✅ [EnhancedMqttHandler] Initialized with dynamic handler`);
    }

    // ✅ NEW: Initialize actuator handlers
    initializeActuatorHandlers() {
        console.log(`🔵 [EnhancedMqttHandler] Initializing actuator handlers...`);

        this.bowlFanHandler = new BowlFanHandler(
            this.io,
            this.sensorData,
            this.activeUsers,
            this.sensorDataMutex
        );

        this.sonarPumpHandler = new SonarPumpHandler(
            this.io,
            this.sensorData,
            this.activeUsers,
            this.sensorDataMutex
        );

        this.co2FermentationHandler = new CO2FermentationHandler(
            this.io,
            this.sensorData,
            this.activeUsers,
            this.sensorDataMutex
        );

        this.sugarFermentationHandler = new SugarFermentationHandler(
            this.io,
            this.sensorData,
            this.activeUsers,
            this.sensorDataMutex
        );

        console.log(`✅ [EnhancedMqttHandler] Actuator handlers initialized`);
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
            // Subscribe to legacy topics
            await this.subscribeLegacyTopics(client);

            // Subscribe to dynamic database topics
            await this.subscribeToAllActiveSensors(client);
            await this.subscribeToAllActiveActuators(client);

        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error during initial subscription:', error);
        }
    }

    async subscribeLegacyTopics(client) {
        const legacySensorTopics = [
            'ESP', 'ESP2', 'bowl', 'sonar',
            'CO2', 'sugar', 'ESP3', 'ESPX', 'ESPX2', 'ESPX3'
        ];

        // ✅ CRITICAL FIX: Actuator topics
        const legacyActuatorTopics = [
            'bowlT',    // bowl_fan_status
            'sonarT',   // sonar_pump_status
            'CO2T',     // co2_fermentation_status
            'sugarT'    // sugar_fermentation_status
        ];

        for (const topic of legacySensorTopics) {
            if (!this.subscribedTopics.has(topic)) {
                try {
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                        client.subscribe(topic, { qos: 1 }, (err) => {
                            clearTimeout(timeout);
                            if (!err) {
                                this.subscribedTopics.add(topic);
                                console.log(`📡 [EnhancedMqttHandler] Subscribed to legacy sensor: ${topic}`);
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

        // ✅ CRITICAL FIX: Subscribe to actuator topics
        for (const topic of legacyActuatorTopics) {
            if (!this.subscribedTopics.has(topic)) {
                try {
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                        client.subscribe(topic, { qos: 1 }, (err) => {
                            clearTimeout(timeout);
                            if (!err) {
                                this.subscribedTopics.add(topic);
                                console.log(`📡 [EnhancedMqttHandler] Subscribed to legacy actuator: ${topic}`);
                                resolve();
                            } else {
                                reject(err);
                            }
                        });
                    });
                } catch (error) {
                    console.error(`❌ Failed to subscribe to legacy actuator ${topic}:`, error.message);
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

    async onMessage(topic, message) {
        if (message.length > 10000) {
            console.warn(`⚠️ Payload too large for ${topic}: ${message.length} bytes`);
            return;
        }

        const payload = message.toString('utf8');
        console.log(`📥 [EnhancedMqttHandler] MQTT Message - Topic: ${topic}, Payload: ${payload}`);

        try {
            // ✅ CRITICAL FIX: Check if it's an actuator topic FIRST
            if (this.isActuatorTopic(topic)) {
                await this.handleActuatorTopic(topic, payload);
                return;
            }

            // Then check legacy sensor topics
            if (this.isLegacyTopic(topic)) {
                await this.handleLegacyTopic(topic, payload);
                return;
            }

            // Finally check dynamic database topics
            await this.handleDynamicMessage(topic, payload);

        } catch (error) {
            console.error(`❌ Error processing ${topic}:`, error.message);
        }
    }

    // ✅ CRITICAL FIX: New method to identify actuator topics
    isActuatorTopic(topic) {
        const actuatorTopics = ['bowlT', 'sonarT', 'CO2T', 'sugarT'];
        return actuatorTopics.includes(topic);
    }

    // ✅ CRITICAL FIX: New method to handle actuator topics
    async handleActuatorTopic(topic, payload) {
        console.log(`🎛️ [EnhancedMqttHandler] Handling actuator topic: ${topic}`);

        try {
            switch (topic) {
                case 'bowlT':
                    await this.bowlFanHandler.handleBowlFanData(topic, payload);
                    break;
                case 'sonarT':
                    await this.sonarPumpHandler.handleSonarPumpData(topic, payload);
                    break;
                case 'CO2T':
                    await this.co2FermentationHandler.handleCO2FermentationData(topic, payload);
                    break;
                case 'sugarT':
                    await this.sugarFermentationHandler.handleSugarFermentationData(topic, payload);
                    break;
                default:
                    console.warn(`⚠️ Unknown actuator topic: ${topic}`);
            }
        } catch (error) {
            console.error(`❌ Error handling actuator topic ${topic}:`, error.message);
        }
    }

    isLegacyTopic(topic) {
        const legacyTopics = [
            'ESP', 'ESP2', 'bowl', 'sonar',
            'CO2', 'sugar', 'ESP3', 'ESPX', 'ESPX2', 'ESPX3'
        ];
        return legacyTopics.includes(topic);
    }

    async handleLegacyTopic(topic, payload) {
        console.log(`📜 [Legacy] Handling legacy topic: ${topic}`);

        const legacyMapping = {
            'ESP2': 'temperature',
            'ESP': 'humidity',
            'bowl': 'bowl_temp',
            'sonar': 'sonar_distance',
            'CO2': 'co2_level',
            'sugar': 'sugar_level',
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
            // Check sensors first
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

            // Check actuators
            const [actuators] = await pool.execute(
                `SELECT a.*, at.type_code, at.type_name, 
                    r.room_code, r.room_name, r.id as room_id
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

            console.warn(`⚠️ No sensor or actuator found for topic: ${topic}`);
        } catch (error) {
            console.error(`❌ Error handling message:`, error.message);
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
            const roomCode = sensor.room_code || sensor.room_name || 'unknown';

            this.io.to(`user_${sensor.user_id}_${roomCode}`).emit('sensorUpdate', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                sensorName: sensor.sensor_name,
                roomCode: roomCode,
                roomName: sensor.room_name,
                location: roomCode,
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

            const state = payload.toUpperCase();
            const numericState = state === 'ON' ? 1 : 0;

            // ✅ CRITICAL FIX: Update actuators table
            await pool.execute(
                'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                [state, actuator.id]
            );

            // ✅ CRITICAL FIX: Log to actuator_control_logs
            await pool.execute(
                `INSERT INTO actuator_control_logs 
                 (actuator_id, command_value, command_source, executed_at)
                 VALUES (?, ?, 'mqtt', NOW())`,
                [actuator.id, numericState]
            );

            // ✅ CRITICAL FIX: Update actuator_states
            await pool.execute(
                `INSERT INTO actuator_states 
                 (user_id, room_id, actuator_type, status, message, state, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status),
                 message = VALUES(message),
                 state = VALUES(state),
                 timestamp = VALUES(timestamp)`,
                [
                    actuator.user_id,
                    actuator.room_id,
                    actuator.type_code,
                    state,
                    this.getActuatorMessage(actuator.type_code, state),
                    numericState
                ]
            );

            console.log(`✅ Logged actuator: ${state} for ${actuator.actuator_name}`);

            // Emit to frontend
            const roomCode = actuator.room_code || 'unknown';
            const timestamp = new Date().toISOString();

            this.io.to(`user_${actuator.user_id}_${roomCode}`).emit('actuatorUpdate', {
                actuatorId: actuator.id,
                actuatorType: actuator.type_code,
                actuatorName: actuator.actuator_name,
                roomCode: roomCode,
                roomName: actuator.room_name,
                state: state,
                numericState: numericState,
                timestamp: timestamp,
                topic: actuator.mqtt_topic
            });

        } catch (error) {
            console.error(`❌ Error handling actuator:`, error.message);
        }
    }

    getActuatorMessage(typeCode, state) {
        const messages = {
            'bowl_fan_status': {
                'ON': '🌡️ Temp High, Fan is ON',
                'OFF': '✅ Temp normal, Fan off'
            },
            'sonar_pump_status': {
                'ON': '💧 Water level low, Pump is ON',
                'OFF': '✅ Water level normal, Pump is Off'
            },
            'co2_fermentation_status': {
                'ACTIVE': '🫧 Fermentation going',
                'OFF': '⚠️ Fermentation is Off'
            },
            'sugar_fermentation_status': {
                'COMPLETE': '✅ Fermentation complete',
                'CLOSED': '❌ Fermentation closed'
            }
        };

        return messages[typeCode]?.[state] || `Status: ${state}`;
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
    }

    unregisterUser(userId) {
        this.activeUsers.delete(userId);
        console.log(`❌ Unregistered user ${userId}`);
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