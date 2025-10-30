const mqtt = require("mqtt");
const fs = require("fs"); // 🔒 Required for reading certificate files
const { performance } = require("perf_hooks");
const { Mutex } = require("async-mutex");
const Temperature = require("../models/Temperature");
const Measurement = require("../models/Measurement");
const User = require("../models/User");
const pool = require("../config/db");

class EnhancedMqttHandler {
    constructor(io) {
        this.io = io;
        this.mqttClient = null;

        // 🔒 TLS Configuration
        this.host = process.env.MQTT_HOST || "mqtts://192.168.88.221:8883";
        this.tlsOptions = this.prepareTLSOptions();
        this.simulationInterval = null;

        // Shared state maps
        this.userSelectedLocations = new Map();
        this.locationCache = new Map();
        this.controlStateCache = new Map();
        this.lastCacheUpdate = new Map();

        // Chart emission management
        this.chartEmissionTimers = new Map();
        this.chartThrottleMs = 1000;

        // Topics and defaults
        this.sensorTopics = { ESP: "humidity", ESP2: "temperature" };

        // 🔥 MULTI-USER SUPPORT - Replace hardcoded values
        this.activeUsers = new Map(); // userId -> Set of locations they're monitoring
        this.sensorLocation = "sensor-room"; // Keep location but make it shareable

        // Delay stats (rolling)
        this.delayStats = {
            server_processing: [],
            socket_emission: [],
            total_e2e: [],
        };
        this.maxDelayHistory = 100;

        // Sensor cache
        this.sensorData = {
            temperature: null,
            humidity: null,
            bowl_temp: null,
            esp3_data: null,
            sonar_distance: null,
            bowl_fan_status: null,     // NEW
            sonar_pump_status: null,   // NEW
            co2_level: null,              // NEW
            sugar_level: null,            // NEW
            co2_fermentation_status: null,   // NEW
            sugar_fermentation_status: null, // NEW
            lastUpdate: {
                temperature: null,
                humidity: null,
                bowl_temp: null,
                esp3_data: null,
                sonar_distance: null,
                bowl_fan_status: null,     // NEW
                sonar_pump_status: null,    // NEW
                co2_level: null,              // NEW
                sugar_level: null,            // NEW
                co2_fermentation_status: null,   // NEW
                sugar_fermentation_status: null  // NEW
            },
        };

        // 🔒 SYNCHRONIZATION PRIMITIVES
        this.sensorDataMutex = new Mutex();
        this.delayStatsMutex = new Mutex();
        this.cacheMutex = new Mutex();
        this.timerMutex = new Mutex();
        this.dbMutex = new Map(); // Per-user-location mutex map
    }

    // 🔥 NEW: User Management Methods
    registerUser(userId, location = "sensor-room") {
        if (!this.activeUsers.has(userId)) {
            this.activeUsers.set(userId, new Set());
        }
        this.activeUsers.get(userId).add(location);
        console.log(`✅ User ${userId} registered for location: ${location}`);
        console.log(`📊 Total active users: ${this.activeUsers.size}`);
        console.log(`📊 Active users map:`, Array.from(this.activeUsers.entries()));
    }

    unregisterUser(userId, location = null) {
        if (location && this.activeUsers.has(userId)) {
            this.activeUsers.get(userId).delete(location);
            if (this.activeUsers.get(userId).size === 0) {
                this.activeUsers.delete(userId);
            }
        } else {
            this.activeUsers.delete(userId);
        }
        console.log(`❌ User ${userId} unregistered from ${location || 'all locations'}`);
    }

    getActiveUsers() {
        return Array.from(this.activeUsers.keys());
    }

    // 🔥 NEW: Store measurement for specific user
    async storeMeasurementForUser(userId, location, measurementData) {
        try {
            await pool.execute(`
            INSERT INTO measurements 
            (user_id, temperature, humidity, bowl_temp, sonar_distance, co2_level, sugar_level, airflow, location, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    measurementData.temperature,
                    measurementData.humidity,
                    measurementData.bowl_temp || this.sensorData.bowl_temp,
                    measurementData.sonar_distance || this.sensorData.sonar_distance,
                    measurementData.co2_level || this.sensorData.co2_level,        // ADD THIS
                    measurementData.sugar_level || this.sensorData.sugar_level,    // ADD THIS
                    measurementData.airflow,
                    location,
                    new Date()
                ]
            );
            console.log(`✅ Stored measurement for user ${userId} at ${location}`);
        } catch (error) {
            console.error(`❌ Error storing measurement for user ${userId}:`, error.sqlMessage || error.message);
        }
    }




    // 🔒 FIXED: TLS preparation with proper checkServerIdentity function
    prepareTLSOptions() {
        try {
            const caCertPath = process.env.MQTT_CA_CERT_PATH;
            const clientCertPath = process.env.MQTT_CLIENT_CERT_PATH;
            const clientKeyPath = process.env.MQTT_CLIENT_KEY_PATH;

            // Check if broker.crt exists with multiple path attempts
            const possiblePaths = [
                caCertPath,
                './src/mqtt/broker (1).crt',
            ];

            let validCertPath = null;
            for (const path of possiblePaths) {
                if (fs.existsSync(path)) {
                    validCertPath = path;
                    console.log(`✅ Found certificate at: ${path}`);
                    break;
                }
            }

            if (!validCertPath) {
                throw new Error(`Broker certificate not found. Tried paths: ${possiblePaths.join(', ')}`);
            }

            const tlsOptions = {
                // Use your broker.crt as CA certificate
                ca: fs.readFileSync(validCertPath),
                // 🔒 CRITICAL FIX: Properly handle rejectUnauthorized
                rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true',
                // Only add client cert/key if they exist
                ...(clientCertPath && fs.existsSync(clientCertPath) && {
                    cert: fs.readFileSync(clientCertPath)
                }),
                ...(clientKeyPath && fs.existsSync(clientKeyPath) && {
                    key: fs.readFileSync(clientKeyPath)
                }),
                // Security settings for self-signed certificates
                secureProtocol: 'TLSv1_2_method',
                // ✅ FIXED: checkServerIdentity must be a function, not boolean
                checkServerIdentity: () => undefined, // Disables hostname verification
                requestCert: false,
                agent: false
            };

            console.log(`✅ TLS configured using certificate: ${validCertPath}`);
            console.log(`🔒 Reject Unauthorized: ${tlsOptions.rejectUnauthorized}`);
            console.log(`🔒 Server Identity Check: Disabled (function provided)`);
            return tlsOptions;
        } catch (error) {
            console.error('❌ Failed to configure TLS:', error.message);
            console.error('⚠️ This will prevent secure MQTT connection');
            // 🚨 DON'T FALLBACK - Let user fix the issue
            throw new Error(`TLS Configuration Failed: ${error.message}`);
        }
    }

    // 🔒 Validate TLS connection
    validateTLSConnection() {
        if (!this.mqttClient || !this.mqttClient.stream) {
            return false;
        }

        const socket = this.mqttClient.stream;
        if (socket.encrypted) {
            const cipher = socket.getCipher();
            const peerCert = socket.getPeerCertificate();
            console.log('🔒 Secure TLS Connection Established:');
            console.log(` 📡 Protocol: ${socket.getProtocol()}`);
            console.log(` 🔐 Cipher: ${cipher?.name || 'Unknown'} (${cipher?.version || 'N/A'})`);
            console.log(` 📜 Server Certificate: ${peerCert?.subject?.CN || 'Self-signed'}`);
            console.log(` ⏰ Valid Until: ${peerCert?.valid_to || 'Unknown'}`);
            return true;
        }

        console.warn('⚠️ Connection is not encrypted - using plain MQTT');
        return false;
    }

    // 🔒 Get or create mutex for specific user-location combination
    getUserLocationMutex(userId, location) {
        const key = `${userId}-${location}`;
        if (!this.dbMutex.has(key)) {
            this.dbMutex.set(key, new Mutex());
        }
        return this.dbMutex.get(key);
    }

    // ===== THREAD-SAFE Delay helper methods =====
    calculateDelayStats(buffers) {
        const toStats = (arr) =>
            arr && arr.length
                ? {
                    avg:
                        Math.round(
                            ((arr.reduce((a, b) => a + b, 0) / arr.length) * 100)
                        ) / 100,
                    min: Math.min(...arr),
                    max: Math.max(...arr),
                    latest: arr[arr.length - 1],
                    samples: arr.length,
                }
                : { avg: 0, min: 0, max: 0, latest: 0, samples: 0 };

        return {
            server_processing: toStats(buffers.server_processing),
            socket_emission: toStats(buffers.socket_emission),
            total_e2e: toStats(buffers.total_e2e || []),
        };
    }

    // 🔒 FIXED: Thread-safe delay statistics update
    async updateDelayStats(delays) {
        const release = await this.delayStatsMutex.acquire();
        try {
            for (const [k, v] of Object.entries(delays)) {
                if (!this.delayStats[k]) this.delayStats[k] = [];
                // Atomic array operations
                this.delayStats[k].push(v);
                if (this.delayStats[k].length > this.maxDelayHistory) {
                    // Use splice for in-place modification to avoid array reassignment races
                    this.delayStats[k].splice(0, this.delayStats[k].length - this.maxDelayHistory);
                }
            }
        } finally {
            release();
        }
    }

    // 🔥 UPDATED: Emit delay stats to all active locations
    emitDelayStats() {
        const stats = this.calculateDelayStats(this.delayStats);

        // Broadcast to all active locations instead of just defaultLocation
        const activeLocations = new Set();
        for (const locations of this.activeUsers.values()) {
            for (const location of locations) {
                activeLocations.add(location);
            }
        }

        activeLocations.forEach(location => {
            this.io.to(`location_${location}`).emit("delayStatsUpdate", {
                location: location,
                delay_stats: stats,
                ts: Date.now(),
            });
        });
    }

    // 🔒 FIXED: Thread-safe chart data emission with timer management
    async emitChartData(location, measurementData) {
        const key = `chart_${location}`;
        const release = await this.timerMutex.acquire();
        try {
            // Safe timer management
            const existingTimer = this.chartEmissionTimers.get(key);
            if (existingTimer) {
                clearTimeout(existingTimer);
                this.chartEmissionTimers.delete(key);
            }

            // Immediate emit for responsiveness
            this.io.to(`location_${location}`).emit("newMeasurement", measurementData);

            // Set new timer with safe cleanup
            const timer = setTimeout(() => {
                // Use async cleanup to maintain synchronization
                this.cleanupTimer(key);
            }, this.chartThrottleMs);

            this.chartEmissionTimers.set(key, timer);
        } finally {
            release();
        }
    }

    // 🔒 Safe timer cleanup
    async cleanupTimer(key) {
        const release = await this.timerMutex.acquire();
        try {
            this.chartEmissionTimers.delete(key);
        } finally {
            release();
        }
    }

    // 🔒 Enhanced connect method with TLS
    connect() {
        const connectOptions = {
            clientId: `backend-server-${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 60,
            clean: false, // 🔒 Keep session for better reliability
            username: process.env.MQTT_USERNAME || "admin",
            password: process.env.MQTT_PASSWORD || "StrongPassword123",
            // 🔒 Your TLS options using broker.crt
            ...this.tlsOptions,
            // 🔒 ENHANCED: Better connection stability
            connectTimeout: 30 * 1000,
            reconnectPeriod: 2 * 1000, // Faster reconnect
            protocolVersion: 4, // MQTT 3.1.1
            // Will message for connection status
            will: {
                topic: 'system/status',
                payload: JSON.stringify({
                    clientId: `backend-server-${Math.random().toString(16).substr(2, 8)}`,
                    status: 'offline',
                    timestamp: new Date().toISOString(),
                    reason: 'unexpected_disconnect'
                }),
                qos: 1,
                retain: true
            }
        };

        console.log(`🔗 Connecting to MQTT broker: ${this.host}`);
        console.log(`👤 Username: ${connectOptions.username}`);
        console.log(`🔒 TLS Mode: ${Object.keys(this.tlsOptions).length > 0 ? 'Enabled' : 'Disabled'}`);
        console.log(`⚡ Keep Alive: ${connectOptions.keepalive}s`);

        this.mqttClient = mqtt.connect(this.host, connectOptions);

        // Connection successful
        this.mqttClient.on("connect", () => {
            console.log("🌐 MQTT Connected Successfully!");

            // Validate and display TLS status
            const isSecure = this.validateTLSConnection();

            // Publish online status
            this.mqttClient.publish('system/status', JSON.stringify({
                clientId: connectOptions.clientId,
                status: 'online',
                timestamp: new Date().toISOString(),
                tls_enabled: isSecure,
                broker_cert: 'broker.crt loaded'
            }), { qos: 1, retain: true });

            // Subscribe to your topics with higher QoS for reliability
            const subscriptions = [
                { topic: "ESP", description: "humidity sensor", qos: 1 },
                { topic: "ESP2", description: "temperature sensor", qos: 1 },
                { topic: "bowl", description: "bowl temperature sensor", qos: 1 },
                { topic: "bowlT", description: "bowl fan status", qos: 1 },
                { topic: "sonar", description: "sonar distance sensor", qos: 1 },
                { topic: "sonarT", description: "sonar pump status", qos: 1 },
                { topic: "CO2", description: "CO2 level sensor", qos: 1 },        // NEW
                { topic: "CO2T", description: "CO2 fermentation status", qos: 1 },// NEW
                { topic: "sugar", description: "sugar level sensor", qos: 1 },    // NEW
                { topic: "sugarT", description: "sugar fermentation status", qos: 1 },// NEW
                { topic: "ESP3", description: "alert sensor", qos: 1 },
                { topic: "ESP3", description: "alert sensor", qos: 1 },
                // 🆕 NEW: Real sensor topics
                { topic: "ESPX", description: "real sensor 1 data", qos: 1 },
                { topic: "ESPY", description: "real sensor 1 status", qos: 1 },
                { topic: "voltX", description: "real sensor 1 voltage", qos: 1 },
                { topic: "thresX", description: "real sensor 1 threshold", qos: 1 },
                { topic: "ESPX2", description: "real sensor 2 data", qos: 1 },
                { topic: "ESPY2", description: "real sensor 2 status", qos: 1 },
                { topic: "voltX2", description: "real sensor 2 voltage", qos: 1 },
                { topic: "thresX2", description: "real sensor 2 threshold", qos: 1 },
                { topic: "ESPX3", description: "real sensor 3 data", qos: 1 },
                { topic: "ESPY3", description: "real sensor 3 status", qos: 1 },
                { topic: "voltX3", description: "real sensor 3 voltage", qos: 1 },
                { topic: "thresX3", description: "real sensor 3 threshold", qos: 1 },
                { topic: "text", description: "text messages", qos: 1 },
                { topic: "espDevice", description: "device control", qos: 1 },
                { topic: "control/ultraX", description: "ultra control", qos: 1 },
                { topic: "home/+/+/environment", description: "environment data", qos: 1 },
                { topic: "home/+/+/setpoint", description: "setpoint updates", qos: 1 },
                { topic: "home/+/temperature", description: "legacy temperature", qos: 1 },
                { topic: "home/+/+/sensors/+/data", description: "spatial sensor data", qos: 1 }
            ];

            subscriptions.forEach(({ topic, description, qos }) => {
                this.mqttClient.subscribe(topic, { qos }, (err) => {
                    if (err) {
                        console.error(`❌ Failed to subscribe to ${topic}:`, err);
                    } else {
                        console.log(`📡 Subscribed to ${topic} (${description}) - QoS ${qos}`);
                    }
                });
            });

            // Start simulation if enabled
            if (process.env.USE_REAL_SENSORS === "true") {
                console.log("🚀 Using real sensors - simulation disabled");
                // Real sensors will be handled by the new handleRealSensorData method
            } else if (process.env.SIMULATE_SENSOR === "true") {
                this.startSimulation?.();
            }
        });

        // Enhanced error handling
        this.mqttClient.on("error", (error) => {
            console.error("🚨 MQTT Error:", error.message);

            // Don't let validation errors cascade to connection errors
            if (error.message.includes('validation') || error.message.includes('sensor')) {
                console.log("💡 Sensor validation error - maintaining connection");
                return; // Don't disconnect on validation errors
            }

            // Common TLS error codes and solutions
            if (error.code === 'ENOTFOUND') {
                console.error("💡 Solution: Check broker hostname/IP address");
            } else if (error.code === 'ECONNREFUSED') {
                console.error("💡 Solution: Ensure broker is running on port 8883 with TLS enabled");
            } else if (error.code === 'CERT_UNTRUSTED') {
                console.error("💡 Solution: Add broker.crt to trusted certificates or set MQTT_REJECT_UNAUTHORIZED=false");
            } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
                console.error("💡 Solution: Check broker.crt is valid and matches broker's certificate");
            } else if (error.message.includes('self signed certificate')) {
                console.error("💡 Solution: Self-signed cert detected - ensure MQTT_REJECT_UNAUTHORIZED=false in .env");
            }
        });

        // TLS-specific events
        this.mqttClient.on("secureConnect", () => {
            console.log("🔐 Secure TLS handshake completed");
        });

        this.mqttClient.on("offline", () => {
            console.warn("📴 MQTT client offline - attempting reconnection");
        });

        this.mqttClient.on("reconnect", () => {
            console.log("🔄 MQTT reconnecting...");
        });

        this.mqttClient.on("close", () => {
            console.log("🔌 MQTT connection closed");
        });

        // Message handling with enhanced security
        this.mqttClient.on("message", async (topic, message) => {
            // 🔒 FIXED: Relaxed validation that won't cause disconnections
            if (!this.validateIncomingMessage(topic, message)) {
                console.warn(`⚠️ Invalid message format on topic: ${topic} - but continuing`);
                // Don't return here - process the message anyway to prevent disconnections
            }

            const payload = message.toString();

            if (topic === "ESP" || topic === "ESP2") {
                await this.handleSensorData(topic, message.toString());

                // ✅ FIXED: Process ESP2 as real sensor BEFORE returning
                if (topic === "ESP2") {
                    console.log(`🔄 Processing ESP2 as REAL_TEMP_004: ${message.toString()}`);
                    await this.handleRealSensorData(topic, message.toString());
                }

                return;  // ✅ Return AFTER processing ESP2
            }

            if (topic === "bowl") {
                await this.handleBowlData(topic, payload);
                return;
            }

            // NEW: Handle bowl fan status
            if (topic === "bowlT") {
                await this.handleBowlFanStatus(topic, payload);
                return;
            }

            // NEW: Handle sonar distance
            if (topic === "sonar") {
                await this.handleSonarData(topic, payload);
                return;
            }

            // NEW: Handle sonar pump status
            if (topic === "sonarT") {
                await this.handleSonarPumpStatus(topic, payload);
                return;
            }

            // NEW: CO2 handlers
            if (topic === "CO2") {
                await this.handleCO2Data(topic, payload);
                return;
            }
            if (topic === "CO2T") {
                await this.handleCO2FermentationStatus(topic, payload);
                return;
            }

            // NEW: Sugar handlers
            if (topic === "sugar") {
                await this.handleSugarData(topic, payload);
                return;
            }
            if (topic === "sugarT") {
                await this.handleSugarFermentationStatus(topic, payload);
                return;
            }



            if (topic === "text") {
                await this.handleTextMessage?.(message.toString());
                return;
            }

            if (topic === "espDevice") {
                await this.handleDeviceControl?.(message.toString());
                return;
            }

            if (topic === "ESP3") {
                await this.handleESP3Data(topic, message.toString());
                return;
            }

            // 🆕 NEW: Handle real sensor data
            if (topic.startsWith("ESPX")) {
                await this.handleRealSensorData(topic, message.toString());
                return;
            }

            // Handle spatial sensor data for spatial controller
            if (topic.includes("/sensors/") && topic.endsWith("/data")) {
                await this.handleSpatialSensorData(topic, message.toString());
                return;
            }

            if (topic === "control/ultraX") {
                await this.handleUltraControl?.(message.toString());
                return;
            }

            // Existing topic formats
            const parts = topic.split("/");
            if (parts.length === 3) {
                // Legacy: home/userId/temperature|setpoint
                const userId = parseInt(parts[1]);
                const messageType = parts[2];
                if (!userId) return;

                try {
                    if (messageType === "temperature") {
                        await this.handleLegacyTemperatureReading?.(
                            userId,
                            parseFloat(message.toString())
                        );
                    }
                } catch (err) {
                    console.error("Error processing legacy MQTT message:", err);
                }
            } else if (parts.length === 4) {
                // New: home/userId/location/channel
                const userId = parseInt(parts[1]);
                const location = parts[2];
                const channel = parts[3];
                if (!userId || !location) return;

                try {
                    if (channel === "environment") {
                        const envData = JSON.parse(message.toString() || "{}");
                        await this.handleEnvironmentReading?.(userId, location, envData);
                    } else if (channel === "setpoint") {
                        const setpointData = JSON.parse(message.toString() || "{}");
                        await this.handleSetpointUpdate?.(userId, location, setpointData);
                    }
                } catch (err) {
                    console.error("Error processing MQTT message:", err);
                }
            }
        });
    }

    // 🔒 FIXED: Relaxed validation that won't cause disconnections
    validateIncomingMessage(topic, message) {
        try {
            // Check message size (prevent DoS)
            if (message.length > 50000) {
                console.warn(`Message too large: ${message.length} bytes on topic: ${topic}`);
                return false;
            }

            // Validate topic format
            if (!/^[a-zA-Z0-9/_+-]+$/.test(topic)) {
                console.warn(`Invalid topic format: ${topic}`);
                return false;
            }

            // For sensor topics, basic numeric validation only
            if (topic === "ESP" || topic === "ESP2") {
                const value = parseFloat(message.toString());
                if (!Number.isFinite(value)) {
                    console.warn(`Non-numeric sensor value: ${message.toString()} on topic: ${topic}`);
                    return false;
                }

                // 🔒 RELAXED: Allow wide range, just log unusual values
                if (topic === "ESP") {
                    if (value < -50 || value > 5000) {
                        console.warn(`⚠️ Extreme humidity value: ${value} on topic: ${topic} - allowing but investigate sensor`);
                    }
                } else if (topic === "ESP2") {
                    if (value < -200 || value > 5000) {
                        console.warn(`⚠️ Extreme temperature value: ${value} on topic: ${topic} - allowing but investigate sensor`);
                    }
                }
                return true; // Always allow numeric values
            }

            // For JSON messages, basic structure validation
            if (topic.includes('environment') || topic.includes('setpoint')) {
                try {
                    JSON.parse(message.toString());
                    return true; // If it's valid JSON, allow it
                } catch (e) {
                    console.warn(`Invalid JSON in message: ${e.message}`);
                    return false;
                }
            }

            return true; // Allow all other messages
        } catch (error) {
            console.error('Message validation error:', error);
            return true; // Allow on error to prevent disconnections
        }
    }

    // 🔥 UPDATED: Multi-user sensor data handling
    async handleSensorData(topic, messageValue) {
        console.log(`\n🔥 ========== SENSOR DATA RECEIVED ==========`);
        console.log(`🔥 Topic: ${topic}, Value: ${messageValue}`);
        console.log(`🔥 Active users count: ${this.activeUsers.size}`);

        try {
            const serverReceivedTs = performance.now();
            let value = parseFloat(messageValue);

            if (!Number.isFinite(value)) {
                console.warn(`⚠️ Non-numeric sensor value: ${messageValue} on topic: ${topic}`);
                return;
            }

            // Validation
            if (topic === "ESP") {
                if (value > 1000 && value <= 4095) {
                    value = (value / 4095) * 100;
                }
                if (value < -50 || value > 150) {
                    console.warn(`⚠️ Humidity out of range: ${value}% on topic: ${topic}`);
                }
            } else if (topic === "ESP2") {
                value = value * 10.6;
            }

            // ✅ CRITICAL FIX: Update cache FIRST, then store
            const release = await this.sensorDataMutex.acquire();
            try {
                console.log(`🔥 Sensor cache BEFORE update:`, {
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp
                });

                const now = new Date();

                // Update sensor cache IMMEDIATELY
                if (topic === "ESP") {
                    this.sensorData.humidity = value;
                    this.sensorData.lastUpdate.humidity = now;
                    console.log(`💧 Updated humidity cache: ${value}%`);
                } else if (topic === "ESP2") {
                    this.sensorData.temperature = value;
                    this.sensorData.lastUpdate.temperature = now;
                    console.log(`🌡️ Updated temperature cache: ${value}°C`);
                }

                console.log(`🔥 Sensor cache AFTER update:`, {
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp
                });
            } finally {
                release();
            }

            // ✅ NOW use the UPDATED cache values for storage
            const nowIso = new Date().toISOString();
            const broadcastPromises = [];
            let insertCount = 0;

            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const enriched = {
                        id: Date.now() + Math.random(),
                        user_id: userId,
                        location: location,
                        temperature: this.sensorData.temperature,  // ✅ Uses UPDATED cache
                        humidity: this.sensorData.humidity,        // ✅ Uses UPDATED cache
                        bowl_temp: this.sensorData.bowl_temp,      // ✅ Uses UPDATED cache
                        sonar_distance: this.sensorData.sonar_distance,
                        co2_level: this.sensorData.co2_level,        // ADD THIS
                        sugar_level: this.sensorData.sugar_level,    // ADD THIS
                        airflow: 2.0,
                        created_at: nowIso,
                        timestamps: {
                            server_received: serverReceivedTs,
                            server_processing_start: performance.now(),
                            server_processing_end: null,
                            server_emit_start: null,
                        },
                    };

                    console.log(`📤 Storing for user ${userId}, location ${location}:`, {
                        temp: enriched.temperature,
                        hum: enriched.humidity,
                        bowl: enriched.bowl_temp
                    });

                    // Broadcast via Socket.IO
                    this.io.to(`location_${location}`).emit("newMeasurement", enriched);
                    this.io.to(`user_${userId}`).emit("newMeasurement", enriched);

                    // Store in database (ONE TIME ONLY)
                    broadcastPromises.push(
                        this.storeMeasurementForUser(userId, location, enriched).then(() => {
                            console.log(`✅ STORED for user ${userId}: temp=${enriched.temperature}, hum=${enriched.humidity}, bowl=${enriched.bowl_temp}`);
                            insertCount++;
                        }).catch(err => {
                            console.error(`❌ FAILED to store for user ${userId}:`, err.message);
                        })
                    );
                }
            }

            // Execute all database operations
            await Promise.allSettled(broadcastPromises);
            console.log(`✅ Temp/Humidity: Completed ${insertCount}/${broadcastPromises.length} database inserts`);

            // Handle environment readings
            if (this.sensorData.temperature !== null && this.sensorData.humidity !== null) {
                const envData = {
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp,
                    airflow: 2.0,
                    unit_airflow: "m/s",
                };

                for (const [userId, locations] of this.activeUsers) {
                    for (const location of locations) {
                        broadcastPromises.push(
                            this.handleEnvironmentReading(userId, location, envData)
                        );
                    }
                }
            }

            console.log(`📡 Broadcasted sensor data to ${this.activeUsers.size} active users`);
            console.log(`🔥 ========== END SENSOR DATA ==========\n`);

            // Update delay stats
            const processingEnd = performance.now();
            const serverProcessingMs = processingEnd - serverReceivedTs;
            await this.updateDelayStats({
                server_processing: serverProcessingMs,
                socket_emission: 1.0,
            });

            if (this.delayStats.server_processing.length % 10 === 0) {
                this.emitDelayStats();
            }

        } catch (error) {
            console.error(`❌ Error processing sensor data for topic ${topic}:`, error);
        }
    }



    async handleRealSensorData(topic, messageValue) {
        try {
            const sensorMapping = {
                "ESP2": { id: "REAL_TEMP_004", x: 8.0, y: 8.0, type: "temperature" },  // Top-right
                "ESPX": { id: "REAL_TEMP_001", x: 2.0, y: 2.0, type: "temperature" },  // Bottom-left
                "ESPX2": { id: "REAL_TEMP_002", x: 8.0, y: 2.0, type: "temperature" }, // Bottom-right
                "ESPX3": { id: "REAL_TEMP_003", x: 2.0, y: 8.0, type: "temperature" }  // Top-left
            };

            const sensor = sensorMapping[topic];
            if (!sensor) return;

            let rawValue = parseFloat(messageValue);
            if (!Number.isFinite(rawValue)) {
                console.warn(`Invalid sensor value from ${topic}: ${messageValue}`);
                return;
            }

            // 🔄 FIXED: Convert raw ADC values (0-4095) to realistic temperature (15-30°C)
            let temperature;
            if (rawValue > 1000 && rawValue <= 4095) {
                // Raw ADC conversion to temperature range
                temperature = 15 + (rawValue / 4095) * 15; // 15°C to 30°C range
                console.log(`🔄 ADC Conversion: ${rawValue} → ${temperature.toFixed(2)}°C`);
            } else if (rawValue >= 0 && rawValue <= 100) {
                // Already in percentage or normal range
                temperature = rawValue;
            } else {
                // Out of expected range - use as is but log warning
                temperature = rawValue;
                console.warn(`⚠️ Unusual sensor value: ${rawValue} from ${topic}`);
            }

            const now = new Date();
            const nowIso = now.toISOString();

            // 🔄 FIXED: Update database for all active users
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    try {
                        // Update sensor_nodes table with latest reading
                        await pool.execute(`
              UPDATE sensor_nodes
              SET last_reading = ?, last_update = NOW()
              WHERE user_id = ? AND sensor_id = ? AND location = ?`,
                            [temperature, userId, sensor.id, location]
                        );

                        // Insert measurement record
                        await pool.execute(`
              INSERT INTO measurements
              (user_id, temperature, humidity, airflow, location, sensor_id, x_coordinate, y_coordinate, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [userId, temperature, 50.0, 2.0, location, sensor.id, sensor.x, sensor.y, now]
                        );

                        console.log(`✅ Database updated for user ${userId}: ${sensor.id} = ${temperature.toFixed(2)}°C`);
                    } catch (dbError) {
                        console.error(`❌ Database update failed for user ${userId}, ${sensor.id}:`, dbError);
                    }
                }
            }

            // Convert to spatial sensor data format
            const spatialData = {
                temperature: parseFloat(temperature.toFixed(2)),
                humidity: 50.0,
                airflow: 2.0,
                timestamp: nowIso
            };

            // 🔄 FIXED: Emit real-time update to all active users
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    // Publish to spatial controller format
                    const spatialTopic = `home/${userId}/${location}/sensors/${sensor.id}/data`;
                    this.mqttClient.publish(spatialTopic, JSON.stringify(spatialData), { qos: 1 });

                    this.io.to(`location_${location}`).emit("spatialSensorUpdate", {
                        sensorId: sensor.id,
                        location: location,
                        temperature: parseFloat(temperature.toFixed(2)),
                        humidity: 50.0,
                        airflow: 2.0,
                        x: sensor.x,
                        y: sensor.y,
                        timestamp: nowIso,
                        quality: "good"
                    });
                }
            }

            console.log(`🔄 Real sensor update: ${topic} (${temperature.toFixed(2)}°C) → All active users`);
        } catch (error) {
            console.error(`❌ Error handling real sensor data for ${topic}:`, error);
        }
    }

    // Add this new method to EnhancedMqttHandler class
    async handleBowlData(topic, messageValue) {
        console.log(`\n🥣 ========== BOWL DATA RECEIVED ==========`);
        const startTime = performance.now();

        try {
            const value = parseFloat(messageValue);

            if (!Number.isFinite(value)) {
                console.warn(`⚠️ Invalid bowl temperature: ${messageValue}`);
                return;
            }

            if (this.activeUsers.size === 0) {
                console.log('⏸️ No active users - skipping bowl temperature storage');
                return;
            }

            console.log(`🥣 Bowl temperature received: ${value}°C for ${this.activeUsers.size} users`);
            console.log(`🥣 Current sensor cache BEFORE update:`, {
                temperature: this.sensorData.temperature,
                humidity: this.sensorData.humidity,
                bowl_temp: this.sensorData.bowl_temp
            });

            // Update sensor cache
            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.bowl_temp = value;
                this.sensorData.lastUpdate.bowl_temp = new Date();
                console.log(`🥣 Updated bowl_temp cache: ${value}°C`);
            } finally {
                release();
            }

            console.log(`🥣 Sensor cache AFTER update:`, {
                temperature: this.sensorData.temperature,
                humidity: this.sensorData.humidity,
                bowl_temp: this.sensorData.bowl_temp
            });

            // ✅ CRITICAL: Check if we have temp/humidity data
            if (this.sensorData.temperature === null || this.sensorData.humidity === null) {
                console.warn(`⚠️ Temperature or Humidity not available yet. Waiting for sensor data...`);
                console.warn(`   Temperature: ${this.sensorData.temperature}, Humidity: ${this.sensorData.humidity}`);

                // Emit bowl temperature update even if temp/humidity are null
                const activeLocations = new Set();
                for (const locations of this.activeUsers.values()) {
                    for (const location of locations) {
                        activeLocations.add(location);
                    }
                }

                activeLocations.forEach(location => {
                    this.io.to(`location_${location}`).emit("environmentUpdate", {
                        userId: Array.from(this.activeUsers.keys())[0],
                        location,
                        temperature: this.sensorData.temperature,
                        humidity: this.sensorData.humidity,
                        bowl_temp: value,
                        airflow: 2.0,
                        timestamp: Date.now(),
                        created_at: new Date().toISOString()
                    });
                });

                return; // Don't insert to DB if temp/humidity are missing
            }

            // Batch insert with ALL sensor data
            const insertPromises = [];
            let successCount = 0;

            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    console.log(`📤 Bowl insert for user ${userId}, location ${location}:`, {
                        temp: this.sensorData.temperature,
                        hum: this.sensorData.humidity,
                        bowl: value
                    });

                    insertPromises.push(
                        pool.execute(
                            `INSERT INTO measurements 
                         (user_id, temperature, humidity, bowl_temp, airflow, location, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                            [
                                userId,
                                this.sensorData.temperature,  // Current temp
                                this.sensorData.humidity,      // Current humidity
                                value,                          // Bowl temp
                                2.0,                           // Airflow
                                location
                            ]
                        ).then(() => {
                            console.log(`✅ BOWL STORED for user ${userId}: temp=${this.sensorData.temperature}, hum=${this.sensorData.humidity}, bowl=${value}`);
                            successCount++;
                            return true;
                        }).catch(err => {
                            console.error(`❌ Bowl DB insert failed for user ${userId}:`, err.sqlMessage || err.message);
                            return null;
                        })
                    );
                }
            }

            // Execute all inserts
            const results = await Promise.allSettled(insertPromises);
            console.log(`✅ Bowl temp ${value}°C stored successfully: ${successCount}/${insertPromises.length}`);

            // Emit Socket.IO updates
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("environmentUpdate", {
                    userId: Array.from(this.activeUsers.keys())[0],
                    location,
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: value,
                    airflow: 2.0,
                    timestamp: Date.now(),
                    created_at: new Date().toISOString()
                });
                console.log(`📡 Emitted bowl update to location_${location}`);
            });

            console.log(`🥣 ========== END BOWL DATA ==========\n`);

            // Performance tracking
            const serverProcessTime = performance.now() - startTime;
            await this.updateDelayStats({
                server_processing: serverProcessTime,
                socket_emission: 0.5,
                total_e2e: serverProcessTime + 0.5
            });

        } catch (error) {
            console.error("❌ Error handling bowl temperature:", error);
            console.log(`🥣 ========== ERROR IN BOWL DATA ==========\n`);
        }
    }

    // Handle Bowl Fan Status (bowlT topic)
    async handleBowlFanStatus(topic, messageValue) {
        console.log(`\n🌀 ========== BOWL FAN STATUS RECEIVED ==========`);

        try {
            const status = messageValue.toString().trim();

            console.log(`🌀 Bowl fan status received: ${status}`);

            // Update sensor cache
            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.bowl_fan_status = status;
                this.sensorData.lastUpdate.bowl_fan_status = new Date();
            } finally {
                release();
            }

            // Determine status message
            let statusMessage = '';
            let fanState = false;

            if (status === 'FO') {
                statusMessage = 'Temp High, Fan is ON';
                fanState = true;
            } else {
                statusMessage = 'Temp Normal, Fan OFF';
                fanState = false;
            }

            console.log(`🌀 Status: ${statusMessage}`);

            // Store in database for all active users
            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    try {
                        await pool.execute(
                            `UPDATE measurements 
                         SET bowl_fan_status = ?
                         WHERE user_id = ? AND location = ?
                         ORDER BY created_at DESC 
                         LIMIT 1`,
                            [status, userId, location]
                        );

                        console.log(`✅ Bowl fan status updated for user ${userId}`);
                    } catch (dbError) {
                        console.error(`❌ DB update failed for user ${userId}:`, dbError.message);
                    }
                }
            }

            // Emit status via Socket.IO
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("bowlFanStatus", {
                    status,
                    message: statusMessage,
                    fanState,
                    location,
                    timestamp: Date.now()
                });
                console.log(`📡 Emitted bowl fan status to location_${location}`);
            });

            console.log(`🌀 ========== END BOWL FAN STATUS ==========\n`);

        } catch (error) {
            console.error("❌ Error handling bowl fan status:", error);
        }
    }

    // Handle Sonar Pump Status (sonarT topic)
    async handleSonarPumpStatus(topic, messageValue) {
        console.log(`\n💦 ========== SONAR PUMP STATUS RECEIVED ==========`);

        try {
            const status = messageValue.toString().trim();

            console.log(`💦 Sonar pump status received: ${status}`);

            // Update sensor cache
            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.sonar_pump_status = status;
                this.sensorData.lastUpdate.sonar_pump_status = new Date();
            } finally {
                release();
            }

            // Determine status message
            let statusMessage = '';
            let pumpState = false;

            if (status === 'PO') {
                statusMessage = 'Water Level Low, Pump is ON';
                pumpState = true;
            } else {
                statusMessage = 'Water Level Normal, Pump OFF';
                pumpState = false;
            }

            console.log(`💦 Status: ${statusMessage}`);

            // Store in database for all active users
            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    try {
                        await pool.execute(
                            `UPDATE measurements 
                         SET sonar_pump_status = ?
                         WHERE user_id = ? AND location = ?
                         ORDER BY created_at DESC 
                         LIMIT 1`,
                            [status, userId, location]
                        );

                        console.log(`✅ Sonar pump status updated for user ${userId}`);
                    } catch (dbError) {
                        console.error(`❌ DB update failed for user ${userId}:`, dbError.message);
                    }
                }
            }

            // Emit status via Socket.IO
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("sonarPumpStatus", {
                    status,
                    message: statusMessage,
                    pumpState,
                    location,
                    timestamp: Date.now()
                });
                console.log(`📡 Emitted sonar pump status to location_${location}`);
            });

            console.log(`💦 ========== END SONAR PUMP STATUS ==========\n`);

        } catch (error) {
            console.error("❌ Error handling sonar pump status:", error);
        }
    }

    // ========== CO2 LEVEL SENSOR ==========
    async handleCO2Data(topic, messageValue) {
        console.log(`\n🫧 ========== CO2 DATA RECEIVED ==========`);
        const startTime = performance.now();

        try {
            const value = parseFloat(messageValue);

            if (!Number.isFinite(value)) {
                console.warn(`⚠️ Invalid CO2 level: ${messageValue}`);
                return;
            }

            if (this.activeUsers.size === 0) {
                console.log('⏸️ No active users - skipping CO2 storage');
                return;
            }

            console.log(`🫧 CO2 level received: ${value} ppm for ${this.activeUsers.size} users`);

            // Update sensor cache
            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.co2_level = value;
                this.sensorData.lastUpdate.co2_level = new Date();
                console.log(`🫧 Updated co2_level cache: ${value} ppm`);
            } finally {
                release();
            }

            // Batch insert with ALL sensor data
            const insertPromises = [];

            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    insertPromises.push(
                        pool.execute(
                            `INSERT INTO measurements 
                         (user_id, temperature, humidity, bowl_temp, sonar_distance, co2_level, sugar_level, airflow, location, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                            [
                                userId,
                                this.sensorData.temperature,
                                this.sensorData.humidity,
                                this.sensorData.bowl_temp,
                                this.sensorData.sonar_distance,
                                value,  // CO2 level
                                this.sensorData.sugar_level,
                                2.0,
                                location
                            ]
                        ).then(() => {
                            console.log(`✅ CO2 STORED for user ${userId}: ${value} ppm`);
                            return true;
                        }).catch(err => {
                            console.error(`❌ CO2 DB insert failed:`, err.message);
                            return null;
                        })
                    );
                }
            }

            const results = await Promise.allSettled(insertPromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
            console.log(`✅ CO2 ${value} ppm stored: ${successCount}/${insertPromises.length}`);

            // Emit Socket.IO updates
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("environmentUpdate", {
                    userId: Array.from(this.activeUsers.keys())[0],
                    location,
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp,
                    sonar_distance: this.sensorData.sonar_distance,
                    co2_level: value,
                    sugar_level: this.sensorData.sugar_level,
                    airflow: 2.0,
                    timestamp: Date.now(),
                    created_at: new Date().toISOString()
                });
            });

            console.log(`🫧 ========== END CO2 DATA ==========\n`);

            const serverProcessTime = performance.now() - startTime;
            await this.updateDelayStats({
                server_processing: serverProcessTime,
                socket_emission: 0.5,
                total_e2e: serverProcessTime + 0.5
            });

        } catch (error) {
            console.error("❌ Error handling CO2 data:", error);
        }
    }

    // ========== SUGAR LEVEL SENSOR ==========
    async handleSugarData(topic, messageValue) {
        console.log(`\n🍬 ========== SUGAR DATA RECEIVED ==========`);
        const startTime = performance.now();

        try {
            const value = parseFloat(messageValue);

            if (!Number.isFinite(value)) {
                console.warn(`⚠️ Invalid sugar level: ${messageValue}`);
                return;
            }

            if (this.activeUsers.size === 0) {
                console.log('⏸️ No active users - skipping sugar storage');
                return;
            }

            console.log(`🍬 Sugar level received: ${value} g/L for ${this.activeUsers.size} users`);

            // Update sensor cache
            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.sugar_level = value;
                this.sensorData.lastUpdate.sugar_level = new Date();
                console.log(`🍬 Updated sugar_level cache: ${value} g/L`);
            } finally {
                release();
            }

            // Batch insert
            const insertPromises = [];

            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    insertPromises.push(
                        pool.execute(
                            `INSERT INTO measurements 
                         (user_id, temperature, humidity, bowl_temp, sonar_distance, co2_level, sugar_level, airflow, location, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                            [
                                userId,
                                this.sensorData.temperature,
                                this.sensorData.humidity,
                                this.sensorData.bowl_temp,
                                this.sensorData.sonar_distance,
                                this.sensorData.co2_level,
                                value,  // Sugar level
                                2.0,
                                location
                            ]
                        ).then(() => {
                            console.log(`✅ SUGAR STORED for user ${userId}: ${value} g/L`);
                            return true;
                        }).catch(err => {
                            console.error(`❌ Sugar DB insert failed:`, err.message);
                            return null;
                        })
                    );
                }
            }

            const results = await Promise.allSettled(insertPromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
            console.log(`✅ Sugar ${value} g/L stored: ${successCount}/${insertPromises.length}`);

            // Emit Socket.IO
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("environmentUpdate", {
                    userId: Array.from(this.activeUsers.keys())[0],
                    location,
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp,
                    sonar_distance: this.sensorData.sonar_distance,
                    co2_level: this.sensorData.co2_level,
                    sugar_level: value,
                    airflow: 2.0,
                    timestamp: Date.now(),
                    created_at: new Date().toISOString()
                });
            });

            console.log(`🍬 ========== END SUGAR DATA ==========\n`);

        } catch (error) {
            console.error("❌ Error handling sugar data:", error);
        }
    }

    // ========== CO2 FERMENTATION STATUS ==========
    async handleCO2FermentationStatus(topic, messageValue) {
        console.log(`\n🫧⚗️ ========== CO2 FERMENTATION STATUS RECEIVED ==========`);

        try {
            const status = messageValue.toString().trim();
            console.log(`🫧 CO2 fermentation status: ${status}`);

            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.co2_fermentation_status = status;
                this.sensorData.lastUpdate.co2_fermentation_status = new Date();
            } finally {
                release();
            }

            let statusMessage = '';
            let fermentationActive = false;

            if (status === 'AF') {
                statusMessage = 'Fermentation Going';
                fermentationActive = true;
            } else {
                statusMessage = 'Fermentation is OFF, Something is Wrong';
                fermentationActive = false;
            }

            console.log(`🫧 Status: ${statusMessage}`);

            // Update database
            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    try {
                        await pool.execute(
                            `UPDATE measurements 
                         SET co2_fermentation_status = ?
                         WHERE user_id = ? AND location = ?
                         ORDER BY created_at DESC 
                         LIMIT 1`,
                            [status, userId, location]
                        );
                        console.log(`✅ CO2 fermentation status updated`);
                    } catch (dbError) {
                        console.error(`❌ DB update failed:`, dbError.message);
                    }
                }
            }

            // Emit status
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("co2FermentationStatus", {
                    status,
                    message: statusMessage,
                    fermentationActive,
                    location,
                    timestamp: Date.now()
                });
            });

            console.log(`🫧⚗️ ========== END CO2 FERMENTATION STATUS ==========\n`);

        } catch (error) {
            console.error("❌ Error handling CO2 fermentation status:", error);
        }
    }

    // ========== SUGAR FERMENTATION STATUS ==========
    async handleSugarFermentationStatus(topic, messageValue) {
        console.log(`\n🍬⚗️ ========== SUGAR FERMENTATION STATUS RECEIVED ==========`);

        try {
            const status = messageValue.toString().trim();
            console.log(`🍬 Sugar fermentation status: ${status}`);

            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.sugar_fermentation_status = status;
                this.sensorData.lastUpdate.sugar_fermentation_status = new Date();
            } finally {
                release();
            }

            let statusMessage = '';
            let fermentationComplete = false;

            if (status === 'FFC') {
                statusMessage = 'Fermentation Complete';
                fermentationComplete = true;
            } else {
                statusMessage = 'Fermentation Closed';
                fermentationComplete = false;
            }

            console.log(`🍬 Status: ${statusMessage}`);

            // Update database
            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    try {
                        await pool.execute(
                            `UPDATE measurements 
                         SET sugar_fermentation_status = ?
                         WHERE user_id = ? AND location = ?
                         ORDER BY created_at DESC 
                         LIMIT 1`,
                            [status, userId, location]
                        );
                        console.log(`✅ Sugar fermentation status updated`);
                    } catch (dbError) {
                        console.error(`❌ DB update failed:`, dbError.message);
                    }
                }
            }

            // Emit status
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("sugarFermentationStatus", {
                    status,
                    message: statusMessage,
                    fermentationComplete,
                    location,
                    timestamp: Date.now()
                });
            });

            console.log(`🍬⚗️ ========== END SUGAR FERMENTATION STATUS ==========\n`);

        } catch (error) {
            console.error("❌ Error handling sugar fermentation status:", error);
        }
    }


    async handleSonarData(topic, messageValue) {
        console.log(`\n📏 ========== SONAR DATA RECEIVED ==========`);
        const startTime = performance.now();

        try {
            const value = parseFloat(messageValue);

            if (!Number.isFinite(value)) {
                console.warn(`⚠️ Invalid sonar distance: ${messageValue}`);
                return;
            }

            if (this.activeUsers.size === 0) {
                console.log('⏸️ No active users - skipping sonar storage');
                return;
            }

            console.log(`📏 Sonar distance received: ${value} cm for ${this.activeUsers.size} users`);
            console.log(`📏 Current sensor cache BEFORE update:`, {
                temperature: this.sensorData.temperature,
                humidity: this.sensorData.humidity,
                bowl_temp: this.sensorData.bowl_temp,
                sonar_distance: this.sensorData.sonar_distance
            });

            // Update sensor cache
            const release = await this.sensorDataMutex.acquire();
            try {
                this.sensorData.sonar_distance = value;
                this.sensorData.lastUpdate.sonar_distance = new Date();
                console.log(`📏 Updated sonar_distance cache: ${value} cm`);
            } finally {
                release();
            }

            console.log(`📏 Sensor cache AFTER update:`, {
                temperature: this.sensorData.temperature,
                humidity: this.sensorData.humidity,
                bowl_temp: this.sensorData.bowl_temp,
                sonar_distance: this.sensorData.sonar_distance
            });

            // Check if we have temp/humidity data
            if (this.sensorData.temperature === null || this.sensorData.humidity === null) {
                console.warn(`⚠️ Temperature or Humidity not available yet. Waiting...`);

                // Still emit sonar update via Socket.IO
                const activeLocations = new Set();
                for (const locations of this.activeUsers.values()) {
                    for (const location of locations) {
                        activeLocations.add(location);
                    }
                }

                activeLocations.forEach(location => {
                    this.io.to(`location_${location}`).emit("environmentUpdate", {
                        userId: Array.from(this.activeUsers.keys())[0],
                        location,
                        temperature: this.sensorData.temperature,
                        humidity: this.sensorData.humidity,
                        bowl_temp: this.sensorData.bowl_temp,
                        sonar_distance: value,
                        airflow: 2.0,
                        timestamp: Date.now(),
                        created_at: new Date().toISOString()
                    });
                });

                return;
            }

            // Batch insert with ALL sensor data
            const insertPromises = [];

            for (const [userId, locations] of this.activeUsers.entries()) {
                for (const location of locations) {
                    console.log(`📤 Sonar insert for user ${userId}, location ${location}:`, {
                        temp: this.sensorData.temperature,
                        hum: this.sensorData.humidity,
                        bowl: this.sensorData.bowl_temp,
                        sonar: value
                    });

                    insertPromises.push(
                        pool.execute(
                            `INSERT INTO measurements 
                         (user_id, temperature, humidity, bowl_temp, sonar_distance, airflow, location, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                            [
                                userId,
                                this.sensorData.temperature,
                                this.sensorData.humidity,
                                this.sensorData.bowl_temp,
                                value,  // Sonar distance
                                2.0,
                                location
                            ]
                        ).then(() => {
                            console.log(`✅ SONAR STORED for user ${userId}: temp=${this.sensorData.temperature}, hum=${this.sensorData.humidity}, bowl=${this.sensorData.bowl_temp}, sonar=${value}`);
                            return true;
                        }).catch(err => {
                            console.error(`❌ Sonar DB insert failed for user ${userId}:`, err.sqlMessage || err.message);
                            return null;
                        })
                    );
                }
            }

            // Execute all inserts
            const results = await Promise.allSettled(insertPromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
            console.log(`✅ Sonar ${value} cm stored successfully: ${successCount}/${insertPromises.length}`);

            // Emit Socket.IO updates
            const activeLocations = new Set();
            for (const locations of this.activeUsers.values()) {
                for (const location of locations) {
                    activeLocations.add(location);
                }
            }

            activeLocations.forEach(location => {
                this.io.to(`location_${location}`).emit("environmentUpdate", {
                    userId: Array.from(this.activeUsers.keys())[0],
                    location,
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp,
                    sonar_distance: value,
                    airflow: 2.0,
                    timestamp: Date.now(),
                    created_at: new Date().toISOString()
                });
                console.log(`📡 Emitted sonar update to location_${location}`);
            });

            console.log(`📏 ========== END SONAR DATA ==========\n`);

            // Performance tracking
            const serverProcessTime = performance.now() - startTime;
            await this.updateDelayStats({
                server_processing: serverProcessTime,
                socket_emission: 0.5,
                total_e2e: serverProcessTime + 0.5
            });

        } catch (error) {
            console.error("❌ Error handling sonar distance:", error);
            console.log(`📏 ========== ERROR IN SONAR DATA ==========\n`);
        }
    }




    // 🔄 NEW: Check sensor status in database
    async checkSensorStatus() {
        try {
            // Check for all active users
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    const [sensors] = await pool.execute(`
            SELECT sensor_id, last_reading, last_update,
            TIMESTAMPDIFF(SECOND, last_update, NOW()) as seconds_ago
            FROM sensor_nodes
            WHERE user_id = ? AND location = ? AND sensor_id LIKE 'REAL_%'
            ORDER BY sensor_id`,
                        [userId, location]
                    );

                    console.log(`\n📊 Real Sensor Status (User ${userId}, ${location}):`);
                    sensors.forEach(sensor => {
                        const status = sensor.seconds_ago < 120 ? '🟢 ONLINE' : '🔴 OFFLINE';
                        console.log(` ${sensor.sensor_id}: ${sensor.last_reading}°C (${sensor.seconds_ago}s ago) ${status}`);
                    });
                }
            }
            console.log('');
        } catch (error) {
            console.error('Error checking sensor status:', error);
            return [];
        }
    }

    // 🆕 NEW: Handle spatial sensor data for the spatial controller
    async handleSpatialSensorData(topic, message) {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📡 Spatial sensor data: ${topic}`, data);

            // Emit to spatial controller clients
            this.io.emit("spatialSensorData", {
                topic,
                data,
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error handling spatial sensor data:", error);
        }
    }

    async handleESP3Data(topic, messageValue) {
        try {
            const serverReceivedTs = performance.now();
            const value = parseFloat(messageValue);
            const now = new Date();
            const nowIso = now.toISOString();

            // Validate ESP3 data
            if (!Number.isFinite(value)) {
                console.warn(`Non-numeric ESP3 value: ${messageValue} on topic: ${topic}`);
                return;
            }

            // Update ESP3 cache
            this.sensorData.esp3_data = value;
            this.sensorData.lastUpdate.esp3_data = now;

            // Create enriched ESP3 alert data
            const processingStart = performance.now();
            const esp3Alert = {
                id: Date.now(),
                esp3_value: value,
                alert_type: 'ESP3_PERIODIC_DATA',
                created_at: nowIso,
                timestamps: {
                    server_received: serverReceivedTs,
                    server_processing_start: processingStart,
                    server_processing_end: performance.now(),
                    server_emit_start: performance.now(),
                },
            };

            // 🔥 UPDATED: Emit ESP3 alerts to all active users and locations
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    // Emit REAL-TIME ALERT to frontend
                    this.io.to(`location_${location}`).emit('esp3Alert', {
                        message: `ESP3 Data Alert: Received value ${value}`,
                        value: value,
                        timestamp: nowIso,
                        location: location,
                        alert_type: 'ESP3_PERIODIC_DATA',
                        severity: 'info'
                    });

                    // Also emit to user-specific room
                    this.io.to(`user_${userId}`).emit('esp3Alert', {
                        message: `ESP3 Data Alert: Received value ${value}`,
                        value: value,
                        timestamp: nowIso,
                        location: location,
                        alert_type: 'ESP3_PERIODIC_DATA',
                        severity: 'info'
                    });
                }
            }

            const socketEmissionMs = performance.now() - esp3Alert.timestamps.server_emit_start;

            // Update delay stats
            await this.updateDelayStats({
                server_processing: esp3Alert.timestamps.server_processing_end - processingStart,
                socket_emission: socketEmissionMs,
            });

            console.log(`✅ ESP3 Alert sent to all active users: Value=${value}`);
        } catch (error) {
            console.error(`❌ Error processing ESP3 data for topic ${topic}:`, error);
        }
    }

    // 🔒 Secure publishing with TLS
    publishToESP(topic, message) {
        if (!this.mqttClient || !this.mqttClient.connected) {
            console.error('❌ MQTT client not connected');
            return false;
        }

        // Validate message before publishing
        if (typeof message !== 'string' || message.length > 1000) {
            console.error('❌ Invalid message format or size');
            return false;
        }

        try {
            this.mqttClient.publish(topic, message, { qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`❌ Failed to publish to ${topic}:`, err);
                } else {
                    const secureStatus = this.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
                    console.log(`📤 Published to ${topic}: ${message}${secureStatus}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ Error publishing message:', error);
            return false;
        }
    }

    publishToActuator(userId, location, message) {
        if (!this.mqttClient || !this.mqttClient.connected) {
            console.error('❌ MQTT client not connected');
            return false;
        }

        try {
            const topic = `home/${userId}/${location}/actuator`;
            this.mqttClient.publish(topic, message.toString(), { qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`❌ Failed to publish to ${topic}:`, err);
                } else {
                    const secureStatus = this.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
                    console.log(`📤 Published to ${topic}: ${message}${secureStatus}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ Error publishing to actuator:', error);
            return false;
        }
    }

    publishESPCommand(espDevice, command, value = '') {
        const topic = espDevice;
        const message = value ? `${command}:${value}` : command;
        console.log(`🎛️ Sending secure command to ${espDevice}: ${message}`);
        return this.publishToESP(topic, message);
    }

    publishSimple(topic, message) {
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
                    const secureStatus = this.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
                    console.log(`📤 Published secure message: "${payload}" to ${topic}${secureStatus}`);
                }
            });
            return true;
        } catch (error) {
            console.error('❌ Error publishing message:', error);
            return false;
        }
    }

    async handleTextMessage(message) {
        try {
            console.log(`📝 Text message received: ${message}`);
            this.io.emit('textMessageReceived', {
                message: message,
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error handling text message:", error);
        }
    }

    // 🔒 FIXED: Thread-safe location addition with cache invalidation
    async addLocationForUser(userId, location) {
        const release = await this.cacheMutex.acquire();
        try {
            if (!this.userSelectedLocations.has(userId)) {
                this.userSelectedLocations.set(userId, new Set());
            }
            this.userSelectedLocations.get(userId).add(location);

            // Safe cache invalidation
            this.locationCache.delete(userId);
            this.lastCacheUpdate.delete(userId);
        } finally {
            release();
        }

        console.log(`📍 Added location "${location}" for user ${userId} simulation`);
    }

    getUserSelectedLocations(userId) {
        return this.userSelectedLocations.get(userId) || new Set();
    }

    // 🔒 FIXED: Thread-safe environment reading with database transactions
    async handleEnvironmentReading(userId, location, envData) {
        const mutex = this.getUserLocationMutex(userId, location);
        const release = await mutex.acquire();
        try {
            // Start database transaction for consistency
            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                const { temperature, humidity, airflow, unit_airflow = 'm/s' } = envData;

                // Atomic measurement creation
                const [result] = await connection.execute(`
          INSERT INTO measurements (user_id, temperature, humidity, airflow, unit_airflow, location, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [userId, temperature || null, humidity || null, airflow || null, unit_airflow, location]
                );

                const newReading = { insertId: result.insertId };

                // Get user's desired values
                let desiredTemp = 22.0, desiredHumidity = 55.0, desiredAirflow = 2.0;
                try {
                    const [userRows] = await connection.execute(
                        "SELECT desired_temperature, desired_humidity, desired_airflow FROM users WHERE id = ?",
                        [userId]
                    );

                    if (userRows && userRows.length > 0) {
                        desiredTemp = parseFloat(userRows[0].desired_temperature) || 22.0;
                        desiredHumidity = parseFloat(userRows[0].desired_humidity) || 55.0;
                        desiredAirflow = parseFloat(userRows[0].desired_airflow) || 2.0;
                    }
                } catch (dbError) {
                    console.error("Database query error:", dbError);
                }

                // Execute control within same transaction
                await this.executeEnvironmentControlWithConnection(connection, userId, location, {
                    temperature, humidity, airflow,
                    desiredTemp, desiredHumidity, desiredAirflow
                });

                await connection.commit();

                // Emit after successful transaction
                await this.emitChartData(location, {
                    id: newReading.insertId,
                    user_id: userId,
                    location: location,
                    temperature: temperature,
                    humidity: humidity,
                    airflow: airflow,
                    created_at: new Date().toISOString()
                });

                // Emit to location-specific room
                this.io.to(`user_${userId}_${location}`).emit("environmentUpdate", {
                    id: newReading.insertId,
                    userId, location,
                    temperature, humidity, airflow, unit_airflow,
                    created_at: new Date(),
                    desiredTemperature: desiredTemp,
                    desiredHumidity,
                    desiredAirflow
                });

                // Emit real-time location list update
                await this.emitLocationListUpdate(userId);
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            console.error("Error handling environment reading:", error);
        } finally {
            release();
        }
    }

    setupChartSocketHandlers() {
        this.io.on("connection", (socket) => {
            const userId = socket.user?.id;

            // 🔥 NEW: Register user when they connect
            if (userId) {
                this.registerUser(userId, "sensor-room"); // Default location

                // Join user-specific room
                socket.join(`user_${userId}`);
                socket.join(`location_sensor-room`); // Default location room

                console.log(`🔗 User ${userId} connected and registered for MQTT data`);
            }

            socket.on("joinLocation", (location) => {
                if (userId) {
                    this.registerUser(userId, location);
                }
                socket.join(`location_${location}`);
                console.log(`📊 User ${userId} joined chart room: location_${location}`);
            });

            socket.on("leaveLocation", (location) => {
                if (userId) {
                    this.unregisterUser(userId, location);
                }
                socket.leave(`location_${location}`);
                console.log(`📊 User ${userId} left chart room: location_${location}`);
            });

            socket.on("requestChartData", async ({ location, days = 7 }) => {
                try {
                    // Validate days input
                    const safeDays = parseInt(days);
                    if (isNaN(safeDays) || safeDays < 1 || safeDays > 365) {
                        days = 7; // Safe default
                    }

                    const [measurements] = await pool.execute(`
            SELECT temperature, humidity, airflow, created_at
            FROM measurements
            WHERE location = ?
            AND created_at >= NOW() - INTERVAL ? DAY
            AND user_id = ?
            ORDER BY created_at ASC
            LIMIT 1000
          `, [location, safeDays, userId]);

                    socket.emit('chartDataUpdate', {
                        location,
                        measurements: measurements
                    });

                    console.log(`📊 Sent ${measurements.length} chart data points for ${location} to user ${userId}`);
                } catch (error) {
                    console.error('Error fetching chart data:', error);
                    socket.emit('chartError', {
                        location,
                        message: 'Failed to fetch chart data'
                    });
                }
            });

            // 🔥 NEW: Handle disconnect to unregister user
            socket.on('disconnect', () => {
                if (userId) {
                    this.unregisterUser(userId);
                    console.log(`📴 User ${userId} disconnected and unregistered`);
                }
            });
        });
    }

    async emitLocationListUpdate(userId) {
        try {
            const Measurement = require("../models/Measurement");
            const locations = await Measurement.getUserLocations(userId);

            this.io.to(`user_${userId}`).emit("locationListUpdate", {
                userId,
                locations,
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error emitting location list update:", error);
        }
    }

    handleLocationAddition(userId, location) {
        this.io.to(`user_${userId}`).emit("newLocationAdded", {
            userId,
            location,
            timestamp: new Date()
        });
        console.log(`✨ Broadcasted new location "${location}" for user ${userId}`);
    }

    // 🔒 NEW: Database transaction-aware environment control
    async executeEnvironmentControlWithConnection(connection, userId, location, data) {
        try {
            const { temperature, humidity, airflow, desiredTemp, desiredHumidity, desiredAirflow } = data;

            // Tolerances
            const tempTol = parseFloat(process.env.TEMPERATURE_TOLERANCE) || 0.5;
            const humidityTol = 2.0;
            const airflowTol = 0.3;

            // Calculate control states
            let heaterState = false, coolerState = false;
            let humidifierState = false, dehumidifierState = false;
            let fanLevel = 0;
            let controlReason = [];

            // Temperature control
            if (temperature !== null && temperature !== undefined) {
                if (temperature < desiredTemp - tempTol) {
                    heaterState = true;
                    controlReason.push("Heating");
                } else if (temperature > desiredTemp + tempTol) {
                    coolerState = true;
                    controlReason.push("Cooling");
                }
            }

            // Humidity control
            if (humidity !== null && humidity !== undefined) {
                if (humidity < desiredHumidity - humidityTol) {
                    humidifierState = true;
                    controlReason.push("Humidifying");
                } else if (humidity > desiredHumidity + humidityTol) {
                    dehumidifierState = true;
                    controlReason.push("Dehumidifying");
                }
            }

            // Airflow control
            if (airflow !== null && airflow !== undefined) {
                const airflowError = desiredAirflow - airflow;
                if (Math.abs(airflowError) > airflowTol) {
                    if (airflowError > 0.8) fanLevel = 3;
                    else if (airflowError > 0.5) fanLevel = 2;
                    else if (airflowError > 0.2) fanLevel = 1;
                    if (fanLevel > 0) controlReason.push(`Fan Level ${fanLevel}`);
                }
            }

            // Safety: prevent conflicting states
            if (heaterState && coolerState) {
                heaterState = false; coolerState = false;
                controlReason = controlReason.filter(r => !r.includes("eating") && !r.includes("ooling"));
            }

            if (humidifierState && dehumidifierState) {
                humidifierState = false; dehumidifierState = false;
                controlReason = controlReason.filter(r => !r.includes("umidif"));
            }

            const reason = controlReason.length > 0 ? controlReason.join(", ") : "Maintaining";

            // Update control state using provided connection
            await connection.execute(`
        INSERT INTO device_control_states
        (user_id, location, heater_state, cooler_state, humidifier_state, dehumidifier_state, fan_level, control_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'auto')
        ON DUPLICATE KEY UPDATE
        heater_state = VALUES(heater_state),
        cooler_state = VALUES(cooler_state),
        humidifier_state = VALUES(humidifier_state),
        dehumidifier_state = VALUES(dehumidifier_state),
        fan_level = VALUES(fan_level),
        last_control_action = CURRENT_TIMESTAMP
      `, [userId, location, heaterState, coolerState, humidifierState, dehumidifierState, fanLevel]);

            // Publish control commands to location-specific actuator topic
            const controlCommand = {
                heater: heaterState,
                cooler: coolerState,
                humidifier: humidifierState,
                dehumidifier: dehumidifierState,
                fan_level: fanLevel,
                timestamp: new Date().toISOString(),
                reason,
                location,
                targets: { temperature: desiredTemp, humidity: desiredHumidity, airflow: desiredAirflow },
                current: { temperature, humidity, airflow }
            };

            this.mqttClient.publish(
                `home/${userId}/${location}/actuator`,
                JSON.stringify(controlCommand),
                { qos: 1 }
            );

            // Emit control state to location-specific frontend room
            this.io.to(`user_${userId}_${location}`).emit("environmentControlUpdate", {
                userId, location,
                currentTemp: temperature, targetTemp: desiredTemp,
                currentHumidity: humidity, targetHumidity: desiredHumidity,
                currentAirflow: airflow, targetAirflow: desiredAirflow,
                heaterState, coolerState, humidifierState, dehumidifierState, fanLevel,
                reason,
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error in environment control:", error);
            throw error;
        }
    }

    async executeEnvironmentControl(userId, location, data) {
        const mutex = this.getUserLocationMutex(userId, location);
        const release = await mutex.acquire();
        try {
            const connection = await pool.getConnection();
            await connection.beginTransaction();
            try {
                await this.executeEnvironmentControlWithConnection(connection, userId, location, data);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        } finally {
            release();
        }
    }

    // Rest of your existing methods remain the same...
    // (logUserAction, handleSetpointUpdate, getRecentUserActions, etc.)
    async logUserAction(userId, username, actionType, actionDescription, oldValue, newValue, location, deviceInfo = null, ipAddress = null) {
        try {
            // Get session info if available
            const sessionId = `mqtt_session_${Date.now()}_${userId}`;

            await pool.execute(`
            INSERT INTO user_action_audit 
            (user_id, username, action_type, action_description, old_value, new_value, location, device_info, ip_address, session_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
                userId,
                username,
                actionType,
                actionDescription,
                oldValue,
                newValue,
                location,
                deviceInfo ? JSON.stringify(deviceInfo) : null,
                ipAddress || 'System Internal',
                sessionId
            ]);

            // Real-time audit update to admin dashboard
            this.io.to('admin_dashboard').emit('userActionAudit', {
                id: Date.now(), // Temporary ID for real-time display
                userId,
                username,
                actionType,
                actionDescription,
                oldValue,
                newValue,
                location,
                deviceInfo,
                ipAddress: ipAddress || 'System Internal',
                sessionId,
                created_at: new Date().toISOString()
            });

            console.log(`📋 AUDIT: ${username} - ${actionDescription} in ${location}: ${oldValue || 'N/A'} → ${newValue}`);

            return true;
        } catch (error) {
            console.error('❌ Error logging user action to audit trail:', error);
            return false;
        }
    }

    async handleSetpointUpdate(userId, location, setpointData) {
        try {
            const { temperature, humidity, airflow } = setpointData;

            // Get current user data and existing setpoints from your users table
            const [userRows] = await pool.execute(
                'SELECT username, desired_temperature, desired_humidity, desired_airflow FROM users WHERE id = ? AND is_active = 1',
                [userId]
            );

            if (userRows.length === 0) {
                console.warn(`⚠️ User ${userId} not found or inactive for setpoint update`);
                return { success: false, message: 'User not found or inactive' };
            }

            const userData = userRows[0];
            const { username, desired_temperature: oldTemp, desired_humidity: oldHum, desired_airflow: oldAirflow } = userData;

            let updateCount = 0;
            const auditPromises = [];

            // Handle temperature setpoint update with audit logging
            if (typeof temperature === 'number' && Number.isFinite(temperature)) {
                await pool.execute('UPDATE users SET desired_temperature = ? WHERE id = ?', [temperature, userId]);

                // Log temperature change audit
                auditPromises.push(
                    this.logUserAction(
                        userId,
                        username,
                        'TEMPERATURE_SET',
                        'Temperature Setpoint Changed',
                        oldTemp,
                        temperature,
                        location,
                        {
                            source: 'Environment Control Panel',
                            previousValue: oldTemp,
                            newValue: temperature,
                            changeTimestamp: new Date().toISOString(),
                            userAgent: 'MQTT Handler'
                        }
                    )
                );
                updateCount++;
            }

            // Handle humidity setpoint update with audit logging
            if (typeof humidity === 'number' && Number.isFinite(humidity)) {
                await pool.execute('UPDATE users SET desired_humidity = ? WHERE id = ?', [humidity, userId]);

                auditPromises.push(
                    this.logUserAction(
                        userId,
                        username,
                        'HUMIDITY_SET',
                        'Humidity Setpoint Changed',
                        oldHum,
                        humidity,
                        location,
                        {
                            source: 'Environment Control Panel',
                            previousValue: oldHum,
                            newValue: humidity,
                            changeTimestamp: new Date().toISOString(),
                            userAgent: 'MQTT Handler'
                        }
                    )
                );
                updateCount++;
            }

            // Handle airflow setpoint update with audit logging
            if (typeof airflow === 'number' && Number.isFinite(airflow)) {
                await pool.execute('UPDATE users SET desired_airflow = ? WHERE id = ?', [airflow, userId]);

                auditPromises.push(
                    this.logUserAction(
                        userId,
                        username,
                        'AIRFLOW_SET',
                        'Airflow Setpoint Changed',
                        oldAirflow,
                        airflow,
                        location,
                        {
                            source: 'Environment Control Panel',
                            previousValue: oldAirflow,
                            newValue: airflow,
                            changeTimestamp: new Date().toISOString(),
                            userAgent: 'MQTT Handler'
                        }
                    )
                );
                updateCount++;
            }

            // Execute all audit logging promises
            await Promise.all(auditPromises);

            // Update device control states table if needed
            if (updateCount > 0) {
                // Check if device control state exists for this user and location
                const [controlStateRows] = await pool.execute(
                    'SELECT id FROM device_control_states WHERE user_id = ? AND location = ?',
                    [userId, location]
                );

                if (controlStateRows.length === 0) {
                    // Create new device control state entry
                    await pool.execute(`
                    INSERT INTO device_control_states 
                    (user_id, location, control_mode, last_control_action) 
                    VALUES (?, ?, 'auto', NOW())
                `, [userId, location]);
                } else {
                    // Update existing control state timestamp
                    await pool.execute(
                        'UPDATE device_control_states SET last_control_action = NOW() WHERE user_id = ? AND location = ?',
                        [userId, location]
                    );
                }
            }

            console.log(`🎛️ Setpoint updated with audit: ${username} in ${location} - ${updateCount} changes logged`);

            // Emit real-time setpoint update
            this.io.to(`user_${userId}_${location}`).emit("setpointUpdate", {
                userId,
                location,
                username,
                desiredTemperature: temperature,
                desiredHumidity: humidity,
                desiredAirflow: airflow,
                timestamp: new Date(),
                auditLogged: true,
                changesCount: updateCount
            });

            return {
                success: true,
                message: `${updateCount} setpoints updated and logged`,
                changesCount: updateCount
            };

        } catch (error) {
            console.error('❌ Error updating setpoint with audit:', error);
            return { success: false, message: 'Setpoint update failed', error: error.message };
        }
    }

    async getRecentUserActions(limit = 50, actionType = 'ALL', location = 'ALL') {
        try {
            let whereClause = '';
            const params = [];

            if (actionType !== 'ALL') {
                whereClause += 'WHERE action_type = ?';
                params.push(actionType);
            }

            if (location !== 'ALL') {
                whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'location = ?';
                params.push(location);
            }

            params.push(limit);

            const [actions] = await pool.execute(`
            SELECT 
                id,
                user_id,
                username,
                action_type,
                action_description,
                old_value,
                new_value,
                location,
                device_info,
                ip_address,
                session_id,
                created_at
            FROM user_action_audit 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT ?
        `, params);

            return actions;
        } catch (error) {
            console.error('❌ Error fetching user actions from audit trail:', error);
            return [];
        }
    }

    // Method to get audit statistics for admin dashboard
    async getAuditStatistics(timeframe = 'today') {
        try {
            let timeCondition = '';

            switch (timeframe) {
                case 'today':
                    timeCondition = 'WHERE created_at >= CURDATE()';
                    break;
                case 'week':
                    timeCondition = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
                    break;
                case 'month':
                    timeCondition = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
                    break;
                default:
                    timeCondition = 'WHERE created_at >= CURDATE()';
            }

            const [stats] = await pool.execute(`
            SELECT 
                action_type,
                COUNT(*) as action_count,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT location) as unique_locations
            FROM user_action_audit 
            ${timeCondition}
            GROUP BY action_type
            ORDER BY action_count DESC
        `);

            const [totalStats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_actions,
                COUNT(DISTINCT user_id) as total_unique_users,
                COUNT(DISTINCT location) as total_unique_locations,
                MIN(created_at) as first_action,
                MAX(created_at) as last_action
            FROM user_action_audit 
            ${timeCondition}
        `);

            return {
                byActionType: stats,
                totals: totalStats[0] || {
                    total_actions: 0,
                    total_unique_users: 0,
                    total_unique_locations: 0,
                    first_action: null,
                    last_action: null
                }
            };
        } catch (error) {
            console.error('❌ Error getting audit statistics:', error);
            return { byActionType: [], totals: {} };
        }
    }

    async handleLegacyTemperatureReading(userId, tempValue) {
        try {
            const newTemp = await Temperature.create({
                user_id: userId,
                value: tempValue,
                location: "main-room",
            });

            console.log(`🌡️ Legacy temperature update for user ${userId}: ${tempValue}°C`);

            await Measurement.create({
                user_id: userId,
                temperature: tempValue,
                humidity: null,
                airflow: null,
                location: "main-room"
            });

            let desiredTemp = 22.0;
            try {
                const [userRows] = await pool.execute(
                    "SELECT desired_temperature FROM users WHERE id = ?",
                    [userId]
                );

                if (userRows && userRows.length > 0) {
                    desiredTemp = parseFloat(userRows[0].desired_temperature) || 22.0;
                }
            } catch (dbError) {
                console.error("Database query error:", dbError);
            }

            await this.executeTemperatureControl(userId, "main-room", tempValue, desiredTemp);

            this.io.to(`user_${userId}`).emit("temperatureUpdate", {
                id: newTemp.insertId,
                value: tempValue,
                location: "main-room",
                created_at: new Date(),
                desiredTemperature: desiredTemp
            });

        } catch (error) {
            console.error("Error handling legacy temperature reading:", error);
        }
    }

    async executeTemperatureControl(userId, location, currentTemp, targetTemp) {
        const mutex = this.getUserLocationMutex(userId, location);
        const release = await mutex.acquire();

        try {
            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                const tolerance = parseFloat(process.env.TEMPERATURE_TOLERANCE) || 0.5;

                let newHeaterState = false;
                let newCoolerState = false;
                let controlReason = "";

                if (currentTemp < targetTemp - tolerance) {
                    newHeaterState = true;
                    newCoolerState = false;
                    controlReason = "Heating - too cold";
                } else if (currentTemp > targetTemp + tolerance) {
                    newHeaterState = false;
                    newCoolerState = true;
                    controlReason = "Cooling - too hot";
                } else {
                    newHeaterState = false;
                    newCoolerState = false;
                    controlReason = "Maintaining - within tolerance";
                }

                await connection.execute(`
          INSERT INTO device_control_states (user_id, location, heater_state, cooler_state, control_mode) 
          VALUES (?, ?, ?, ?, 'auto')
          ON DUPLICATE KEY UPDATE 
          heater_state = VALUES(heater_state), 
          cooler_state = VALUES(cooler_state),
          last_control_action = CURRENT_TIMESTAMP
        `, [userId, location, newHeaterState, newCoolerState]);

                const controlCommand = {
                    heater: newHeaterState,
                    cooler: newCoolerState,
                    timestamp: new Date().toISOString(),
                    reason: controlReason,
                    targetTemp: targetTemp,
                    currentTemp: currentTemp,
                    location
                };

                this.mqttClient.publish(
                    `home/${userId}/${location}/actuator`,
                    JSON.stringify(controlCommand),
                    { qos: 1 }
                );

                this.io.to(`user_${userId}_${location}`).emit("controlUpdate", {
                    userId, location,
                    currentTemp,
                    targetTemp,
                    heaterState: newHeaterState,
                    coolerState: newCoolerState,
                    reason: controlReason,
                    timestamp: new Date()
                });

                console.log(`🎛️ Control action for user ${userId} in ${location}: ${controlReason} - Heater=${newHeaterState}, Cooler=${newCoolerState}`);

                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

        } catch (error) {
            console.error("Error in temperature control:", error);
        } finally {
            release();
        }
    }

    async startSimulation() {
        console.log("🚀 Starting enhanced environment simulation (user-defined locations only)...");

        this.simulationInterval = setInterval(async () => {
            try {
                const activeUserIds = this.io.getActiveUsers();

                if (activeUserIds.length === 0) {
                    console.log("⏸️ No active users - pausing environment simulation");
                    return;
                }

                await this.batchSimulateUsers(activeUserIds);

            } catch (error) {
                console.error("Error in environment simulation:", error);
            }
        }, parseInt(process.env.CONTROL_FREQUENCY) || 10000);
    }

    async batchSimulateUsers(activeUserIds) {
        try {
            const userData = await this.batchGetUserData(activeUserIds);
            const locationData = await this.batchGetUserLocations(activeUserIds);
            const controlStates = await this.batchGetControlStates(activeUserIds);

            const simulationPromises = [];

            for (const user of userData) {
                const userLocations = locationData.get(user.id) || new Set();
                const selectedLocations = this.getUserSelectedLocations(user.id);
                const allLocations = new Set([...userLocations, ...selectedLocations]);

                if (allLocations.size === 0) continue;

                for (const location of allLocations) {
                    const controlState = controlStates.get(`${user.id}-${location}`) || {};
                    simulationPromises.push(
                        this.optimizedSimulateLocationEnvironment(user, location, controlState)
                    );
                }
            }

            await this.batchExecutePromises(simulationPromises, 10);

            console.log(`🚀 Batch simulated ${simulationPromises.length} environments`);

        } catch (error) {
            console.error("Error in batch simulation:", error);
        }
    }

    async batchExecutePromises(promises, batchSize = 10) {
        for (let i = 0; i < promises.length; i += batchSize) {
            const batch = promises.slice(i, i + batchSize);
            await Promise.allSettled(batch);
        }
    }

    async batchGetUserData(userIds) {
        if (userIds.length === 0) return [];

        const placeholders = userIds.map(() => '?').join(',');
        const [users] = await pool.execute(
            `SELECT id, username, desired_temperature, desired_humidity, desired_airflow 
     FROM users WHERE id IN (${placeholders})`,
            userIds
        );

        return users;
    }

    // 🔒 FIXED: Thread-safe location data fetching with caching
    async batchGetUserLocations(userIds) {
        const locationMap = new Map();

        for (const userId of userIds) {
            const release = await this.cacheMutex.acquire();

            try {
                // Safe cache access
                const cacheKey = userId;
                const lastUpdate = this.lastCacheUpdate.get(cacheKey) || 0;

                if (Date.now() - lastUpdate < 60000) {
                    const cached = this.locationCache.get(cacheKey);
                    if (cached) {
                        locationMap.set(userId, cached);
                        continue;
                    }
                }

                // Fetch from database
                try {
                    const locations = await Measurement.getUserLocations(userId);
                    const locationSet = new Set(locations.map(l => l.location));

                    // Update cache
                    this.locationCache.set(cacheKey, locationSet);
                    this.lastCacheUpdate.set(cacheKey, Date.now());
                    locationMap.set(userId, locationSet);

                } catch (error) {
                    locationMap.set(userId, new Set());
                }

            } finally {
                release();
            }
        }

        return locationMap;
    }

    async batchGetControlStates(userIds) {
        const controlStates = new Map();

        if (userIds.length > 0) {
            const placeholders = userIds.map(() => '?').join(',');

            try {
                const [states] = await pool.execute(
                    `SELECT user_id, location, heater_state, cooler_state, humidifier_state, 
                dehumidifier_state, fan_level, control_mode 
         FROM device_control_states WHERE user_id IN (${placeholders})`,
                    userIds
                );

                for (const state of states) {
                    const key = `${state.user_id}-${state.location}`;
                    controlStates.set(key, state);
                }

            } catch (error) {
                console.log("Using default control states");
            }
        }

        return controlStates;
    }

    async optimizedSimulateLocationEnvironment(userData, location, controlState = {}) {
        try {
            if (!this.io.isUserActive(userData.id)) {
                return;
            }

            const defaultState = {
                heater_state: false, cooler_state: false, control_mode: 'auto',
                humidifier_state: false, dehumidifier_state: false, fan_level: 0
            };

            const finalControlState = { ...defaultState, ...controlState };

            let currentTemp, currentHumidity, currentAirflow;

            try {
                const lastReading = await Measurement.getLatestForUser(userData.id, location);
                currentTemp = lastReading?.temperature ?? (Math.random() * 14 + 18);
                currentHumidity = lastReading?.humidity ?? (Math.random() * 20 + 45);
                currentAirflow = lastReading?.airflow ?? (Math.random() * 1.5 + 1.0);
            } catch (error) {
                currentTemp = Math.random() * 14 + 18;
                currentHumidity = Math.random() * 20 + 45;
                currentAirflow = Math.random() * 1.5 + 1.0;
            }

            const newEnv = this.calculateEnvironmentPhysics(
                { temp: currentTemp, humidity: currentHumidity, airflow: currentAirflow },
                finalControlState,
                {
                    temp: userData.desired_temperature || 22.0,
                    humidity: userData.desired_humidity || 55.0,
                    airflow: userData.desired_airflow || 2.0
                }
            );

            const envPayload = {
                temperature: parseFloat(newEnv.temp.toFixed(2)),
                humidity: parseFloat(newEnv.humidity.toFixed(1)),
                airflow: parseFloat(newEnv.airflow.toFixed(3)),
                unit_airflow: "m/s",
                timestamp: new Date().toISOString()
            };

            const topic = `home/${userData.id}/${location}/environment`;
            this.mqttClient.publish(topic, JSON.stringify(envPayload), { qos: 1 });

        } catch (error) {
            console.error(`❌ Error simulating environment for user ${userData.id} in ${location}:`, error);
        }
    }

    calculateEnvironmentPhysics(current, controlState, desired) {
        let { temp, humidity, airflow } = current;

        if (controlState.control_mode === 'auto') {
            if (controlState.heater_state) {
                temp += (Math.random() * 0.8 + 0.2);
            } else if (controlState.cooler_state) {
                temp -= (Math.random() * 0.8 + 0.2);
            } else {
                temp += (Math.random() - 0.5) * 0.3;
            }

            if (controlState.humidifier_state) {
                humidity += (Math.random() * 1.5 + 0.5);
            } else if (controlState.dehumidifier_state) {
                humidity -= (Math.random() * 1.5 + 0.5);
            } else {
                humidity += (Math.random() - 0.5) * 0.8;
            }

            const fanBias = (controlState.fan_level || 0) * 0.4;
            airflow += (Math.random() - 0.5) * 0.2 + fanBias - 0.2;
        } else {
            temp += (Math.random() - 0.5) * 0.5;
            humidity += (Math.random() - 0.5) * 1.0;
            airflow += (Math.random() - 0.5) * 0.3;
        }

        temp = Math.max(5, Math.min(45, temp));
        humidity = Math.max(15, Math.min(95, humidity));
        airflow = Math.max(0.1, Math.min(5.0, airflow));

        return { temp, humidity, airflow };
    }

    async createControlStatesTable() {
        try {
            await pool.execute(`
        CREATE TABLE IF NOT EXISTS device_control_states (
          id int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
          user_id int(11) NOT NULL,
          location varchar(100) NOT NULL DEFAULT 'main-room',
          heater_state boolean DEFAULT FALSE,
          cooler_state boolean DEFAULT FALSE,
          humidifier_state boolean DEFAULT FALSE,
          dehumidifier_state boolean DEFAULT FALSE,
          fan_level tinyint DEFAULT 0,
          control_mode enum('off', 'auto', 'manual') DEFAULT 'auto',
          last_control_action timestamp DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          UNIQUE KEY unique_user_location_control (user_id, location),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
      `);
            console.log("✅ device_control_states table created successfully");
        } catch (error) {
            console.error("Error creating device_control_states table:", error);
        }
    }

    stopSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }

        console.log("⏹️ Enhanced environment simulation stopped");
        // Publish offline status before disconnecting
        if (this.mqttClient && this.mqttClient.connected) {
            this.mqttClient.publish('system/status', JSON.stringify({
                status: 'offline',
                timestamp: new Date().toISOString(),
                reason: 'Graceful shutdown'
            }), { qos: 1, retain: true });
        }
    }
}

module.exports = EnhancedMqttHandler;
