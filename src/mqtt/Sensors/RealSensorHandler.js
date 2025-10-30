// src/mqtt/sensors/RealSensorHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class RealSensorHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);

        // ✅ EXACT sensor mapping from original working code
        this.sensorMapping = {
            "ESP2": { id: "REAL_TEMP_004", x: 8.0, y: 8.0, type: "temperature" }, // Top-right
            "ESPX": { id: "REAL_TEMP_001", x: 2.0, y: 2.0, type: "temperature" }, // Bottom-left
            "ESPX2": { id: "REAL_TEMP_002", x: 8.0, y: 2.0, type: "temperature" }, // Bottom-right
            "ESPX3": { id: "REAL_TEMP_003", x: 2.0, y: 8.0, type: "temperature" }  // Top-left
        };
    }

    async handleRealSensorData(topic, messageValue) {
        try {
            const sensor = this.sensorMapping[topic];
            if (!sensor) {
                console.log(`⏭️ Topic ${topic} not mapped to real sensor`);
                return;
            }

            let rawValue = parseFloat(messageValue);
            if (!Number.isFinite(rawValue)) {
                console.warn(`Invalid sensor value from ${topic}: ${messageValue}`);
                return;
            }

            // ✅ Convert raw ADC values (0-4095) to realistic temperature (15-30°C)
            let temperature;
            if (rawValue > 1000 && rawValue <= 4095) {
                temperature = 15 + (rawValue / 4095) * 15; // 15°C to 30°C range
                console.log(`🔄 Real sensor ${topic} (${sensor.id}): ${rawValue} → ${temperature.toFixed(2)}°C`);
            } else if (rawValue >= 0 && rawValue <= 100) {
                temperature = rawValue;
            } else {
                temperature = rawValue;
                console.warn(`⚠️ Unusual sensor value: ${rawValue} from ${topic}`);
            }

            const now = new Date();
            const nowIso = now.toISOString();

            // ✅ CRITICAL: Update sensor_nodes table for ALL active users
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
                    try {
                        // Update sensor_nodes with latest reading
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

                        console.log(`✅ DB updated for user ${userId}: ${sensor.id} = ${temperature.toFixed(2)}°C`);
                    } catch (dbError) {
                        console.error(`❌ DB update failed for user ${userId}, ${sensor.id}:`, dbError.message);
                    }
                }
            }

            // ✅ Emit spatial sensor update to frontend
            for (const [userId, locations] of this.activeUsers) {
                for (const location of locations) {
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

            console.log(`🔄 Real sensor ${topic}: ${temperature.toFixed(2)}°C → Broadcasted to all users`);

        } catch (error) {
            console.error(`❌ Error handling real sensor ${topic}:`, error);
        }
    }
}

module.exports = RealSensorHandler;
