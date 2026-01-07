const { Mutex } = require("async-mutex");
const MqttConnection = require('./connection/MqttConnection');
const pool = require('../config/db');

// Import actuator handlers
const BowlFanHandler = require('./Actuators/BowlFanHandler');
const SonarPumpHandler = require('./Actuators/SonarPumpHandler');
const CO2FermentationHandler = require('./Actuators/CO2FermentationHandler');
const SugarFermentationHandler = require('./Actuators/SugarFermentationHandler');
const CameraMonitoringHandler = require('./Actuators/CameraMonitoringHandler');

// ⚡ Import Real-Time Sensor Service (NO LATENCY for ALL sensors)
const RealTimeSensorService = require('./Sensors/RealTimeSensorService');

class EnhancedMqttHandler {
    constructor(io) {
        console.log(`🔵 [EnhancedMqttHandler] Initializing REAL-TIME MQTT Handler (NO LATENCY)...`);
        this.io = io;
        this.mqttConnection = new MqttConnection();
        this.mqttClient = null;
        this.activeUsers = new Map();
        this.subscribedTopics = new Set();
        this.resultsHandler = null;

        // ⚡ REAL-TIME: Use RealTimeSensorService for ALL sensors (same as CO2 approach)
        this.realTimeSensorService = new RealTimeSensorService(io);

        // ⚡ OPTIMIZATION: In-memory cache for actuator configs only
        this.actuatorCache = new Map();    // topic -> actuator config
        this.cacheExpiry = 5 * 60 * 1000;  // Refresh cache every 5 minutes
        this.lastCacheRefresh = 0;

        // Sensor data cache (for real-time display)
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
            esp3_data: null,
            airflow: null
        };

        this.sensorDataMutex = new Mutex();
        this.locationMutexes = new Map();
        this.cleanupInterval = null;

        // Initialize handlers
        this.initializeSensorHandlers();
        this.initializeActuatorHandlers();

        // Start cache refresh interval
        this.startCacheRefresh();

        console.log(`✅ [EnhancedMqttHandler] Initialized with REAL-TIME mode (NO LATENCY for ALL sensors)`);
    }

    // ⚡ REAL-TIME: Load configs into memory
    async loadConfigCache() {
        try {
            // Load sensors via RealTimeSensorService
            await this.realTimeSensorService.loadSensorCache();

            // Load actuators
            const [actuators] = await pool.execute(
                `SELECT a.*, at.type_code, at.type_name, at.control_type,
                 r.room_code, r.room_name, r.id as room_id
                 FROM actuators a
                 INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                 LEFT JOIN rooms r ON a.room_id = r.id
                 WHERE a.is_active = 1 AND a.mqtt_topic IS NOT NULL`
            );

            this.actuatorCache.clear();
            for (const actuator of actuators) {
                this.actuatorCache.set(actuator.mqtt_topic, actuator);
            }

            this.lastCacheRefresh = Date.now();
            console.log(`🔄 [CACHE] Loaded ${this.realTimeSensorService.sensorCache.size} sensors, ${this.actuatorCache.size} actuators (REAL-TIME mode)`);
        } catch (error) {
            console.error('❌ [CACHE] Failed to load config:', error.message);
        }
    }

    startCacheRefresh() {
        // Refresh cache periodically
        setInterval(() => this.loadConfigCache(), this.cacheExpiry);
    }

    initializeSensorHandlers() {
        console.log(`🔵 [EnhancedMqttHandler] Initializing sensor handlers...`);

        // All sensors use generic handler - no specialized handlers needed
        // You can add specialized handlers here in the future if needed
        // this.temperatureHandler = new TemperatureHandler(...);
        // this.humidityHandler = new HumidityHandler(...);

        console.log(`✅ [EnhancedMqttHandler] Sensor handlers initialized (using generic handler)`);
    }

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

        this.cameraMonitoringHandler = new CameraMonitoringHandler(
            this.io,
            this.sensorData,
            this.activeUsers,
            this.sensorDataMutex
        );

        const ResultsHandler = require('./Actuators/ResultsHandler');
        this.resultsHandler = new ResultsHandler(
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

            // Handle MQTT publish from frontend
            socket.on('publishTextToMQTT', (data) => {
                console.log(`📤 Publishing MQTT: ${data.topic} = ${data.message}`);
                if (!this.mqttClient || !this.mqttClient.connected) {
                    console.error('❌ MQTT client not connected!');
                    socket.emit('publishError', { message: 'MQTT client not connected' });
                    return;
                }

                this.publishToTopic(data.topic, data.message);
            });

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
            // ⚡ OPTIMIZATION: Load config cache FIRST
            await this.loadConfigCache();

            // Subscribe based on cached config
            await this.subscribeToAllActiveSensors(client);
            await this.subscribeToAllActiveActuators(client);

            console.log(`✅ [EnhancedMqttHandler] All subscriptions complete - ready to receive data`);
        } catch (error) {
            console.error('❌ [EnhancedMqttHandler] Error during initial subscription:', error);
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
                `SELECT DISTINCT a.mqtt_topic, at.type_code, at.type_name, at.control_type
         FROM actuators a
         INNER JOIN actuator_types at ON a.actuator_type_id = at.id
         WHERE a.is_active = 1 AND a.mqtt_topic IS NOT NULL AND a.mqtt_topic != ''`
            );

            console.log(`📡 [EnhancedMqttHandler] Found ${actuators.length} active actuator topics`);

            // Log all actuators found
            actuators.forEach(act => {
                console.log(`  📋 Found actuator topic: ${act.mqtt_topic} (${act.type_name}, control_type: ${act.control_type})`);
            });

            for (const actuator of actuators) {
                if (!this.subscribedTopics.has(actuator.mqtt_topic)) {
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000);

                            client.subscribe(actuator.mqtt_topic, { qos: 1 }, (err) => {
                                clearTimeout(timeout);

                                if (!err) {
                                    this.subscribedTopics.add(actuator.mqtt_topic);
                                    console.log(`✅ Subscribed to actuator: ${actuator.mqtt_topic} (${actuator.type_name}, control_type: ${actuator.control_type})`);
                                    resolve();
                                } else {
                                    reject(err);
                                }
                            });
                        });
                    } catch (subscribeError) {
                        console.error(`❌ Subscribe error for ${actuator.mqtt_topic}:`, subscribeError.message);
                    }
                } else {
                    console.log(`⚠️ Already subscribed to: ${actuator.mqtt_topic}`);
                }
            }

            console.log(`📡 [EnhancedMqttHandler] Total subscribed topics: ${this.subscribedTopics.size}`);
            console.log(`📡 [EnhancedMqttHandler] Subscribed topics:`, Array.from(this.subscribedTopics));
        } catch (error) {
            console.error('❌ Database error subscribing to actuators:', error.message);
        }
    }

    async onMessage(topic, message) {
        const payload = message.toString('utf8');

        if (message.length > 10000) {
            console.warn(`⚠️ Message too large: ${message.length} bytes`);
            return;
        }

        try {
            await this.handleDynamicMessage(topic, payload);
        } catch (error) {
            console.error(`❌ onMessage error for "${topic}":`, error.message);
        }
    }


    async handleDynamicMessage(topic, payload) {
        try {
            // ⚡ REAL-TIME: Try sensor handling first via RealTimeSensorService
            const sensorHandled = await this.realTimeSensorService.handleSensorData(topic, payload);
            if (sensorHandled) {
                // Update local sensorData cache for compatibility
                const sensor = await this.realTimeSensorService.getSensorConfig(topic);
                if (sensor && this.sensorData.hasOwnProperty(sensor.type_code)) {
                    const value = parseFloat(payload);
                    if (Number.isFinite(value)) {
                        this.sensorData[sensor.type_code] = value;
                    }
                }
                return;
            }

            // Check actuator cache
            const actuator = this.actuatorCache.get(topic);
            if (actuator) {
                await this.handleActuatorMessage(actuator, payload);
                return;
            }

            // Cache miss for actuator - try DB lookup and update cache
            const [actuators] = await pool.execute(
                `SELECT a.*, at.type_code, at.type_name, at.control_type,
                 r.room_code, r.room_name, r.id as room_id
                 FROM actuators a
                 INNER JOIN actuator_types at ON a.actuator_type_id = at.id
                 LEFT JOIN rooms r ON a.room_id = r.id
                 WHERE a.mqtt_topic = ? AND a.is_active = 1
                 LIMIT 1`,
                [topic]
            );

            if (actuators.length > 0) {
                this.actuatorCache.set(topic, actuators[0]); // Update cache
                await this.handleActuatorMessage(actuators[0], payload);
                return;
            }

            console.warn(`⚠️ No sensor/actuator found for topic: "${topic}"`);
        } catch (error) {
            console.error(`❌ Error handling message for topic "${topic}":`, error.message);
        }
    }

    // ⚡ REAL-TIME: Sensor handling is now done by RealTimeSensorService
    // The handleSensorMessage method has been replaced by realTimeSensorService.handleSensorData()
    // which provides immediate database writes and Socket.IO emissions (same as CO2 approach)

    async handleActuatorMessage(actuator, payload) {
        try {
            const controlType = actuator.control_type || 'binary';

            if (controlType === 'analog') {
                await this.handleAnalogActuator(actuator, payload);
            } else if (controlType === 'text') {
                await this.handleTextActuator(actuator, payload);
            } else {
                await this.handleBinaryActuator(actuator, payload);
            }
        } catch (error) {
            console.error(`❌ Error handling actuator ${actuator.actuator_name}:`, error.message);
        }
    }

    // Handle text-based actuators (AF, CF, FO, FS, PO, PS, FFC, FFO)
    async handleTextActuator(actuator, payload) {
        try {
            const state = payload.trim().toUpperCase();

            // Map text codes to readable status and messages
            const statusMap = {
                // CO2T: Active/Closed Fermentation
                'AF': { status: 'ACTIVE', message: '🫧 Active Fermentation' },
                'CF': { status: 'CLOSED', message: '⏸️ Closed Fermentation' },
                // bowlT: Fan On/Stop
                'FO': { status: 'ON', message: '🌀 Fan is ON' },
                'FS': { status: 'OFF', message: '⏹️ Fan Stopped' },
                // sonarT: Pump On/Stop
                'PO': { status: 'ON', message: '💧 Pump is ON' },
                'PS': { status: 'OFF', message: '⏹️ Pump Stopped' },
                // sugarT: Fermentation Complete/Ongoing
                'FFC': { status: 'COMPLETE', message: '✅ Fermentation Complete' },
                'FFO': { status: 'ONGOING', message: '🔄 Fermentation Ongoing' }
            };

            const mapped = statusMap[state] || { status: state, message: `Status: ${state}` };

            // Update actuator current_state
            await pool.execute(
                'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                [state, actuator.id]
            );

            // Log to actuator_control_logs
            await pool.execute(
                `INSERT INTO actuator_control_logs
                 (actuator_id, command_value, command_source, executed_at)
                 VALUES (?, ?, 'mqtt', NOW())`,
                [actuator.id, state]
            );

            // Update or insert actuator_states
            const [existingState] = await pool.execute(
                `SELECT id FROM actuator_states
                 WHERE user_id = ? AND room_id = ? AND actuator_type = ?`,
                [actuator.user_id, actuator.room_id, actuator.type_code]
            );

            if (existingState.length > 0) {
                await pool.execute(
                    `UPDATE actuator_states
                     SET status = ?, message = ?, state = ?, timestamp = NOW()
                     WHERE id = ?`,
                    [mapped.status, mapped.message, state, existingState[0].id]
                );
            } else {
                await pool.execute(
                    `INSERT INTO actuator_states
                     (user_id, room_id, actuator_type, status, message, state, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [actuator.user_id, actuator.room_id, actuator.type_code, mapped.status, mapped.message, state]
                );
            }

            // Emit to Socket.IO
            const roomCode = actuator.room_code || actuator.room_name;
            if (roomCode) {
                const userRoom = `user_${actuator.user_id}_${roomCode}`;

                this.io.to(userRoom).emit('actuatorUpdate', {
                    actuatorId: actuator.id,
                    actuatorType: actuator.type_code,
                    actuatorName: actuator.actuator_name,
                    roomCode: roomCode,
                    roomName: actuator.room_name,
                    state: mapped.status,
                    rawState: state,
                    message: mapped.message,
                    timestamp: new Date().toISOString(),
                    topic: actuator.mqtt_topic
                });

                console.log(`🎛️ ${actuator.type_code}: ${state} (${mapped.status}) → ${userRoom}`);
            }
        } catch (error) {
            console.error(`❌ Error in handleTextActuator:`, error.message);
            throw error;
        }
    }

    async handleBinaryActuator(actuator, payload) {
        try {
            const state = payload.toUpperCase();
            const numericState = state === 'ON' ? 1 : 0;

            await pool.execute(
                'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                [state.toLowerCase(), actuator.id]
            );

            await pool.execute(
                `INSERT INTO actuator_control_logs
                 (actuator_id, command_value, command_source, executed_at)
                 VALUES (?, ?, 'mqtt', NOW())`,
                [actuator.id, numericState]
            );

            const [existingState] = await pool.execute(
                `SELECT id FROM actuator_states
                 WHERE user_id = ? AND room_id = ? AND actuator_type = ?`,
                [actuator.user_id, actuator.room_id, actuator.type_code]
            );

            if (existingState.length > 0) {
                await pool.execute(
                    `UPDATE actuator_states
                     SET status = ?, message = ?, state = ?, timestamp = NOW()
                     WHERE id = ?`,
                    [state, this.getActuatorMessage(actuator.type_code, state), numericState, existingState[0].id]
                );
            } else {
                await pool.execute(
                    `INSERT INTO actuator_states
                     (user_id, room_id, actuator_type, status, message, state, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [actuator.user_id, actuator.room_id, actuator.type_code, state, this.getActuatorMessage(actuator.type_code, state), numericState]
                );
            }

            const roomCode = actuator.room_code || actuator.room_name;
            if (roomCode) {
                const userRoom = `user_${actuator.user_id}_${roomCode}`;
                this.io.to(userRoom).emit('actuatorUpdate', {
                    actuatorId: actuator.id,
                    actuatorType: actuator.type_code,
                    actuatorName: actuator.actuator_name,
                    roomCode: roomCode,
                    roomName: actuator.room_name,
                    state: state,
                    numericState: numericState,
                    timestamp: new Date().toISOString(),
                    topic: actuator.mqtt_topic
                });
                console.log(`🎛️ ${actuator.type_code}: ${state} → ${userRoom}`);
            }
        } catch (error) {
            console.error(`❌ Error in handleBinaryActuator:`, error.message);
            throw error;
        }
    }

    async handleAnalogActuator(actuator, payload) {
        try {
            const value = parseInt(payload);

            if (isNaN(value) || value < 0 || value > 100) {
                console.warn(`⚠️ Invalid analog value: ${payload} (must be 0-100)`);
                return;
            }

            let status = '';
            let statusMessage = '';

            if (value === 0) {
                status = 'OFF';
                statusMessage = `⏸️ ${actuator.actuator_name} is OFF`;
            } else if (value <= 33) {
                status = 'LOW';
                statusMessage = `🌀 ${actuator.actuator_name}: LOW (${value}%)`;
            } else if (value <= 66) {
                status = 'MEDIUM';
                statusMessage = `🌀 ${actuator.actuator_name}: MEDIUM (${value}%)`;
            } else {
                status = 'HIGH';
                statusMessage = `🌀 ${actuator.actuator_name}: HIGH (${value}%)`;
            }

            await pool.execute(
                'UPDATE actuators SET current_state = ?, updated_at = NOW() WHERE id = ?',
                [value.toString(), actuator.id]
            );

            await pool.execute(
                `INSERT INTO actuator_control_logs
                 (actuator_id, command_value, command_source, executed_at)
                 VALUES (?, ?, 'mqtt', NOW())`,
                [actuator.id, value]
            );

            const [existingState] = await pool.execute(
                `SELECT id FROM actuator_states
                 WHERE user_id = ? AND room_id = ? AND actuator_type = ?`,
                [actuator.user_id, actuator.room_id, actuator.type_code]
            );

            if (existingState.length > 0) {
                await pool.execute(
                    `UPDATE actuator_states
                     SET status = ?, message = ?, state = ?, timestamp = NOW()
                     WHERE id = ?`,
                    [status, statusMessage, value, existingState[0].id]
                );
            } else {
                await pool.execute(
                    `INSERT INTO actuator_states
                     (user_id, room_id, actuator_type, status, message, state, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [actuator.user_id, actuator.room_id, actuator.type_code, status, statusMessage, value]
                );
            }

            const roomCode = actuator.room_code || actuator.room_name;
            if (roomCode) {
                const userRoom = `user_${actuator.user_id}_${roomCode}`;
                this.io.to(userRoom).emit('actuatorUpdate', {
                    actuatorId: actuator.id,
                    actuatorType: actuator.type_code,
                    actuatorName: actuator.actuator_name,
                    roomCode: roomCode,
                    roomName: actuator.room_name,
                    state: status,
                    value: value,
                    timestamp: new Date().toISOString(),
                    topic: actuator.mqtt_topic
                });

                // Special handling for fan speed control
                if (actuator.type_code === 'fan_speed_control') {
                    this.io.to(userRoom).emit('fanSpeedUpdate', {
                        speed: value,
                        status: status,
                        level: status,
                        roomCode: roomCode,
                        roomId: actuator.room_id,
                        timestamp: new Date().toISOString()
                    });
                }

                console.log(`🎛️ ${actuator.type_code}: ${value}% (${status}) → ${userRoom}`);
            }
        } catch (error) {
            console.error(`❌ Error in handleAnalogActuator:`, error.message);
            throw error;
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
            },
            'results': {
                'COMPLETE': '✅ Fermentation Complete',
                'ONGOING': '🔄 Fermentation Ongoing',
                'OFF': '❌ Fermentation OFF'
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
