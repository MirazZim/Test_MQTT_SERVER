const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class TemperatureHandler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [TemperatureHandler] Initialized`);
    }

    async handleTemperatureData(topic, payload) {
        console.log(`\n🌡️ ========== TEMPERATURE HANDLER ==========`);
        console.log(`📍 Topic: "${topic}", Payload: "${payload}"`);

        const value = parseFloat(payload);
        if (!Number.isFinite(value)) {
            console.warn(`⚠️ Invalid temperature: ${payload}`);
            return;
        }

        console.log(`🌡️ Temperature: ${value.toFixed(2)}°C`);
        this.updateCache('temperature', value);

        // ✅ Emit to sensor-specific room for charts
        try {
            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_name, s.user_id, r.room_code 
                 FROM sensors s
                 LEFT JOIN rooms r ON s.room_id = r.id
                 WHERE s.mqtt_topic = ? AND s.is_active = 1`,
                [topic]
            );

            if (sensors.length === 0) {
                console.error(`❌ [CRITICAL] No sensor found for topic: "${topic}"`);
                console.error(`   → Check if sensor was created during room setup`);
                return;
            }

            console.log(`✅ Found ${sensors.length} sensor(s) for topic "${topic}":`,
                sensors.map(s => `${s.sensor_name} (ID: ${s.id})`));

            // Emit to each sensor's chart room
            sensors.forEach(sensor => {
                this.io.to(`sensor_${sensor.id}`).emit('sensorData', {
                    sensorId: sensor.id,
                    value: value,
                    timestamp: new Date().toISOString(),
                    quality: 'good'
                });
                console.log(`📊 Emitted chartData to sensor_${sensor.id}`);
            });

        } catch (error) {
            console.error(`❌ Error emitting sensorData:`, error.message);
            return;
        }

        // ✅ Process for active users
        console.log(`👥 Active users: ${this.activeUsers.size}`);

        for (const [userId, rooms] of this.activeUsers) {
            console.log(`🔵 Processing user ${userId}, rooms:`, Array.from(rooms));

            for (const roomCode of rooms) {
                await this.saveToDB(userId, roomCode, topic, value);
            }

            // ✅ Emit standardized sensorUpdate event
            this.io.to(`user_${userId}`).emit('sensorUpdate', {
                sensorType: 'temperature',
                value: value,
                timestamp: new Date().toISOString(),
                source: topic
            });
            console.log(`📡 Emitted sensorUpdate to user_${userId}`);
        }

        console.log(`🌡️ ========== END TEMPERATURE HANDLER ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`\n💾 ========== SAVING TO DATABASE ==========`);
            console.log(`   User: ${userId} | Room: ${roomCode} | Topic: ${mqttTopic}`);

            // ✅ Step 1: Find room
            const [rooms] = await pool.execute(
                'SELECT id, room_name FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            if (rooms.length === 0) {
                console.error(`❌ No room found for user ${userId}, room_code: ${roomCode}`);

                // Debug: Show all user rooms
                const [allRooms] = await pool.execute(
                    'SELECT id, room_name, room_code FROM rooms WHERE user_id = ?',
                    [userId]
                );
                console.error(`📊 Available rooms for user ${userId}:`, allRooms);
                return false;
            }

            const roomId = rooms[0].id;
            console.log(`✅ Found room: ${rooms[0].room_name} (ID: ${roomId})`);

            // ✅ Step 2: Find sensor by MQTT topic
            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_name, st.type_code 
                 FROM sensors s
                 JOIN sensor_types st ON s.sensor_type_id = st.id
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
                    `SELECT s.id, s.sensor_name, s.mqtt_topic, st.type_code 
                     FROM sensors s
                     JOIN sensor_types st ON s.sensor_type_id = st.id
                     WHERE s.room_id = ?`,
                    [roomId]
                );
                console.error(`📊 Sensors in room ${roomId}:`, allSensors);
                return false;
            }

            const sensorId = sensors[0].id;
            console.log(`✅ Found sensor: ${sensors[0].sensor_name} (ID: ${sensorId})`);

            // ✅ Step 3: Insert measurement
            await pool.execute(
                'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)',
                [sensorId, value]
            );

            // ✅ Step 4: Update last_reading_at
            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );

            console.log(`✅ Saved ${value.toFixed(2)}°C to sensor ${sensorId}`);
            console.log(`💾 ========== END SAVE ==========\n`);
            return true;

        } catch (error) {
            console.error(`\n❌ DATABASE ERROR:`, error.message);
            console.error(`   SQL State:`, error.sqlState);
            console.error(`   SQL Message:`, error.sqlMessage);
            return false;
        }
    }
}

module.exports = TemperatureHandler;
