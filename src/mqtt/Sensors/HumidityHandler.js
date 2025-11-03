// mqtt/sensors/HumidityHandler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class HumidityHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [HumidityHandler] Initialized`);
    }

    async handleHumidityData(topic, payload) {
        console.log(`\n💧 ========== HUMIDITY DATA ==========`);
        console.log(`💧 Raw value: ${payload}`);

        const value = parseFloat(payload);
        if (!Number.isFinite(value)) {
            console.warn(`⚠️ [HumidityHandler] Invalid value: ${payload}`);
            return;
        }

        // ESP specific conversion
        const humidityPercentage = (value / 4095) * 100;
        console.log(`💧 Converted humidity: ${humidityPercentage.toFixed(1)}%`);

        this.updateCache('humidity', humidityPercentage);
        console.log(`💧 [HumidityHandler] Active users: ${this.activeUsers.size}`);

        // ✅ FIX: Emit sensorData for chart updates
        try {
            const [sensors] = await pool.execute(
                'SELECT id, user_id FROM sensors WHERE mqtt_topic = ? AND is_active = 1',
                [topic]
            );

            if (sensors.length > 0) {
                const sensor = sensors[0];
                this.io.to(`sensor_${sensor.id}`).emit('sensorData', {
                    sensorId: sensor.id,
                    value: humidityPercentage,
                    timestamp: new Date().toISOString(),
                    quality: 'good'
                });
                console.log(`📡 [HumidityHandler] Emitted to sensor_${sensor.id}: ${humidityPercentage.toFixed(1)}%`);
            }
        } catch (error) {
            console.error(`❌ [HumidityHandler] Error emitting sensorData:`, error.message);
        }

        // Process for active users
        for (const [userId, rooms] of this.activeUsers) {
            try {
                for (const roomCode of rooms) {
                    await this.saveToDB(userId, roomCode, topic, humidityPercentage);
                }

                this.io.to(`user_${userId}`).emit('humidityUpdate', {
                    humidity: humidityPercentage,
                    timestamp: new Date(),
                    source: topic
                });

            } catch (error) {
                console.error(`❌ [HumidityHandler] Error for user ${userId}:`, error.message);
            }
        }
        console.log(`💧 ========== END HUMIDITY DATA ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) return;

            const roomId = rooms[0].id;

            const [sensors] = await pool.execute(
                `SELECT id FROM sensors 
                 WHERE user_id = ? 
                 AND room_id = ? 
                 AND mqtt_topic = ? 
                 AND is_active = 1`,
                [userId, roomId, mqttTopic]
            );

            if (sensors.length === 0) return;

            const sensorId = sensors[0].id;

            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ [HumidityHandler] Saved: ${value.toFixed(1)}% (sensor_id: ${sensorId})`);

        } catch (error) {
            console.error(`❌ [HumidityHandler] DB error:`, error.message);
        }
    }
}

module.exports = HumidityHandler;
