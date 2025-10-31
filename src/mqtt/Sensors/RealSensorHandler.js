// mqtt/sensors/RealSensorHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class RealSensorHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [RealSensorHandler] Initialized`);

        // ✅ Sensor mapping for spatial positioning
        this.sensorMapping = {
            "ESP2": { id: "REAL_TEMP_004", x: 8.0, y: 8.0, type: "temperature" },  // Top-right
            "ESPX": { id: "REAL_TEMP_001", x: 2.0, y: 2.0, type: "temperature" },  // Bottom-left
            "ESPX2": { id: "REAL_TEMP_002", x: 8.0, y: 2.0, type: "temperature" }, // Bottom-right
            "ESPX3": { id: "REAL_TEMP_003", x: 2.0, y: 8.0, type: "temperature" }  // Top-left
        };
    }

    async handleRealSensorData(topic, messageValue) {
        console.log(`\n🔴 ========== REAL SENSOR DATA ==========`);
        console.log(`🔵 [RealSensorHandler] Topic: ${topic}, Payload: ${messageValue}`);

        try {
            const sensor = this.sensorMapping[topic];
            if (!sensor) {
                console.log(`⏭️ [RealSensorHandler] Topic ${topic} not mapped to real sensor`);
                return;
            }

            let rawValue = parseFloat(messageValue);
            if (!Number.isFinite(rawValue)) {
                console.warn(`⚠️ [RealSensorHandler] Invalid sensor value from ${topic}: ${messageValue}`);
                return;
            }

            // ✅ Convert raw ADC values (0-4095) to realistic temperature (15-30°C)
            let temperature;
            if (rawValue > 1000 && rawValue <= 4095) {
                temperature = 15 + (rawValue / 4095) * 15; // 15°C to 30°C range
                console.log(`🔄 [RealSensorHandler] ${topic} (${sensor.id}): ${rawValue} → ${temperature.toFixed(2)}°C`);
            } else if (rawValue >= 0 && rawValue <= 100) {
                temperature = rawValue;
            } else {
                temperature = rawValue;
                console.warn(`⚠️ [RealSensorHandler] Unusual sensor value: ${rawValue} from ${topic}`);
            }

            const now = new Date();
            const nowIso = now.toISOString();

            console.log(`🔴 [RealSensorHandler] Active users: ${this.activeUsers.size}`);

            // ✅ Save to database for ALL active users
            for (const [userId, locations] of this.activeUsers) {
                for (const roomCode of locations) {
                    try {
                        console.log(`🔵 [RealSensorHandler] Processing user ${userId}, room: ${roomCode}`);
                        await this.saveToDB(userId, roomCode, sensor, temperature, now);
                    } catch (dbError) {
                        console.error(`❌ [RealSensorHandler] DB error for user ${userId}, ${sensor.id}:`, dbError.message);
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

            console.log(`🔄 [RealSensorHandler] Real sensor ${topic}: ${temperature.toFixed(2)}°C → Broadcasted to all users`);
            console.log(`🔴 ========== END REAL SENSOR DATA ==========\n`);

        } catch (error) {
            console.error(`❌ [RealSensorHandler] Error handling real sensor ${topic}:`, error.message);
        }
    }

    async saveToDB(userId, roomCode, sensor, temperature, timestamp) {
        try {
            console.log(`🔵 [RealSensorHandler] Saving - User: ${userId}, Room: ${roomCode}, Sensor: ${sensor.id}`);

            // Get room_id
            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.warn(`⚠️ [RealSensorHandler] No room found for user ${userId}, room_code: ${roomCode}`);
                return;
            }

            const roomId = rooms[0].id;
            console.log(`✅ [RealSensorHandler] Found room_id: ${roomId}`);

            // Check if this specific real sensor exists (by sensor_code)
            let [sensors] = await pool.execute(
                `SELECT s.id FROM sensors s
         INNER JOIN sensor_types st ON s.sensor_type_id = st.id
         WHERE s.user_id = ? 
         AND s.room_id = ? 
         AND s.sensor_code = ?
         AND s.is_active = 1
         LIMIT 1`,
                [userId, roomId, sensor.id]
            );

            let sensorId;

            // If specific sensor doesn't exist, create it
            if (sensors.length === 0) {
                console.log(`🔵 [RealSensorHandler] Creating new real sensor: ${sensor.id}`);

                // Get temperature sensor_type_id
                const [sensorTypes] = await pool.execute(
                    'SELECT id FROM sensor_types WHERE type_code = ?',
                    [sensor.type]
                );

                if (sensorTypes.length === 0) {
                    console.error(`❌ [RealSensorHandler] Sensor type '${sensor.type}' not found`);
                    return;
                }

                const sensorTypeId = sensorTypes[0].id;

                // Create the real sensor
                const [result] = await pool.execute(
                    `INSERT INTO sensors 
           (user_id, room_id, sensor_type_id, sensor_code, sensor_name, 
            x_coordinate, y_coordinate, z_coordinate, mqtt_topic, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`,
                    [
                        userId,
                        roomId,
                        sensorTypeId,
                        sensor.id,
                        `Real Sensor ${sensor.id}`,
                        sensor.x,
                        sensor.y,
                        `${userId}/${roomCode}/real/${sensor.id}`
                    ]
                );

                sensorId = result.insertId;
                console.log(`✅ [RealSensorHandler] Created sensor with ID: ${sensorId}`);
            } else {
                sensorId = sensors[0].id;
                console.log(`✅ [RealSensorHandler] Found sensor_id: ${sensorId}`);
            }

            // Insert measurement
            await pool.execute(
                `INSERT INTO sensor_measurements 
         (sensor_id, measured_value, measured_at, quality_indicator) 
         VALUES (?, ?, ?, 100)`,
                [sensorId, temperature, timestamp]
            );

            // Update last_reading_at in sensors table
            await pool.execute(
                'UPDATE sensors SET last_reading_at = ? WHERE id = ?',
                [timestamp, sensorId]
            );

            console.log(`✅ [RealSensorHandler] Saved: ${temperature.toFixed(2)}°C (sensor_id: ${sensorId})`);

        } catch (error) {
            console.error(`❌ [RealSensorHandler] DB error:`, error.message);
            throw error;
        }
    }
}

module.exports = RealSensorHandler;
