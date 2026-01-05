// mqtt/sensors/CO2Handler.js
const BaseSensorHandler = require('../base/BaseSensorHandler');
const pool = require('../../config/db');

class CO2Handler extends BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        super(io, sensorData, activeUsers, sensorDataMutex);
        console.log(`🔵 [CO2Handler] Initialized`);
    }

    async handleCO2Data(topic, payload) {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();
        console.log(`\n💨 [CO2] ${timestamp} | Topic: "${topic}" | Payload: "${payload}"`);

        // Validate value
        const value = parseFloat(payload);
        if (!Number.isFinite(value)) {
            // Check if it's a command echo (GET, READ, etc.)
            const upperPayload = payload.toString().toUpperCase().trim();
            if (['GET', 'READ', 'STATUS', '?', ''].includes(upperPayload)) {
                console.warn(`⚠️ [CO2] Ignoring command echo: "${payload}"`);
                console.warn(`   💡 Your sensor is echoing back commands instead of sending data`);
                console.warn(`   💡 Check sensor configuration to enable auto-publish mode`);
            } else {
                console.error(`❌ [CO2] Invalid value: ${payload}`);
            }
            return;
        }

        console.log(`✅ [CO2] Valid CO2 reading: ${value.toFixed(2)} ppm`);

        // Update cache immediately (non-blocking)
        this.updateCache('co2_level', value);

        try {
            // ✅ OPTIMIZED: Single query to get all sensor data
            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_name, s.user_id, s.room_id, r.room_code, r.room_name
                 FROM sensors s
                 LEFT JOIN rooms r ON s.room_id = r.id
                 WHERE s.mqtt_topic = ? AND s.is_active = 1`,
                [topic]
            );

            if (sensors.length === 0) {
                console.error(`❌ [CO2] No sensor found for topic: "${topic}"`);
                return;
            }

            console.log(`🔍 [CO2] Found ${sensors.length} sensor(s)`);

            // ✅ OPTIMIZED: Process all sensors in parallel using Promise.all
            await Promise.all(sensors.map(async (sensor) => {
                try {
                    // Batch database operations using a transaction for better performance
                    const connection = await pool.getConnection();
                    
                    try {
                        await connection.beginTransaction();

                        // Insert measurement
                        const [result] = await connection.execute(
                            `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) 
                             VALUES (?, ?, NOW(3), 100)`,
                            [sensor.id, value]
                        );

                        // Update last_reading_at
                        await connection.execute(
                            'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                            [sensor.id]
                        );

                        await connection.commit();
                        console.log(`   ✅ [CO2] Saved measurement ID: ${result.insertId} for sensor ${sensor.id}`);

                    } catch (dbError) {
                        await connection.rollback();
                        throw dbError;
                    } finally {
                        connection.release();
                    }

                    // Emit to Socket.IO rooms (non-blocking)
                    const roomCode = sensor.room_code || sensor.room_name || 'unknown';
                    const userRoom = `user_${sensor.user_id}_${roomCode}`;
                    const locationRoom = `location_${roomCode}`;
                    const sensorRoomName = `sensor_${sensor.id}`;
                    const emitTimestamp = new Date().toISOString();

                    // Emit all events in parallel
                    this.io.to(sensorRoomName).emit('sensorData', {
                        sensorId: sensor.id,
                        value: value,
                        timestamp: emitTimestamp,
                        quality: 'good'
                    });

                    this.io.to(userRoom).emit('sensorUpdate', {
                        sensorId: sensor.id,
                        sensorType: 'co2_level',
                        sensorName: sensor.sensor_name,
                        value: value,
                        unit: 'ppm',
                        timestamp: emitTimestamp,
                        roomCode: roomCode,
                        roomName: sensor.room_name,
                        source: topic
                    });

                    this.io.to(locationRoom).emit('chartData', {
                        sensorId: sensor.id,
                        sensorType: 'co2_level',
                        value: value,
                        timestamp: emitTimestamp,
                        unit: 'ppm'
                    });

                    this.io.to(userRoom).emit('environmentUpdate', {
                        co2_level: value,
                        timestamp: emitTimestamp
                    });

                } catch (sensorError) {
                    console.error(`   ❌ [CO2] Error processing sensor ${sensor.id}:`, sensorError.message);
                }
            }));

            const processingTime = Date.now() - startTime;
            console.log(`💨 [CO2] ✅ Processed in ${processingTime}ms\n`);

        } catch (error) {
            console.error(`❌ [CO2] Error:`, error.message);
            console.error(`   Stack:`, error.stack);
        }
    }

}

module.exports = CO2Handler;
