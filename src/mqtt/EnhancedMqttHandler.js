const { Mutex } = require("async-mutex");
const MqttConnection = require('./connection/MqttConnection');
const pool = require('../config/db');

// Import actuator handlers
const BowlFanHandler = require('./Actuators/BowlFanHandler');
const SonarPumpHandler = require('./Actuators/SonarPumpHandler');
const CO2FermentationHandler = require('./Actuators/CO2FermentationHandler');
const SugarFermentationHandler = require('./Actuators/SugarFermentationHandler');
const CameraMonitoringHandler = require('./Actuators/CameraMonitoringHandler');

// Import sensor handlers
const CO2Handler = require('./Sensors/CO2Handler.js');
const CO2PollingService = require('./Sensors/CO2PollingService.js');

class EnhancedMqttHandler {
    constructor(io) {
        console.log(`🔵 [EnhancedMqttHandler] Initializing FULLY DYNAMIC MQTT Handler...`);
        this.io = io;
        this.mqttConnection = new MqttConnection();
        this.mqttClient = null;
        this.activeUsers = new Map();
        this.subscribedTopics = new Set();
        this.resultsHandler = null;

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
        this.co2PollingService = null;

        // Initialize sensor handlers FIRST
        this.initializeSensorHandlers();

        // Then initialize actuator handlers
        this.initializeActuatorHandlers();

        console.log(`✅ [EnhancedMqttHandler] Initialized with dynamic handler`);
    }

    initializeSensorHandlers() {
        console.log(`🔵 [EnhancedMqttHandler] Initializing sensor handlers...`);

        // Initialize CO2 Handler
        this.co2Handler = new CO2Handler(
            this.io,
            this.sensorData,
            this.activeUsers,
            this.sensorDataMutex
        );

        // You can add more sensor handlers here in the future
        // this.temperatureHandler = new TemperatureHandler(...);
        // this.humidityHandler = new HumidityHandler(...);

        console.log(`✅ [EnhancedMqttHandler] Sensor handlers initialized`);
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
            // Fully dynamic: subscribe only based on DB configuration
            await this.subscribeToAllActiveSensors(client);
            await this.subscribeToAllActiveActuators(client);

            // ✅ NEW: Start CO2 polling service
            console.log(`🚀 [EnhancedMqttHandler] Starting CO2 polling service...`);
            this.co2PollingService = new CO2PollingService(this.mqttClient, this.co2Handler);
            await this.co2PollingService.start();
            console.log(`✅ [EnhancedMqttHandler] CO2 polling service started`);
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
        const messageStartTime = Date.now();

        // ✅ Log every single MQTT message clearly
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📨 [MQTT RAW] INCOMING MESSAGE`);
        console.log(`  ⏱️  Time: ${new Date().toISOString()}`);
        console.log(`  📍 Topic: "${topic}"`);
        console.log(`  📦 Payload: "${message.toString('utf8')}"`);
        console.log(`  📏 Size: ${message.length} bytes`);
        console.log(`${'='.repeat(80)}\n`);

        if (message.length > 10000) {
            console.warn(`⚠️  [EnhancedMqttHandler] Message too large: ${message.length} bytes`);
            return;
        }

        const payload = message.toString('utf8');

        try {
            // Process messages immediately to ensure no data loss
            // Critical for high-frequency sensors like CO2 that send data every second
            console.log(`🔄 [MQTT] Processing topic: "${topic}" with payload: "${payload}"`);

            // Use Promise to handle async operations without blocking MQTT client
            this.handleDynamicMessage(topic, payload)
                .then(() => {
                    const processingTime = Date.now() - messageStartTime;
                    console.log(`✅ [MQTT] Successfully processed topic: "${topic}" in ${processingTime}ms`);

                    if (processingTime > 100) {
                        console.warn(`⚠️  [PERF] Slow message processing: ${processingTime}ms for topic: ${topic}`);
                    }
                })
                .catch((error) => {
                    console.error(`❌ [Dynamic Handler Error] Topic: "${topic}":`, error.message);
                    console.error(`   Stack:`, error.stack);
                });

        } catch (error) {
            console.error(`❌ [EnhancedMqttHandler] onMessage error for topic "${topic}":`, error.message);
            console.error(`   Stack:`, error.stack);
        }
    }

    async handleDynamicMessage(topic, payload) {
        try {
            console.log(`\n🔍 [DYNAMIC ROUTING] Starting resolution for topic: "${topic}"`);

            // Check sensors first
            console.log(`  🔎 [STEP 1] Querying database for sensor with topic: "${topic}"`);
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
                const sensor = sensors[0];
                console.log(`  ✅ [STEP 1] Found sensor for topic "${topic}":`, {
                    id: sensor.id,
                    name: sensor.sensor_name,
                    type_code: sensor.type_code,
                    type_name: sensor.type_name,
                    user_id: sensor.user_id,
                    room_code: sensor.room_code
                });

                await this.handleSensorMessage(sensor, payload);
                console.log(`  ✅ [ROUTING COMPLETE] Sensor handler finished for topic: "${topic}"\n`);
                return;
            }

            console.warn(`  ⚠️  [STEP 1] No sensor found for topic: "${topic}"`);
            console.warn(`  🔎 [STEP 2] Checking actuators...`);

            // Then check actuators
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
                const actuator = actuators[0];
                console.log(`  ✅ [STEP 2] Found actuator for topic "${topic}":`, {
                    id: actuator.id,
                    name: actuator.actuator_name,
                    type_code: actuator.type_code,
                    type_name: actuator.type_name
                });

                await this.handleActuatorMessage(actuator, payload);
                console.log(`  ✅ [ROUTING COMPLETE] Actuator handler finished for topic: "${topic}"\n`);
                return;
            }

            console.error(`\n❌ [CRITICAL] No sensor or actuator found for topic: "${topic}"`);
            console.error(`   Make sure your device is registered in the database`);
            console.error(`   Topic received: "${topic}"`);
            console.error(`   Payload: "${payload}"\n`);
        } catch (error) {
            console.error(`❌ Error handling message:`, error.message);
            console.error(`   Stack:`, error.stack);
        }
    }

    async handleSensorMessage(sensor, payload) {
        console.log(`\n🔀 [SENSOR ROUTING] ===============================`);
        console.log(`  📊 Sensor Name: ${sensor.sensor_name}`);
        console.log(`  🏷️  Type Code: ${sensor.type_code}`);
        console.log(`  🏷️  Type Name: ${sensor.type_name}`);
        console.log(`  📍 Topic: ${sensor.mqtt_topic}`);
        console.log(`  📦 Payload: ${payload}`);
        console.log(`  👤 User ID: ${sensor.user_id}`);
        console.log(`  🏠 Room: ${sensor.room_code || sensor.room_name || 'N/A'}`);
        console.log(`================================================\n`);

        // Dynamic routing based on sensor type_code from database
        // Check if specialized handler exists for this sensor type
        const handlerMap = {
            'co2_level': this.co2Handler,
            // Add more mappings as you create specialized handlers
            // 'temperature': this.temperatureHandler,
            // 'humidity': this.humidityHandler,
        };

        const specializedHandler = handlerMap[sensor.type_code];

        if (specializedHandler) {
            console.log(`🔀 [ROUTING] Found specialized handler for type: "${sensor.type_code}"`);
            console.log(`  🎯 Calling handler method...`);

            try {
                // Call the specialized handler dynamically
                const handlerMethodName = `handle${sensor.type_code.split('_').map(word =>
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join('')}Data`;

                // For co2_level, this becomes: handleCo2LevelData
                // But we named it handleCO2Data, so let's use a simpler approach

                if (sensor.type_code === 'co2_level' && this.co2Handler.handleCO2Data) {
                    await this.co2Handler.handleCO2Data(sensor.mqtt_topic, payload);

                    // Notify polling service that data was received
                    if (this.co2PollingService) {
                        this.co2PollingService.onDataReceived(sensor.mqtt_topic, payload);
                    }

                    console.log(`  ✅ [ROUTING] Specialized handler completed successfully\n`);
                    return;
                }

                // Future handlers can follow the same pattern
                // if (sensor.type_code === 'temperature' && this.temperatureHandler.handleTemperatureData) {
                //   await this.temperatureHandler.handleTemperatureData(sensor.mqtt_topic, payload);
                //   return;
                // }

            } catch (error) {
                console.error(`❌ [ROUTING] Specialized handler failed:`, error.message);
                console.error(`   Stack:`, error.stack);
                console.error(`   Falling back to generic handler...\n`);
                // Fall through to generic handler as backup
            }
        } else {
            console.log(`🔀 [ROUTING] No specialized handler for type: "${sensor.type_code}"`);
            console.log(`  🔧 Using generic sensor handler...\n`);
        }

        // Generic handler for sensors without specialized handlers
        const release = await this.sensorDataMutex.acquire();
        try {
            console.log(`📊 [GENERIC HANDLER] Processing sensor: ${sensor.sensor_name} (${sensor.type_code})`);

            if (!sensor.id || !sensor.user_id) {
                console.error('  ❌ Invalid sensor data - missing id or user_id');
                return;
            }

            let value;

            // Handle different value types
            if (sensor.type_code.includes('status') || sensor.unit === 'status') {
                value = payload.toUpperCase() === 'ON' ? 1 : 0;
                console.log(`  🔄 Parsed status value: ${payload} → ${value}`);
            } else {
                value = parseFloat(payload);
                if (!Number.isFinite(value) || Math.abs(value) > 1e10) {
                    console.warn(`  ⚠️  Invalid numeric value: ${payload}`);
                    return;
                }
                console.log(`  🔄 Parsed numeric value: ${value}`);
            }

            // Update cache
            if (this.sensorData.hasOwnProperty(sensor.type_code)) {
                this.sensorData[sensor.type_code] = value;
                console.log(`  🔄 [CACHE] Updated: ${sensor.type_code} = ${value}`);
            }

            // Save to database
            console.log(`  💾 [DB] Saving measurement...`);
            const [insertResult] = await pool.execute(
                `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator)
         VALUES (?, ?, NOW(3), 100)`,
                [sensor.id, value]
            );
            console.log(`  💾 [DB] Measurement inserted with ID: ${insertResult.insertId}`);

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensor.id]
            );
            console.log(`  💾 [DB] Updated last_reading_at for sensor ${sensor.id}`);

            console.log(`  ✅ Saved: ${value} ${sensor.unit || ''} for ${sensor.sensor_name} (ID: ${sensor.id})`);

            const timestamp = new Date().toISOString();
            const roomCode = sensor.room_code || sensor.room_name || 'unknown';

            const sensorData = {
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
            };

            // Emit to Socket.IO rooms
            console.log(`  📡 [EMIT] Broadcasting to Socket.IO rooms...`);
            const userRoom = `user_${sensor.user_id}_${roomCode}`;
            const locationRoom = `location_${roomCode}`;

            this.io.to(userRoom).emit('sensorUpdate', sensorData);
            console.log(`    ✅ sensorUpdate → ${userRoom}`);

            this.io.to(locationRoom).emit('chartData', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                value: value,
                timestamp: timestamp,
                unit: sensor.unit || ''
            });
            console.log(`    ✅ chartData → ${locationRoom}`);

            this.io.to(userRoom).emit('environmentUpdate', {
                [sensor.type_code]: value,
                timestamp: timestamp
            });
            console.log(`    ✅ environmentUpdate → ${userRoom}`);

            console.log(`  ✅ [GENERIC HANDLER] Processing complete\n`);

        } catch (error) {
            console.error(`❌ Error handling sensor:`, error.message);
            console.error(`   Stack:`, error.stack);
        } finally {
            release();
        }
    }

    async handleActuatorMessage(actuator, payload) {
        try {
            console.log(`\n🎛️  [ACTUATOR HANDLER] Processing actuator: ${actuator.actuator_name} (${actuator.type_code})`);
            console.log(`  📦 Payload: ${payload}`);
            console.log(`  🔧 Control Type: ${actuator.control_type || 'binary'}`);

            const controlType = actuator.control_type || 'binary';

            if (controlType === 'analog') {
                console.log(`  🔀 Routing to analog actuator handler`);
                await this.handleAnalogActuator(actuator, payload);
            } else {
                console.log(`  🔀 Routing to binary actuator handler`);
                await this.handleBinaryActuator(actuator, payload);
            }

            console.log(`  ✅ [ACTUATOR HANDLER] Processing complete\n`);
        } catch (error) {
            console.error(`❌ Error handling actuator ${actuator.actuator_name}:`, error.message);
            console.error(`   Stack:`, error.stack);
        }
    }

    async handleBinaryActuator(actuator, payload) {
        try {
            const state = payload.toUpperCase();
            const numericState = state === 'ON' ? 1 : 0;

            console.log(`  🔄 Binary state: ${payload} → ${state} (${numericState})`);

            console.log(`  💾 [DB] Updating actuator state...`);
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
            console.log(`  💾 [DB] Control log created`);

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
                    [
                        state,
                        this.getActuatorMessage(actuator.type_code, state),
                        numericState,
                        existingState[0].id
                    ]
                );
                console.log(`  💾 [DB] Actuator state updated (ID: ${existingState[0].id})`);
            } else {
                await pool.execute(
                    `INSERT INTO actuator_states
           (user_id, room_id, actuator_type, status, message, state, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        actuator.user_id,
                        actuator.room_id,
                        actuator.type_code,
                        state,
                        this.getActuatorMessage(actuator.type_code, state),
                        numericState
                    ]
                );
                console.log(`  💾 [DB] New actuator state created`);
            }

            console.log(`  ✅ Logged binary actuator state: ${state}`);

            const roomCode = actuator.room_code || actuator.room_name;
            if (!roomCode) {
                console.warn(`  ⚠️  No room code for actuator ${actuator.actuator_name}`);
                return;
            }

            const userRoom = `user_${actuator.user_id}_${roomCode}`;
            console.log(`  📡 [EMIT] Broadcasting to: ${userRoom}`);

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
            console.log(`  ✅ actuatorUpdate emitted`);

        } catch (error) {
            console.error(`❌ Error in handleBinaryActuator:`, error.message);
            throw error;
        }
    }

    async handleAnalogActuator(actuator, payload) {
        try {
            const value = parseInt(payload);

            if (isNaN(value) || value < 0 || value > 100) {
                console.warn(`  ⚠️  Invalid analog value: ${payload} (must be 0-100)`);
                return;
            }

            console.log(`  🔄 Analog value: ${payload} → ${value}%`);

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

            console.log(`  📊 Status: ${status} - ${statusMessage}`);

            console.log(`  💾 [DB] Updating actuator state...`);
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
            console.log(`  💾 [DB] Control log created`);

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
                console.log(`  💾 [DB] Actuator state updated (ID: ${existingState[0].id})`);
            } else {
                await pool.execute(
                    `INSERT INTO actuator_states
           (user_id, room_id, actuator_type, status, message, state, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        actuator.user_id,
                        actuator.room_id,
                        actuator.type_code,
                        status,
                        statusMessage,
                        value
                    ]
                );
                console.log(`  💾 [DB] New actuator state created`);
            }

            console.log(`  ✅ Logged analog actuator: ${actuator.actuator_name} = ${value}%`);

            const roomCode = actuator.room_code || actuator.room_name;
            if (!roomCode) {
                console.warn(`  ⚠️  No room code for actuator ${actuator.actuator_name}`);
                return;
            }

            const userRoom = `user_${actuator.user_id}_${roomCode}`;
            console.log(`  📡 [EMIT] Broadcasting to: ${userRoom}`);

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
            console.log(`  ✅ actuatorUpdate emitted`);

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
                console.log(`  ✅ fanSpeedUpdate emitted`);
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

        // Stop CO2 polling service
        if (this.co2PollingService) {
            this.co2PollingService.stop();
            this.co2PollingService = null;
        }

        this.mqttConnection.disconnect();
    }

    // Get CO2 polling status
    getCO2PollingStatus() {
        if (this.co2PollingService) {
            return this.co2PollingService.getStatus();
        }
        return { isPolling: false, message: 'Polling service not initialized' };
    }
}

module.exports = EnhancedMqttHandler;
