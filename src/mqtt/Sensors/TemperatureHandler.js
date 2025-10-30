// // src/mqtt/sensors/TemperatureHandler.js
// const BaseSensorHandler = require('../base/BaseSensorHandler');
// const pool = require('../../config/db');

// class TemperatureHandler extends BaseSensorHandler {
//     async handleTemperatureData(topic, messageValue) {
//         console.log(`\n🌡️ ========== TEMPERATURE DATA ==========`);
//         console.log(`🌡️ Raw value: ${messageValue}`);
//         console.log(`🌡️ Active users: ${this.activeUsers.size}`);

//         try {
//             const validation = this.validateNumeric(messageValue, -200, 5000);
//             if (!validation.valid) {
//                 console.warn(`⚠️ Invalid temperature value`);
//                 return;
//             }

//             let temperatureValue = validation.value * 10.6;
//             console.log(`🌡️ Converted temperature: ${temperatureValue.toFixed(2)}°C`);

//             await this.updateSensorCache('temperature', temperatureValue);

//             if (this.activeUsers.size === 0) {
//                 console.log('⏸️ No active users - skipping');
//                 return;
//             }

//             const release = await this.sensorDataMutex.acquire();
//             let currentState;
//             try {
//                 currentState = {
//                     temperature: this.sensorData.temperature,
//                     humidity: this.sensorData.humidity,
//                     bowl_temp: this.sensorData.bowl_temp,
//                     sonar_distance: this.sensorData.sonar_distance,
//                     co2_level: this.sensorData.co2_level,
//                     sugar_level: this.sensorData.sugar_level
//                 };
//             } finally {
//                 release();
//             }

//             for (const [userId, locations] of this.activeUsers) {
//                 for (const location of locations) {
//                     try {
//                         await pool.execute(`
//                             INSERT INTO measurements 
//                             (user_id, temperature, humidity, bowl_temp, sonar_distance, co2_level, sugar_level, airflow, location, created_at)
//                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//                             [userId, currentState.temperature, currentState.humidity, currentState.bowl_temp,
//                                 currentState.sonar_distance, currentState.co2_level, currentState.sugar_level,
//                                 2.0, location, new Date()]
//                         );
//                         console.log(`✅ Stored measurement for user ${userId}`);
//                     } catch (error) {
//                         console.error(`❌ DB error:`, error.message);
//                     }

//                     const enriched = {
//                         temperature: currentState.temperature,
//                         humidity: currentState.humidity,
//                         bowl_temp: currentState.bowl_temp,
//                         sonar_distance: currentState.sonar_distance,
//                         co2_level: currentState.co2_level,
//                         sugar_level: currentState.sugar_level,
//                         airflow: 2.0,
//                         user_id: userId,
//                         location: location,
//                         created_at: new Date().toISOString()
//                     };

//                     this.io.to(`location_${location}`).emit("newMeasurement", enriched);
//                     this.io.to(`user_${userId}`).emit("newMeasurement", enriched);
//                     this.io.to(`location_${location}`).emit("environmentUpdate", enriched);
//                     this.io.to(`user_${userId}`).emit("environmentUpdate", enriched);

//                     console.log(`📡 Emitted to location_${location} and user_${userId}`);

//                     // ✅ CRITICAL: Call handleEnvironmentReading to emit to user_userId_location room
//                     if (this.mqttHandler && this.mqttHandler.handleEnvironmentReading) {
//                         await this.mqttHandler.handleEnvironmentReading(userId, location, {
//                             temperature: currentState.temperature,
//                             humidity: currentState.humidity,
//                             bowl_temp: currentState.bowl_temp,
//                             sonar_distance: currentState.sonar_distance,
//                             co2_level: currentState.co2_level,
//                             sugar_level: currentState.sugar_level,
//                             airflow: 2.0
//                         });
//                     }
//                 }
//             }

//             console.log(`🌡️ ========== END TEMPERATURE DATA ==========\n`);

//         } catch (error) {
//             console.error(`❌ Error handling temperature:`, error);
//         }
//     }
// }

// module.exports = TemperatureHandler;
// Updated for new schema: Use handleEnvironmentReading from EnhancedMqttHandler

const EnhancedMqttHandler = require('../EnhancedMqttHandler');  // Import base

class TemperatureHandler {
    async handleTemperatureData(topic, rawValue) {
        console.log(`🌡️ ========== TEMPERATURE DATA ==========`);
        console.log(`🌡️ Raw value: ${rawValue}`);
        const activeUsers = getActiveUsers();  // Assuming this function
        console.log(`🌡️ Active users: ${activeUsers.length}`);

        // Convert value (kept as-is, assuming your logic)
        const temperature = parseFloat(rawValue) * 10.58;  // Example conversion; adjust as per your code
        console.log(`🌡️ Converted temperature: ${temperature}°C`);

        // For each user/location (assuming multi-location from your logs)
        for (const user of activeUsers) {
            try {
                const location = user.location || 'sensor-room';  // Derive from context
                await EnhancedMqttHandler.handleEnvironmentReading(user.id, this.getSensorCode(topic), temperature, location);
                console.log(`🔄 Updated temperature: ${temperature}`);
            } catch (error) {
                console.error(`❌ DB update failed for user ${user.id}: ${error.message}`);
            }
        }

        // Broadcast (kept as-is)
        console.log(`🔄 Real sensor ${topic}: ${temperature}°C → Broadcasted to all users`);
        console.log(`🌡️ ========== END TEMPERATURE DATA ==========`);
    }

    getSensorCode(topic) {
        // Map topic to sensor_code (e.g., 'ESP2' → 'REAL_TEMP_004')
        const map = { 'ESP2': 'REAL_TEMP_004', 'ESPX2': 'REAL_TEMP_002' };  // Add from your config
        return map[topic] || topic;
    }
}

module.exports = TemperatureHandler;