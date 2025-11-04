// mqtt/sensors/TemperatureHandler.js
// ✅ FIXED: Added sensorData emission for real-time chart updates
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class TemperatureHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [TemperatureHandler] Initialized`);
    }

    async handleTemperatureData(topic, payload) {
        console.log(`\n🌡️ ========== TEMPERATURE HANDLER ==========`);
        console.log(`🔵 [TemperatureHandler] Topic: ${topic}, Payload: ${payload}`);

        const value = parseFloat(payload);
        if (!Number.isFinite(value)) {
            console.warn(`⚠️ [TemperatureHandler] Invalid temperature value: ${payload}`);
            return;
        }

        // ESP2 specific conversion
        const adjustedValue = value * 10.6;
        console.log(`🌡️ [TemperatureHandler] Raw: ${value}, Adjusted: ${adjustedValue.toFixed(2)}`);

        // Update cache
        this.updateCache('temperature', adjustedValue);
        console.log(`🌡️ [TemperatureHandler] Active users: ${this.activeUsers.size}`);

        // ✅ FIX: Emit sensorData for chart updates FIRST
        try {
            const [sensors] = await pool.execute(
                'SELECT id, user_id FROM sensors WHERE mqtt_topic = ? AND is_active = 1',
                [topic]
            );

            if (sensors.length > 0) {
                const sensor = sensors[0];
                // ✅ CRITICAL: Emit to sensor-specific room for chart updates
                this.io.to(`sensor_${sensor.id}`).emit('sensorData', {
                    sensorId: sensor.id,
                    value: adjustedValue,
                    timestamp: new Date().toISOString(),
                    quality: 'good'
                });
                console.log(`📡 [TemperatureHandler] ✅ Emitted sensorData to sensor_${sensor.id}: ${adjustedValue.toFixed(2)}°C`);
            } else {
                console.warn(`⚠️ [TemperatureHandler] No sensor found for topic: ${topic}`);
            }
        } catch (error) {
            console.error(`❌ [TemperatureHandler] Error emitting sensorData:`, error.message);
        }

        // Save to database and emit for all active users
        for (const [userId, rooms] of this.activeUsers) {
            try {
                console.log(`🔵 [TemperatureHandler] Processing user ${userId} with rooms:`, Array.from(rooms));

                for (const roomCode of rooms) {
                    await this.saveToDB(userId, roomCode, topic, adjustedValue);
                }

                // Emit to user's socket room
                this.io.to(`user_${userId}`).emit('temperatureUpdate', {
                    temperature: adjustedValue,
                    timestamp: new Date(),
                    source: topic
                });
                console.log(`📡 [TemperatureHandler] Emitted temperatureUpdate to user_${userId}`);

            } catch (error) {
                console.error(`❌ [TemperatureHandler] Error for user ${userId}:`, error.message);
            }
        }
        console.log(`🌡️ ========== END TEMPERATURE HANDLER ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`🔵 [TemperatureHandler] Saving to DB - User: ${userId}, Room: ${roomCode}, Topic: ${mqttTopic}`);

            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.warn(`⚠️ [TemperatureHandler] No room found for user ${userId}, room_code: ${roomCode}`);
                return;
            }

            const roomId = rooms[0].id;
            console.log(`✅ [TemperatureHandler] Found room_id: ${roomId}`);

            const [sensors] = await pool.execute(
                `SELECT id FROM sensors 
                 WHERE user_id = ? 
                 AND room_id = ? 
                 AND mqtt_topic = ? 
                 AND is_active = 1`,
                [userId, roomId, mqttTopic]
            );

            if (sensors.length === 0) {
                console.warn(`⚠️ [TemperatureHandler] No sensor found for topic: ${mqttTopic} in room ${roomId}`);
                return;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ [TemperatureHandler] Found sensor_id: ${sensorId}`);

            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ [TemperatureHandler] Saved: ${value.toFixed(2)}°C (sensor_id: ${sensorId})`);

            this.io.to(`user_${userId}`).emit('environmentUpdate', {
                location: roomCode,
                temperature: value,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ [TemperatureHandler] DB error:`, error.message);
        }
    }
}

module.exports = TemperatureHandler;