// mqtt/sensors/BowlTemperatureHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class BowlTemperatureHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [BowlTemperatureHandler] Initialized`);
    }

    async handleBowlTemperatureData(topic, payload) {
        console.log(`\n🍲 ========== BOWL TEMPERATURE DATA ==========`);
        const value = parseFloat(payload);

        if (!Number.isFinite(value)) {
            console.warn(`⚠️ [BowlTemperatureHandler] Invalid value: ${payload}`);
            return;
        }

        console.log(`🍲 Bowl temperature: ${value.toFixed(2)}°C`);
        this.updateCache('bowl_temp', value);

        console.log(`🍲 [BowlTemperatureHandler] Active users: ${this.activeUsers.size}`);

        for (const [userId, rooms] of this.activeUsers) {
            try {
                console.log(`🔵 [BowlTemperatureHandler] Processing user ${userId} with rooms:`, Array.from(rooms));

                for (const roomCode of rooms) {
                    await this.saveToDB(userId, roomCode, topic, value);
                }

                this.io.to(`user_${userId}`).emit('bowlTemperatureUpdate', {
                    bowl_temp: value,
                    timestamp: new Date(),
                    source: topic
                });
                console.log(`📡 [BowlTemperatureHandler] Emitted to user ${userId}`);

            } catch (error) {
                console.error(`❌ [BowlTemperatureHandler] Error for user ${userId}:`, error.message);
            }
        }

        console.log(`🍲 ========== END BOWL TEMPERATURE DATA ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`🔵 [BowlTemperatureHandler] Saving - User: ${userId}, Room: ${roomCode}`);

            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.warn(`⚠️ [BowlTemperatureHandler] No room found for user ${userId}, room_code: ${roomCode}`);
                return;
            }

            const roomId = rooms[0].id;
            console.log(`✅ [BowlTemperatureHandler] Found room_id: ${roomId}`);

            const [sensors] = await pool.execute(
                `SELECT s.id FROM sensors s
         INNER JOIN sensor_types st ON s.sensor_type_id = st.id
         WHERE s.user_id = ? 
         AND s.room_id = ? 
         AND st.type_code = 'bowl_temp'
         AND s.is_active = 1
         LIMIT 1`,
                [userId, roomId]
            );

            if (sensors.length === 0) {
                console.warn(`⚠️ [BowlTemperatureHandler] No bowl_temp sensor found in room ${roomId}`);
                return;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ [BowlTemperatureHandler] Found sensor_id: ${sensorId}`);

            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ [BowlTemperatureHandler] Saved: ${value.toFixed(2)}°C (sensor_id: ${sensorId})`);

        } catch (error) {
            console.error(`❌ [BowlTemperatureHandler] DB error:`, error.message);
        }
    }
}

module.exports = BowlTemperatureHandler;
