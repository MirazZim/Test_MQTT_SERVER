// Enhanced TemperatureHandler.js with comprehensive logging
// Save this as: src/mqtt/Sensors/TemperatureHandler.js

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
        console.log(`🔵 [TemperatureHandler] Active users map:`,
            Array.from(this.activeUsers.entries()).map(([uid, rooms]) =>
                ({ userId: uid, rooms: Array.from(rooms) })
            )
        );

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

        // ✅ CRITICAL DEBUG: Check if sensor exists in database for this topic
        try {
            const [allSensors] = await pool.execute(
                'SELECT s.id, s.sensor_code, s.user_id, s.room_id, s.mqtt_topic, r.room_code FROM sensors s LEFT JOIN rooms r ON s.room_id = r.id WHERE s.mqtt_topic = ? AND s.is_active = 1',
                [topic]
            );
            console.log(`🔍 [DB CHECK] Sensors found for topic "${topic}":`, allSensors);

            if (allSensors.length === 0) {
                console.error(`❌ [CRITICAL] No sensor registered in database for topic: ${topic}`);
                console.error(`❌ This means the sensor was not created during room creation!`);
                return;
            }

            // Emit sensorData for chart updates FIRST
            allSensors.forEach(sensor => {
                this.io.to(`sensor_${sensor.id}`).emit('sensorData', {
                    sensorId: sensor.id,
                    value: adjustedValue,
                    timestamp: new Date().toISOString(),
                    quality: 'good'
                });
                console.log(`📡 [TemperatureHandler] ✅ Emitted sensorData to sensor_${sensor.id}: ${adjustedValue.toFixed(2)}°C`);
            });
        } catch (error) {
            console.error(`❌ [TemperatureHandler] Error checking sensors:`, error.message);
        }

        // Process for each active user
        for (const [userId, rooms] of this.activeUsers) {
            console.log(`🔵 [TemperatureHandler] Processing user ${userId} with rooms:`, Array.from(rooms));

            for (const roomCode of rooms) {
                console.log(`🔵 [TemperatureHandler] Attempting to save for user ${userId}, room ${roomCode}`);
                const saveResult = await this.saveToDB(userId, roomCode, topic, adjustedValue);
                console.log(`📊 [Save Result] User ${userId}, Room ${roomCode}: ${saveResult ? '✅ SUCCESS' : '❌ FAILED'}`);
            }

            // Emit to user's socket room
            this.io.to(`user_${userId}`).emit('temperatureUpdate', {
                temperature: adjustedValue,
                timestamp: new Date(),
                source: topic
            });
            console.log(`📡 [TemperatureHandler] Emitted temperatureUpdate to user_${userId}`);
        }

        console.log(`🌡️ ========== END TEMPERATURE HANDLER ==========\n`);
    }

    async saveToDB(userId, roomCode, mqttTopic, value) {
        try {
            console.log(`\n🔵 ========== SAVE TO DB ==========`);
            console.log(`🔵 [TemperatureHandler] Input:`, {
                userId,
                roomCode,
                mqttTopic,
                value: value.toFixed(2)
            });

            // Step 1: Find room
            console.log(`🔍 [Step 1] Looking for room...`);
            const [rooms] = await pool.execute(
                'SELECT id, room_name FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                [userId, roomCode]
            );

            console.log(`🔍 [Step 1 Result] Rooms found:`, rooms);

            if (rooms.length === 0) {
                console.error(`❌ [CRITICAL] No room found for user ${userId}, room_code: ${roomCode}`);
                console.error(`❌ This means either:`);
                console.error(`   1. Room was not created properly`);
                console.error(`   2. room_code doesn't match`);
                console.error(`   3. is_active is 0`);

                // Debug: Show all rooms for this user
                const [allRooms] = await pool.execute(
                    'SELECT id, room_name, room_code, is_active FROM rooms WHERE user_id = ?',
                    [userId]
                );
                console.error(`📊 [DEBUG] All rooms for user ${userId}:`, allRooms);
                return false;
            }

            const roomId = rooms[0].id;
            const roomName = rooms[0].room_name;
            console.log(`✅ [Step 1] Found room: ${roomName} (ID: ${roomId})`);

            // Step 2: Find sensor
            console.log(`🔍 [Step 2] Looking for sensor with mqtt_topic="${mqttTopic}"...`);
            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_code, s.sensor_name, st.type_code 
                 FROM sensors s
                 JOIN sensor_types st ON s.sensor_type_id = st.id
                 WHERE s.user_id = ? 
                 AND s.room_id = ? 
                 AND s.mqtt_topic = ? 
                 AND s.is_active = 1`,
                [userId, roomId, mqttTopic]
            );

            console.log(`🔍 [Step 2 Result] Sensors found:`, sensors);

            if (sensors.length === 0) {
                console.error(`❌ [CRITICAL] No sensor found for mqtt_topic: ${mqttTopic} in room ${roomId}`);
                console.error(`❌ This means the sensor was NOT created during room creation!`);

                // Debug: Show all sensors in this room
                const [allRoomSensors] = await pool.execute(
                    `SELECT s.id, s.sensor_code, s.sensor_name, s.mqtt_topic, st.type_code 
                     FROM sensors s
                     JOIN sensor_types st ON s.sensor_type_id = st.id
                     WHERE s.room_id = ? AND s.user_id = ?`,
                    [roomId, userId]
                );
                console.error(`📊 [DEBUG] All sensors in room ${roomId}:`, allRoomSensors);

                // Debug: Show what mqtt_topics exist for this user
                const [allUserSensors] = await pool.execute(
                    `SELECT s.id, s.mqtt_topic, r.room_code, st.type_code 
                     FROM sensors s
                     JOIN sensor_types st ON s.sensor_type_id = st.id
                     JOIN rooms r ON s.room_id = r.id
                     WHERE s.user_id = ?`,
                    [userId]
                );
                console.error(`📊 [DEBUG] All MQTT topics for user ${userId}:`, allUserSensors);

                return false;
            }

            const sensorId = sensors[0].id;
            const sensorName = sensors[0].sensor_name;
            console.log(`✅ [Step 2] Found sensor: ${sensorName} (ID: ${sensorId})`);

            // Step 3: Insert measurement
            console.log(`🔍 [Step 3] Inserting measurement...`);
            const insertQuery = 'INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) VALUES (?, ?, NOW(3), 100)';
            console.log(`📝 [SQL]`, insertQuery, [sensorId, value]);

            const [insertResult] = await pool.execute(insertQuery, [sensorId, value]);

            console.log(`✅ [Step 3] Measurement inserted with ID: ${insertResult.insertId}`);

            // Step 4: Update sensor last_reading_at
            console.log(`🔍 [Step 4] Updating sensor last_reading_at...`);
            await pool.execute(
                'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                [sensorId]
            );
            console.log(`✅ [Step 4] Updated last_reading_at for sensor ${sensorId}`);

            // Step 5: Emit environment update
            console.log(`🔍 [Step 5] Emitting environment update...`);
            this.io.to(`user_${userId}`).emit('environmentUpdate', {
                location: roomCode,
                temperature: value,
                timestamp: new Date().toISOString()
            });
            console.log(`✅ [Step 5] Emitted environmentUpdate to user_${userId}`);

            console.log(`✅ [SUCCESS] Saved: ${value.toFixed(2)}°C (sensor_id: ${sensorId})`);
            console.log(`🔵 ========== END SAVE TO DB ==========\n`);
            return true;

        } catch (error) {
            console.error(`\n❌ ========== DATABASE ERROR ==========`);
            console.error(`❌ [TemperatureHandler] Error in saveToDB:`, error.message);
            console.error(`❌ Stack trace:`, error.stack);
            console.error(`❌ SQL State:`, error.sqlState);
            console.error(`❌ SQL Message:`, error.sqlMessage);
            console.error(`❌ ========== END DATABASE ERROR ==========\n`);
            return false;
        }
    }
}

module.exports = TemperatureHandler;