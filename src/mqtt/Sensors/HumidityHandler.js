// mqtt/sensors/HumidityHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class HumidityHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [HumidityHandler] Initialized`);
    }

    async handleHumidityData(topic, payload) {
        console.log(`\n💧 ========== HUMIDITY DATA ==========`);
        const rawValue = parseFloat(payload);

        if (!Number.isFinite(rawValue)) {
            console.warn(`⚠️ [HumidityHandler] Invalid value: ${payload}`);
            return;
        }

        // Convert raw sensor value to humidity percentage
        const humidity = (rawValue / 4095) * 100;
        console.log(`💧 Raw value: ${rawValue}`);
        console.log(`💧 Converted humidity: ${humidity.toFixed(1)}%`);

        // Update cache
        this.updateCache('humidity', humidity);

        console.log(`💧 [HumidityHandler] Active users: ${this.activeUsers.size}`);

        // Save to database for all active users
        for (const [userId, rooms] of this.activeUsers) {
            try {
                console.log(`🔵 [HumidityHandler] Processing user ${userId} with rooms:`, Array.from(rooms));

                for (const roomCode of rooms) {
                    await this.saveToDB(userId, roomCode, topic, humidity);
                }

                // Emit to user's socket
                this.io.to(`user_${userId}`).emit('humidityUpdate', {
                    humidity: humidity,
                    timestamp: new Date(),
                    source: topic
                });
                console.log(`📡 [HumidityHandler] Emitted to user ${userId}`);

            } catch (error) {
                console.error(`❌ [HumidityHandler] Error for user ${userId}:`, error.message);
            }
        }

        console.log(`💧 ========== END HUMIDITY DATA ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`🔵 [HumidityHandler] Saving - User: ${userId}, Room: ${roomCode}`);

            // Get room_id
            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.warn(`⚠️ [HumidityHandler] No room found for user ${userId}, room_code: ${roomCode}`);
                return;
            }

            const roomId = rooms[0].id;
            console.log(`✅ [HumidityHandler] Found room_id: ${roomId}`);

            // Get humidity sensor
            const [sensors] = await pool.execute(
                `SELECT s.id FROM sensors s
         INNER JOIN sensor_types st ON s.sensor_type_id = st.id
         WHERE s.user_id = ? 
         AND s.room_id = ? 
         AND st.type_code = 'humidity'
         AND s.is_active = 1
         LIMIT 1`,
                [userId, roomId]
            );

            if (sensors.length === 0) {
                console.warn(`⚠️ [HumidityHandler] No humidity sensor found in room ${roomId}`);
                return;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ [HumidityHandler] Found sensor_id: ${sensorId}`);

            // Insert measurement
            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            // Update last_reading_at
            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ [HumidityHandler] Saved: ${value.toFixed(2)}% (sensor_id: ${sensorId})`);

            this.io.to(`user_${userId}`).emit('environmentUpdate', {
                location: roomCode,
                humidity: value,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ [HumidityHandler] DB error:`, error.message);
        }
    }
}

module.exports = HumidityHandler;
