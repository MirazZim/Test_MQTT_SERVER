// mqtt/sensors/SonarDistanceHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class SonarDistanceHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [SonarDistanceHandler] Initialized`);
    }

    async handleSonarData(topic, payload) {
        console.log(`\n📏 ========== SONAR DISTANCE DATA ==========`);
        const value = parseFloat(payload);

        if (!Number.isFinite(value)) {
            console.warn(`⚠️ [SonarDistanceHandler] Invalid value: ${payload}`);
            return;
        }

        console.log(`📏 Distance: ${value.toFixed(2)} cm`);
        this.updateCache('sonar_distance', value);

        console.log(`📏 [SonarDistanceHandler] Active users: ${this.activeUsers.size}`);

        for (const [userId, rooms] of this.activeUsers) {
            try {
                console.log(`🔵 [SonarDistanceHandler] Processing user ${userId} with rooms:`, Array.from(rooms));

                for (const roomCode of rooms) {
                    await this.saveToDB(userId, roomCode, topic, value);
                }

                this.io.to(`user_${userId}`).emit('sonarUpdate', {
                    sonar_distance: value,
                    timestamp: new Date(),
                    source: topic
                });
                console.log(`📡 [SonarDistanceHandler] Emitted to user ${userId}`);

            } catch (error) {
                console.error(`❌ [SonarDistanceHandler] Error for user ${userId}:`, error.message);
            }
        }

        console.log(`📏 ========== END SONAR DISTANCE DATA ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`🔵 [SonarDistanceHandler] Saving - User: ${userId}, Room: ${roomCode}`);

            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.warn(`⚠️ [SonarDistanceHandler] No room found for user ${userId}, room_code: ${roomCode}`);
                return;
            }

            const roomId = rooms[0].id;
            console.log(`✅ [SonarDistanceHandler] Found room_id: ${roomId}`);

            const [sensors] = await pool.execute(
                `SELECT s.id FROM sensors s
         INNER JOIN sensor_types st ON s.sensor_type_id = st.id
         WHERE s.user_id = ? 
         AND s.room_id = ? 
         AND st.type_code = 'sonar_distance'
         AND s.is_active = 1
         LIMIT 1`,
                [userId, roomId]
            );

            if (sensors.length === 0) {
                console.warn(`⚠️ [SonarDistanceHandler] No sonar_distance sensor found in room ${roomId}`);
                return;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ [SonarDistanceHandler] Found sensor_id: ${sensorId}`);

            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ [SonarDistanceHandler] Saved: ${value.toFixed(2)} cm (sensor_id: ${sensorId})`);

        } catch (error) {
            console.error(`❌ [SonarDistanceHandler] DB error:`, error.message);
        }
    }
}

module.exports = SonarDistanceHandler;
