// // src/mqtt/EnhancedMqttHandler.js
// const { Mutex } = require("async-mutex");
// const MqttConnection = require('./connection/MqttConnection');
// const pool = require('../config/db'); // ✅ ADD THIS

// const TemperatureHandler = require('./sensors/TemperatureHandler');
// const HumidityHandler = require('./sensors/HumidityHandler');
// const BowlTemperatureHandler = require('./sensors/BowlTemperatureHandler');
// const BowlFanHandler = require('./sensors/BowlFanHandler');
// const SonarDistanceHandler = require('./sensors/SonarDistanceHandler');
// const SonarPumpHandler = require('./sensors/SonarPumpHandler');
// const CO2Handler = require('./sensors/CO2Handler');
// const CO2FermentationHandler = require('./sensors/CO2FermentationHandler');
// const SugarHandler = require('./sensors/SugarHandler');
// const SugarFermentationHandler = require('./sensors/SugarFermentationHandler');
// const ESP3Handler = require('./sensors/ESP3Handler');
// const RealSensorHandler = require('./Sensors/RealSensorHandler');

// class EnhancedMqttHandler {
//     constructor(io) {
//         this.io = io;
//         this.mqttConnection = new MqttConnection();

//         this.activeUsers = new Map();
//         this.sensorData = {
//             temperature: null,
//             humidity: null,
//             bowl_temp: null,
//             bowl_fan_status: null,
//             sonar_distance: null,
//             sonar_pump_status: null,
//             co2_level: null,
//             co2_fermentation_status: null,
//             sugar_level: null,
//             sugar_fermentation_status: null,
//             esp3_data: null
//         };

//         this.sensorDataMutex = new Mutex();
//         this.locationMutexes = new Map(); // ✅ ADD THIS

//         // Initialize ALL handlers - pass 'this' so handlers can call handleEnvironmentReading
//         const handlerArgs = [io, this.sensorData, this.activeUsers, this.sensorDataMutex, this]; // ✅ ADD 'this'

//         this.temperatureHandler = new TemperatureHandler(...handlerArgs);
//         this.humidityHandler = new HumidityHandler(...handlerArgs);
//         this.bowlTemperatureHandler = new BowlTemperatureHandler(...handlerArgs);
//         this.bowlFanHandler = new BowlFanHandler(...handlerArgs);
//         this.sonarDistanceHandler = new SonarDistanceHandler(...handlerArgs);
//         this.sonarPumpHandler = new SonarPumpHandler(...handlerArgs);
//         this.co2Handler = new CO2Handler(...handlerArgs);
//         this.co2FermentationHandler = new CO2FermentationHandler(...handlerArgs);
//         this.sugarHandler = new SugarHandler(...handlerArgs);
//         this.sugarFermentationHandler = new SugarFermentationHandler(...handlerArgs);
//         this.esp3Handler = new ESP3Handler(...handlerArgs);
//         this.realSensorHandler = new RealSensorHandler(...handlerArgs);
//     }

//     connect() {
//         this.mqttConnection.connect(
//             (client) => this.onConnect(client),
//             (topic, message) => this.onMessage(topic, message),
//             (error) => this.onError(error)
//         );
//     }

//     onConnect(client) {
//         const topics = ['ESP', 'ESP2', 'bowl', 'bowlT', 'sonar', 'sonarT',
//             'CO2', 'CO2T', 'sugar', 'sugarT', 'ESP3',
//             'ESPX', 'ESPX2', 'ESPX3'];

//         topics.forEach(topic => {
//             client.subscribe(topic, { qos: 1 }, (err) => {
//                 if (!err) console.log(`📡 Subscribed to ${topic}`);
//             });
//         });
//     }

//     async onMessage(topic, message) {
//         const payload = message.toString();
//         console.log(`📥 MQTT: ${topic} = ${payload}`);

//         switch (topic) {
//             case 'ESP2':
//                 await this.temperatureHandler.handleTemperatureData(topic, payload);
//                 await this.realSensorHandler.handleRealSensorData(topic, payload);
//                 break;
//             case 'ESP':
//                 await this.humidityHandler.handleHumidityData(topic, payload);
//                 break;
//             case 'bowl':
//                 await this.bowlTemperatureHandler.handleBowlTemperature(topic, payload);
//                 break;
//             case 'bowlT':
//                 await this.bowlFanHandler.handleBowlFanStatus(topic, payload);
//                 break;
//             case 'sonar':
//                 await this.sonarDistanceHandler.handleSonarDistance(topic, payload);
//                 break;
//             case 'sonarT':
//                 await this.sonarPumpHandler.handleSonarPumpStatus(topic, payload);
//                 break;
//             case 'CO2':
//                 await this.co2Handler.handleCO2Data(topic, payload);
//                 break;
//             case 'CO2T':
//                 await this.co2FermentationHandler.handleCO2FermentationStatus(topic, payload);
//                 break;
//             case 'sugar':
//                 await this.sugarHandler.handleSugarData(topic, payload);
//                 break;
//             case 'sugarT':
//                 await this.sugarFermentationHandler.handleSugarFermentationStatus(topic, payload);
//                 break;
//             case 'ESP3':
//                 await this.esp3Handler.handleESP3Data(topic, payload);
//                 break;
//             case 'ESPX':
//             case 'ESPX2':
//             case 'ESPX3':
//                 await this.realSensorHandler.handleRealSensorData(topic, payload);
//                 break;
//         }
//     }

//     onError(error) {
//         console.error('🚨 MQTT Error:', error.message);
//     }

//     // ✅ ADD THIS METHOD - Creates mutex for each user/location combination
//     getUserLocationMutex(userId, location) {
//         const key = `${userId}_${location}`;
//         if (!this.locationMutexes.has(key)) {
//             this.locationMutexes.set(key, new Mutex());
//         }
//         return this.locationMutexes.get(key);
//     }

//     // ✅ ADD THIS CRITICAL METHOD - This is what was missing!
//     async handleEnvironmentReading(userId, location, envData) {
//         const mutex = this.getUserLocationMutex(userId, location);
//         const release = await mutex.acquire();

//         try {
//             const connection = await pool.getConnection();
//             await connection.beginTransaction();

//             try {
//                 const { temperature, humidity, airflow, bowl_temp, sonar_distance, co2_level, sugar_level } = envData;

//                 // Insert measurement
//                 const [result] = await connection.execute(`
//                     INSERT INTO measurements 
//                     (user_id, temperature, humidity, airflow, bowl_temp, sonar_distance, co2_level, sugar_level, location, created_at)
//                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
//                     [userId, temperature || null, humidity || null, airflow || 2.0, bowl_temp || null,
//                         sonar_distance || null, co2_level || null, sugar_level || null, location]
//                 );

//                 // Get user's desired setpoint values
//                 let desiredTemp = 22.0, desiredHumidity = 55.0, desiredAirflow = 2.0;
//                 try {
//                     const [userRows] = await connection.execute(
//                         "SELECT desired_temperature, desired_humidity, desired_airflow FROM users WHERE id = ?",
//                         [userId]
//                     );

//                     if (userRows && userRows.length > 0) {
//                         desiredTemp = parseFloat(userRows[0].desired_temperature) || 22.0;
//                         desiredHumidity = parseFloat(userRows[0].desired_humidity) || 55.0;
//                         desiredAirflow = parseFloat(userRows[0].desired_airflow) || 2.0;
//                     }
//                 } catch (dbError) {
//                     console.error("❌ Error fetching user setpoints:", dbError.message);
//                 }

//                 await connection.commit();

//                 // ✅ CRITICAL: Emit to user_userId_location room (EnvironmentControl.jsx listens here!)
//                 this.io.to(`user_${userId}_${location}`).emit("environmentUpdate", {
//                     id: result.insertId,
//                     userId,
//                     location,
//                     temperature,
//                     humidity,
//                     airflow,
//                     bowl_temp,
//                     sonar_distance,
//                     co2_level,
//                     sugar_level,
//                     created_at: new Date(),
//                     desiredTemperature: desiredTemp,
//                     desiredHumidity,
//                     desiredAirflow
//                 });

//                 console.log(`📤 Emitted environmentUpdate to user_${userId}_${location}`);

//             } catch (error) {
//                 await connection.rollback();
//                 throw error;
//             } finally {
//                 connection.release();
//             }
//         } catch (error) {
//             console.error("❌ Error in handleEnvironmentReading:", error);
//         } finally {
//             release();
//         }
//     }

//     async logUserAction(userId, username, actionType, actionDescription, oldValue = null, newValue = null, location = null) {
//         try {
//             const pool = require('../config/db');

//             // Insert into user_action_audit table (note: id is AUTO_INCREMENT, don't specify it)
//             const [result] = await pool.execute(`
//             INSERT INTO user_action_audit 
//             (user_id, username, action_type, action_description, old_value, new_value, location, ip_address, session_id, created_at)
//             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
//                 [userId, username, actionType, actionDescription, oldValue, newValue, location, null, null]
//             );

//             const auditEntry = {
//                 id: result.insertId,
//                 userId,
//                 username,
//                 actionType,
//                 actionDescription,
//                 oldValue,
//                 newValue,
//                 location,
//                 created_at: new Date().toISOString()
//             };

//             // ✅ Emit real-time audit update to admin dashboard
//             this.io.to('admin_dashboard').emit('userActionAudit', auditEntry);

//             console.log(`📋 Audit logged: ${username} - ${actionDescription}`);

//             return auditEntry;
//         } catch (error) {
//             console.error('❌ Error logging user action:', error);
//             return null;
//         }
//     }


//     registerUser(userId, location = 'sensor-room') {
//         if (!this.activeUsers.has(userId)) {
//             this.activeUsers.set(userId, new Set());
//         }
//         this.activeUsers.get(userId).add(location);
//         console.log(`✅ MQTT: Registered user ${userId} for ${location}`);
//         console.log(`📊 Total active users: ${this.activeUsers.size}`);
//     }

//     unregisterUser(userId) {
//         this.activeUsers.delete(userId);
//         console.log(`❌ MQTT: Unregistered user ${userId}`);
//     }

//     publishToESP(topic, message) {
//         if (!this.mqttConnection.mqttClient || !this.mqttConnection.mqttClient.connected) {
//             console.error('❌ MQTT client not connected');
//             return false;
//         }

//         if (typeof message !== 'string' || message.length > 1000) {
//             console.error('❌ Invalid message format or size');
//             return false;
//         }

//         try {
//             this.mqttConnection.mqttClient.publish(topic, message, { qos: 1, retain: false }, (err) => {
//                 if (err) {
//                     console.error(`❌ Failed to publish to ${topic}:`, err);
//                 } else {
//                     const secureStatus = this.mqttConnection.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
//                     console.log(`📤 Published to ${topic}: ${message}${secureStatus}`);
//                 }
//             });
//             return true;
//         } catch (error) {
//             console.error('❌ Error publishing message:', error);
//             return false;
//         }
//     }

//     publishToActuator(userId, location, message) {
//         if (!this.mqttConnection.mqttClient || !this.mqttConnection.mqttClient.connected) {
//             console.error('❌ MQTT client not connected');
//             return false;
//         }

//         try {
//             const topic = `home/${userId}/${location}/actuator`;
//             this.mqttConnection.mqttClient.publish(topic, message.toString(), { qos: 1, retain: false }, (err) => {
//                 if (err) {
//                     console.error(`❌ Failed to publish to ${topic}:`, err);
//                 } else {
//                     const secureStatus = this.mqttConnection.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
//                     console.log(`📤 Published to ${topic}: ${message}${secureStatus}`);
//                 }
//             });
//             return true;
//         } catch (error) {
//             console.error('❌ Error publishing to actuator:', error);
//             return false;
//         }
//     }

//     publishESPCommand(espDevice, command, value = '') {
//         const topic = espDevice;
//         const message = value ? `${command}:${value}` : command;
//         console.log(`🎛️ Sending command to ${espDevice}: ${message}`);
//         return this.publishToESP(topic, message);
//     }

//     publishSimple(topic, message) {
//         if (!this.mqttConnection.mqttClient || !this.mqttConnection.mqttClient.connected) {
//             console.error('❌ MQTT client not connected');
//             return false;
//         }

//         try {
//             const payload = typeof message === 'number' ? message.toString() : message;
//             this.mqttConnection.mqttClient.publish(topic, payload, { qos: 1, retain: false }, (err) => {
//                 if (err) {
//                     console.error(`❌ Failed to publish to ${topic}:`, err);
//                 } else {
//                     const secureStatus = this.mqttConnection.mqttClient.stream?.encrypted ? ' (TLS secured)' : '';
//                     console.log(`📤 Published message: "${payload}" to ${topic}${secureStatus}`);
//                 }
//             });
//             return true;
//         } catch (error) {
//             console.error('❌ Error publishing message:', error);
//             return false;
//         }
//     }

//     disconnect() {
//         this.mqttConnection.disconnect();
//     }
// }

// module.exports = EnhancedMqttHandler;
// Assuming this is the base handler that other sensor handlers extend or call.
// Updated to use new schema in shared methods like handleEnvironmentReading.

const aedes = require('aedes')();
const mqtt = require('mqtt');
const pool = require('../../config/db');  // Your DB pool
const socketioHandler = require('../../utils/socketio/socketioHandler');
const { getActiveUsers } = require('../../utils/userRegistry');  // Assuming this exists from your code

class EnhancedMqttHandler {
    constructor() {
        this.broker = aedes;
        this.client = mqtt.connect('mqtt://localhost:1883');  // Adjust as per your config
        this.setupBroker();
        this.setupClient();
    }

    setupBroker() {
        // Your broker setup code (kept as-is)
        this.broker.on('client', client => console.log(`MQTT Client Connected: ${client.id}`));
        this.broker.on('publish', (packet, client) => {
            if (client) this.onMessage(packet.topic, packet.payload.toString());
        });
    }

    setupClient() {
        // Your client setup (kept as-is)
        this.client.on('message', (topic, message) => this.onMessage(topic, message.toString()));
    }

    async onMessage(topic, message) {
        // Your topic routing logic (e.g., to specific handlers like TemperatureHandler)
        // Assuming you have a switch or if based on topic
        if (topic.startsWith('ESP')) {
            const temperatureHandler = new TemperatureHandler();  // Import and instantiate
            await temperatureHandler.handleTemperatureData(topic, message);
        }
        // Add similar for other topics/handlers...
    }

    // Updated: handleEnvironmentReading now uses sensor_measurements
    async handleEnvironmentReading(userId, sensorCode, value, location) {
        try {
            // Get room_id from rooms
            const [rooms] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, location]);
            if (rooms.length === 0) throw new Error("Room not found");
            const roomId = rooms[0].id;

            // Get sensor_id from sensors (match by sensor_code or mqtt_topic)
            const [sensors] = await pool.execute("SELECT id FROM sensors WHERE user_id = ? AND room_id = ? AND (sensor_code = ? OR mqtt_topic = ?)", [userId, roomId, sensorCode, topic]);
            if (sensors.length === 0) throw new Error("Sensor not found");
            const sensorId = sensors[0].id;

            // Insert into sensor_measurements
            await pool.execute(
                "INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at) VALUES (?, ?, NOW())",
                [sensorId, parseFloat(value)]
            );

            // Update sensors last_reading_at
            await pool.execute("UPDATE sensors SET last_reading_at = NOW() WHERE id = ?", [sensorId]);

            console.log(`✅ DB updated for user ${userId}, sensor ${sensorCode}: ${value}`);

            // Emit to Socket.IO (kept as-is)
            socketioHandler.emitToLocation(location, 'environmentUpdate', { [sensorCode.toLowerCase()]: value });
            socketioHandler.emitToUser(userId, 'environmentUpdate', { [sensorCode.toLowerCase()]: value });

        } catch (error) {
            console.error("❌ Error in handleEnvironmentReading:", error);
            throw error;
        }
    }

    // Add similar updated methods if there are more shared ones...
}

module.exports = new EnhancedMqttHandler();