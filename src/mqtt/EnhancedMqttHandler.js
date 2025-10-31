// mqtt/EnhancedMqttHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema with dynamic MQTT topic subscription
const { Mutex } = require("async-mutex");
const MqttConnection = require('./connection/MqttConnection');
const pool = require('../config/db');

const TemperatureHandler = require('./sensors/TemperatureHandler');
const HumidityHandler = require('./sensors/HumidityHandler');
const BowlTemperatureHandler = require('./sensors/BowlTemperatureHandler');
const BowlFanHandler = require('./sensors/BowlFanHandler');
const SonarDistanceHandler = require('./sensors/SonarDistanceHandler');
const SonarPumpHandler = require('./sensors/SonarPumpHandler');
const CO2Handler = require('./sensors/CO2Handler');
const CO2FermentationHandler = require('./sensors/CO2FermentationHandler');
const SugarHandler = require('./sensors/SugarHandler');
const SugarFermentationHandler = require('./sensors/SugarFermentationHandler');
const ESP3Handler = require('./sensors/ESP3Handler');
const RealSensorHandler = require('./sensors/RealSensorHandler');

class EnhancedMqttHandler {
    constructor(io) {
        console.log(`🔵 [EnhancedMqttHandler] Initializing...`);
        this.io = io;
        this.mqttConnection = new MqttConnection();
        this.activeUsers = new Map();
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

        // Initialize ALL handlers
        const handlerArgs = [io, this.sensorData, this.activeUsers, this.sensorDataMutex];
        this.temperatureHandler = new TemperatureHandler(...handlerArgs);
        this.humidityHandler = new HumidityHandler(...handlerArgs);
        this.bowlTemperatureHandler = new BowlTemperatureHandler(...handlerArgs);
        this.bowlFanHandler = new BowlFanHandler(...handlerArgs);
        this.sonarDistanceHandler = new SonarDistanceHandler(...handlerArgs);
        this.sonarPumpHandler = new SonarPumpHandler(...handlerArgs);
        this.co2Handler = new CO2Handler(...handlerArgs);
        this.co2FermentationHandler = new CO2FermentationHandler(...handlerArgs);
        this.sugarHandler = new SugarHandler(...handlerArgs);
        this.sugarFermentationHandler = new SugarFermentationHandler(...handlerArgs);
        this.esp3Handler = new ESP3Handler(...handlerArgs);
        this.realSensorHandler = new RealSensorHandler(...handlerArgs);

        console.log(`✅ [EnhancedMqttHandler] Initialized with all handlers`);
    }

    connect() {
        console.log(`🔵 [EnhancedMqttHandler] Connecting to MQTT broker...`);
        this.mqttConnection.connect(
            (client) => this.onConnect(client),
            (topic, message) => this.onMessage(topic, message),
            (error) => this.onError(error)
        );
    }

    onConnect(client) {
        console.log(`🔵 [EnhancedMqttHandler] Connected to MQTT broker`);

        // Subscribe to legacy topics (backward compatibility)
        const legacyTopics = ['ESP', 'ESP2', 'bowl', 'bowlT', 'sonar', 'sonarT',
            'CO2', 'CO2T', 'sugar', 'sugarT', 'ESP3', 'ESPX', 'ESPX2', 'ESPX3'];

        legacyTopics.forEach(topic => {
            client.subscribe(topic, { qos: 1 }, (err) => {
                if (!err) console.log(`📡 [EnhancedMqttHandler] Subscribed to legacy topic: ${topic}`);
            });
        });

        // ✅ DYNAMIC SUBSCRIPTION: Subscribe to all possible sensor topics
        // Pattern: +/+/+ matches user_id/room_code/sensor_type
        client.subscribe('+/+/+', { qos: 1 }, (err) => {
            if (!err) console.log(`📡 [EnhancedMqttHandler] Subscribed to dynamic pattern: +/+/+`);
        });

        // Also subscribe to control topics
        client.subscribe('+/+/control/+', { qos: 1 }, (err) => {
            if (!err) console.log(`📡 [EnhancedMqttHandler] Subscribed to control pattern: +/+/control/+`);
        });
    }

    async onMessage(topic, message) {
        const payload = message.toString();
        console.log(`📥 [EnhancedMqttHandler] MQTT Message - Topic: ${topic}, Payload: ${payload}`);

        try {
            // Check if it's a dynamic topic (format: user_id/room_code/sensor_type)
            const dynamicTopicParts = topic.split('/');
            if (dynamicTopicParts.length === 3 && !isNaN(dynamicTopicParts[0])) {
                // This is a dynamic topic
                await this.handleDynamicTopic(topic, payload);
                return;
            }

            // Handle legacy topics
            switch (topic) {
                case 'ESP2':
                    await this.temperatureHandler.handleTemperatureData(topic, payload);
                    await this.realSensorHandler.handleRealSensorData(topic, payload);
                    break;

                case 'ESP':
                    await this.humidityHandler.handleHumidityData(topic, payload);
                    break;

                case 'bowl':
                    await this.bowlTemperatureHandler.handleBowlTemperatureData(topic, payload); // ✅ FIXED
                    break;

                case 'bowlT':
                    await this.bowlFanHandler.handleBowlFanData(topic, payload); // ✅ FIXED
                    break;

                case 'sonar':
                    await this.sonarDistanceHandler.handleSonarData(topic, payload); // ✅ FIXED
                    break;

                case 'sonarT':
                    await this.sonarPumpHandler.handleSonarPumpData(topic, payload); // ✅ FIXED
                    break;

                case 'CO2':
                    await this.co2Handler.handleCO2Data(topic, payload);
                    break;

                case 'CO2T':
                    await this.co2FermentationHandler.handleCO2FermentationData(topic, payload); // ✅ FIXED
                    break;

                case 'sugar':
                    await this.sugarHandler.handleSugarData(topic, payload);
                    break;

                case 'sugarT':
                    await this.sugarFermentationHandler.handleSugarFermentationData(topic, payload); // ✅ FIXED
                    break;

                case 'ESP3':
                    await this.esp3Handler.handleESP3Data(topic, payload);
                    break;

                case 'ESPX':
                case 'ESPX2':
                case 'ESPX3':
                    await this.realSensorHandler.handleRealSensorData(topic, payload);
                    break;

                default:
                    console.warn(`⚠️ [EnhancedMqttHandler] Unhandled topic: ${topic}`);
            }
        } catch (error) {
            console.error(`❌ [EnhancedMqttHandler] Error processing ${topic}:`, error.message);
        }
    }

    // ✅ NEW METHOD: Handle dynamic MQTT topics
    async handleDynamicTopic(topic, payload) {
        try {
            console.log(`🔵 [EnhancedMqttHandler] Handling dynamic topic: ${topic}`);

            // Find the sensor by mqtt_topic
            const [sensors] = await pool.execute(
                `SELECT s.*, st.type_code, st.type_name, r.room_code, r.room_name
         FROM sensors s
         INNER JOIN sensor_types st ON s.sensor_type_id = st.id
         INNER JOIN rooms r ON s.room_id = r.id
         WHERE s.mqtt_topic = ? AND s.is_active = 1`,
                [topic]
            );

            if (sensors.length === 0) {
                console.warn(`⚠️ [EnhancedMqttHandler] No active sensor found for topic: ${topic}`);
                return;
            }

            const sensor = sensors[0];
            console.log(`✅ [EnhancedMqttHandler] Found sensor: ${sensor.sensor_name} (type: ${sensor.type_code})`);

            // Validate and parse payload
            const value = parseFloat(payload);
            if (!Number.isFinite(value)) {
                console.warn(`⚠️ [EnhancedMqttHandler] Invalid numeric value: ${payload}`);
                return;
            }

            // Insert measurement
            await pool.execute(
                `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator)
         VALUES (?, ?, NOW(3), 100)`,
                [sensor.id, value]
            );

            // Update last_reading_at
            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensor.id]
            );

            console.log(`✅ [EnhancedMqttHandler] Saved measurement: ${value} for sensor ${sensor.sensor_name}`);

            // Emit Socket.IO event to user
            this.io.to(`user_${sensor.user_id}`).emit('sensorUpdate', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                sensorName: sensor.sensor_name,
                roomCode: sensor.room_code,
                roomName: sensor.room_name,
                value: value,
                timestamp: new Date(),
                topic: topic
            });

            console.log(`📡 [EnhancedMqttHandler] Emitted sensorUpdate to user_${sensor.user_id}`);

        } catch (error) {
            console.error(`❌ [EnhancedMqttHandler] Error handling dynamic topic:`, error.message);
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
            console.log(`🔵 [EnhancedMqttHandler] Logging user action: ${actionType} - ${actionDescription}`);

            const [result] = await pool.execute(`
        INSERT INTO user_audit_log
        (user_id, room_id, action_type, action_description, old_value, new_value, entity_type, entity_id, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NOW())`,
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
            console.log(`✅ [EnhancedMqttHandler] Audit logged: User ${userId} - ${actionDescription}`);
            return auditEntry;

        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error logging user action:', error.message);
            return null;
        }
    }

    registerUser(userId, location = 'sensor-room') {
        if (!this.activeUsers.has(userId)) {
            this.activeUsers.set(userId, new Set());
        }
        this.activeUsers.get(userId).add(location);
        console.log(`✅ [EnhancedMqttHandler] Registered user ${userId} for ${location}`);
        console.log(`📊 [EnhancedMqttHandler] Total active users: ${this.activeUsers.size}`);
    }

    unregisterUser(userId) {
        this.activeUsers.delete(userId);
        console.log(`❌ [EnhancedMqttHandler] Unregistered user ${userId}`);
    }

    publishToESP(topic, message) {
        if (!this.mqttConnection.mqttClient || !this.mqttConnection.mqttClient.connected) {
            console.error('❌ [EnhancedMqttHandler] MQTT client not connected');
            return false;
        }

        if (typeof message !== 'string' || message.length > 1000) {
            console.error('❌ [EnhancedMqttHandler] Invalid message format or size');
            return false;
        }

        try {
            this.mqttConnection.mqttClient.publish(topic, message, { qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`❌ [EnhancedMqttHandler] Failed to publish to ${topic}:`, err);
                } else {
                    const secureStatus = this.mqttConnection.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
                    console.log(`📤 [EnhancedMqttHandler] Published to ${topic}: ${message}${secureStatus}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error publishing message:', error.message);
            return false;
        }
    }

    publishToActuator(userId, location, message) {
        if (!this.mqttConnection.mqttClient || !this.mqttConnection.mqttClient.connected) {
            console.error('❌ [EnhancedMqttHandler] MQTT client not connected');
            return false;
        }

        try {
            const topic = `home/${userId}/${location}/actuator`;
            this.mqttConnection.mqttClient.publish(topic, message.toString(), { qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`❌ [EnhancedMqttHandler] Failed to publish to ${topic}:`, err);
                } else {
                    const secureStatus = this.mqttConnection.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
                    console.log(`📤 [EnhancedMqttHandler] Published to ${topic}: ${message}${secureStatus}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error publishing to actuator:', error.message);
            return false;
        }
    }

    publishESPCommand(espDevice, command, value = '') {
        const topic = espDevice;
        const message = value ? `${command}:${value}` : command;
        console.log(`🎛️ [EnhancedMqttHandler] Sending command to ${espDevice}: ${message}`);
        return this.publishToESP(topic, message);
    }

    publishSimple(topic, message) {
        if (!this.mqttConnection.mqttClient || !this.mqttConnection.mqttClient.connected) {
            console.error('❌ [EnhancedMqttHandler] MQTT client not connected');
            return false;
        }

        try {
            const payload = typeof message === 'number' ? message.toString() : message;
            this.mqttConnection.mqttClient.publish(topic, payload, { qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`❌ [EnhancedMqttHandler] Failed to publish to ${topic}:`, err);
                } else {
                    const secureStatus = this.mqttConnection.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
                    console.log(`📤 [EnhancedMqttHandler] Published message: "${payload}" to ${topic}${secureStatus}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error publishing message:', error.message);
            return false;
        }
    }

    disconnect() {
        console.log(`🔵 [EnhancedMqttHandler] Disconnecting from MQTT broker...`);
        this.mqttConnection.disconnect();
    }
}

module.exports = EnhancedMqttHandler;
