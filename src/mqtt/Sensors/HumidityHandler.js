const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class HumidityHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [HumidityHandler] Initialized`);
    }

    async handleHumidityData(topic, payload) {
        console.log(`\n💧 ========== HUMIDITY DATA ==========`);
        console.log(`📍 Topic: "${topic}", Payload: "${payload}"`);

        const value = parseFloat(payload);
        if (!Number.isFinite(value)) {
            console.warn(`⚠️ Invalid humidity value: ${payload}`);
            return;
        }

        // Use direct value if already in percentage
        const humidityPercentage = value;

        console.log(`💧 Humidity: ${humidityPercentage.toFixed(1)}%`);
        this.updateCache('humidity', humidityPercentage);

        // ✅ Emit chart data
        try {
            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_name FROM sensors s 
                 WHERE s.mqtt_topic = ? AND s.is_active = 1`,
                [topic]
            );

            if (sensors.length === 0) {
                console.error(`❌ No sensor found for topic: "${topic}"`);
                return;
            }

            sensors.forEach(sensor => {
                this.io.to(`sensor_${sensor.id}`).emit('sensorData', {
                    sensorId: sensor.id,
                    value: humidityPercentage,
                    timestamp: new Date().toISOString(),
                    quality: 'good'
                });
                console.log(`📊 Emitted chartData to sensor_${sensor.id}`);
            });

        } catch (error) {
            console.error(`❌ Error emitting sensorData:`, error.message);
            return;
        }

        // Process for active users
        console.log(`👥 Active users: ${this.activeUsers.size}`);

        for (const [userId, rooms] of this.activeUsers) {
            console.log(`🔵 Processing user ${userId}, rooms:`, Array.from(rooms));

            for (const roomCode of rooms) {
                await this.saveToDB(userId, roomCode, topic, humidityPercentage);
            }

            // ✅ Emit standardized sensorUpdate event
            this.io.to(`user_${userId}`).emit('sensorUpdate', {
                sensorType: 'humidity',
                value: humidityPercentage,
                timestamp: new Date().toISOString(),
                source: topic
            });
            console.log(`📡 Emitted sensorUpdate to user_${userId}`);
        }

        console.log(`💧 ========== END HUMIDITY DATA ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`💾 Saving - User: ${userId} | Room: ${roomCode} | Topic: ${mqttTopic}`);

            // Step 1: Find room
            const [rooms] = await pool.execute(
                'SELECT id, room_name FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.error(`❌ No room found for user ${userId}, room: ${roomCode}`);
                return false;
            }

            const roomId = rooms[0].id;
            console.log(`✅ Found room: ${rooms[0].room_name} (ID: ${roomId})`);

            // Step 2: Find sensor by mqtt_topic
            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_name FROM sensors s
                 WHERE s.user_id = ? 
                 AND s.room_id = ? 
                 AND s.mqtt_topic = ?
                 AND s.is_active = 1`,
                [userId, roomId, mqttTopic]
            );

            if (sensors.length === 0) {
                console.error(`❌ No sensor found for topic: "${mqttTopic}" in room ${roomId}`);

                // Debug: Show all sensors in room
                const [allSensors] = await pool.execute(
                    `SELECT s.id, s.sensor_name, s.mqtt_topic FROM sensors s
                     WHERE s.room_id = ?`,
                    [roomId]
                );
                console.error(`📊 Sensors in room ${roomId}:`, allSensors);
                return false;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ Found sensor: ${sensors[0].sensor_name} (ID: ${sensorId})`);

            // Step 3: Insert measurement
            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            // Step 4: Update last_reading_at
            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ Saved ${value.toFixed(1)}% to sensor ${sensorId}`);
            return true;

        } catch (error) {
            console.error(`❌ Database error:`, error.message);
            console.error(`   SQL:`, error.sqlMessage);
            return false;
        }
    }
}

module.exports = HumidityHandler;
