// mqtt/sensors/CO2Handler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class CO2Handler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [CO2Handler] Initialized`);
    }

    async handleCO2Data(topic, payload) {
        console.log(`\n💨 ========== CO2 DATA ==========`);
        const value = parseFloat(payload);

        if (!Number.isFinite(value)) {
            console.warn(`⚠️ [CO2Handler] Invalid value: ${payload}`);
            return;
        }

        console.log(`💨 CO2 Level: ${value.toFixed(2)} ppm`);
        this.updateCache('co2_level', value);

        console.log(`💨 [CO2Handler] Active users: ${this.activeUsers.size}`);

        for (const [userId, rooms] of this.activeUsers) {
            try {
                console.log(`🔵 [CO2Handler] Processing user ${userId} with rooms:`, Array.from(rooms));

                for (const roomCode of rooms) {
                    await this.saveToDB(userId, roomCode, topic, value);
                }

                this.io.to(`user_${userId}`).emit('co2Update', {
                    co2_level: value,
                    timestamp: new Date(),
                    source: topic
                });
                console.log(`📡 [CO2Handler] Emitted to user ${userId}`);

            } catch (error) {
                console.error(`❌ [CO2Handler] Error for user ${userId}:`, error.message);
            }
        }

        console.log(`💨 ========== END CO2 DATA ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`🔵 [CO2Handler] Saving - User: ${userId}, Room: ${roomCode}`);

            const [rooms] = await pool.execute(
                'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.warn(`⚠️ [CO2Handler] No room found for user ${userId}, room_code: ${roomCode}`);
                return;
            }

            const roomId = rooms[0].id;
            console.log(`✅ [CO2Handler] Found room_id: ${roomId}`);

            const [sensors] = await pool.execute(
                `SELECT s.id FROM sensors s
         INNER JOIN sensor_types st ON s.sensor_type_id = st.id
         WHERE s.user_id = ? 
         AND s.room_id = ? 
         AND st.type_code = 'co2_level'
         AND s.is_active = 1
         LIMIT 1`,
                [userId, roomId]
            );

            if (sensors.length === 0) {
                console.warn(`⚠️ [CO2Handler] No co2_level sensor found in room ${roomId}`);
                return;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ [CO2Handler] Found sensor_id: ${sensorId}`);

            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ [CO2Handler] Saved: ${value.toFixed(2)} ppm (sensor_id: ${sensorId})`);

        } catch (error) {
            console.error(`❌ [CO2Handler] DB error:`, error.message);
        }
    }
}

module.exports = CO2Handler;
