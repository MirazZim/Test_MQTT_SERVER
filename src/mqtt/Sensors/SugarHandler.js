// src/mqtt/sensors/SugarHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class SugarHandler extends BaseSensorHandler {
    async handleSugarData(topic, messageValue) {
        console.log(`\n🍬 ========== SUGAR LEVEL ==========`);
        console.log(`🍬 Value: ${messageValue}`);
        console.log(`🍬 Active users: ${this.activeUsers.size}`);

        try {
            const validation = this.validateNumeric(messageValue, 0, 1000);
            if (!validation.valid) return;

            const value = validation.value;
            await this.updateSensorCache('sugar_level', value);

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
                        console.log(`✅ Stored Sugar for user ${userId}`);
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

                    this.io.to(`location_${location}`).emit("newMeasurement", enriched);
                    this.io.to(`user_${userId}`).emit("newMeasurement", enriched);
                    this.io.to(`location_${location}`).emit("environmentUpdate", enriched);
                    this.io.to(`user_${userId}`).emit("environmentUpdate", enriched);

                    console.log(`📡 Sugar emitted to user ${userId}`);
                }
            }

            console.log(`🍬 ========== END SUGAR LEVEL ==========\n`);
        } catch (error) {
            console.error(`❌ Error handling sugar:`, error);
        }
    }
}

module.exports = SugarHandler;
