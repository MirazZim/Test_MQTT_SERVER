// src/mqtt/sensors/HumidityHandler.js  
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class HumidityHandler extends BaseSensorHandler {
    async handleHumidityData(topic, messageValue) {
        console.log(`\n💧 ========== HUMIDITY DATA ==========`);
        console.log(`💧 Raw value: ${messageValue}`);

        try {
            let validation = this.validateNumeric(messageValue, -50, 4095);
            if (!validation.valid) {
                console.warn(`⚠️ Invalid humidity`);
                return;
            }

            let humidityValue = validation.value;

            if (humidityValue > 1000 && humidityValue <= 4095) {
                humidityValue = (humidityValue / 4095) * 100;
            }
            console.log(`💧 Converted humidity: ${humidityValue.toFixed(1)}%`);

            await this.updateSensorCache('humidity', humidityValue);

            if (this.activeUsers.size === 0) {
                console.log('⏸️ No active users');
                return;
            }

            const release = await this.sensorDataMutex.acquire();
            let currentState;
            try {
                currentState = {
                    temperature: this.sensorData.temperature,
                    humidity: this.sensorData.humidity,
                    bowl_temp: this.sensorData.bowl_temp,
                    sonar_distance: this.sensorData.sonar_distance,
                    co2_level: this.sensorData.co2_level,
                    sugar_level: this.sensorData.sugar_level
                };
            } finally {
                release();
            }

            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {

                    try {
                        await pool.execute(`
                            INSERT INTO measurements 
                            (user_id, temperature, humidity, bowl_temp, sonar_distance, co2_level, sugar_level, airflow, location, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [userId, currentState.temperature, currentState.humidity, currentState.bowl_temp,
                                currentState.sonar_distance, currentState.co2_level, currentState.sugar_level,
                                2.0, location, new Date()]
                        );
                    } catch (error) {
                        console.error(`❌ DB error:`, error.message);
                    }

                    const enriched = {
                        temperature: currentState.temperature,
                        humidity: currentState.humidity,
                        bowl_temp: currentState.bowl_temp,
                        sonar_distance: currentState.sonar_distance,
                        co2_level: currentState.co2_level,
                        sugar_level: currentState.sugar_level,
                        airflow: 2.0,
                        user_id: userId,
                        location: location,
                        created_at: new Date().toISOString()
                    };

                    // ✅ Emit BOTH events
                    this.io.to(`location_${location}`).emit("newMeasurement", enriched);
                    this.io.to(`user_${userId}`).emit("newMeasurement", enriched);

                    // ✅ ADD THIS - environmentUpdate for CurrentEnvironment
                    this.io.to(`location_${location}`).emit("environmentUpdate", enriched);
                    this.io.to(`user_${userId}`).emit("environmentUpdate", enriched);

                    console.log(`📡 Emitted to user ${userId}`);
                }
            }

            console.log(`💧 ========== END HUMIDITY DATA ==========\n`);

        } catch (error) {
            console.error(`❌ Humidity error:`, error);
        }
    }
}

module.exports = HumidityHandler;