// src/mqtt/Sensors/RealTimeSensorService.js
// Real-time sensor service - applies CO2's no-latency approach to ALL sensors

const pool = require('../../config/db');

class RealTimeSensorService {
    constructor(io) {
        this.io = io;
        this.sensorCache = new Map(); // topic -> sensor config
        this.lastReceivedData = new Map(); // topic -> timestamp
        this.cacheExpiry = 5 * 60 * 1000; // Refresh cache every 5 minutes
        this.lastCacheRefresh = 0;
        
        console.log(`🚀 [RealTimeSensorService] Initialized - NO LATENCY mode for ALL sensors`);
    }

    // Load all sensor configs into memory cache
    async loadSensorCache() {
        try {
            const [sensors] = await pool.execute(
                `SELECT s.*, st.type_code, st.type_name, st.unit,
                 r.room_code, r.room_name, r.id as room_id
                 FROM sensors s
                 INNER JOIN sensor_types st ON s.sensor_type_id = st.id
                 LEFT JOIN rooms r ON s.room_id = r.id
                 WHERE s.is_active = 1 AND s.mqtt_topic IS NOT NULL`
            );

            this.sensorCache.clear();
            for (const sensor of sensors) {
                this.sensorCache.set(sensor.mqtt_topic, sensor);
            }

            this.lastCacheRefresh = Date.now();
            console.log(`🔄 [RealTimeSensorService] Loaded ${this.sensorCache.size} sensors into cache`);
            return this.sensorCache.size;
        } catch (error) {
            console.error('❌ [RealTimeSensorService] Failed to load cache:', error.message);
            return 0;
        }
    }

    // Check if cache needs refresh
    async ensureCacheValid() {
        if (Date.now() - this.lastCacheRefresh > this.cacheExpiry) {
            await this.loadSensorCache();
        }
    }

    // Get sensor from cache or DB (with cache update)
    async getSensorConfig(topic) {
        await this.ensureCacheValid();
        
        let sensor = this.sensorCache.get(topic);
        
        if (!sensor) {
            // Cache miss - try DB lookup
            const [sensors] = await pool.execute(
                `SELECT s.*, st.type_code, st.type_name, st.unit,
                 r.room_code, r.room_name, r.id as room_id
                 FROM sensors s
                 INNER JOIN sensor_types st ON s.sensor_type_id = st.id
                 LEFT JOIN rooms r ON s.room_id = r.id
                 WHERE s.mqtt_topic = ? AND s.is_active = 1
                 LIMIT 1`,
                [topic]
            );
            
            if (sensors.length > 0) {
                sensor = sensors[0];
                this.sensorCache.set(topic, sensor);
            }
        }
        
        return sensor;
    }

    /**
     * Handle sensor data with ZERO latency - same approach as CO2
     * - Immediate database write with transaction
     * - Instant Socket.IO emission to all relevant rooms
     * - Parallel processing for multiple sensors on same topic
     */
    async handleSensorData(topic, payload) {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();
        
        try {
            // Get sensor config from cache
            const sensor = await this.getSensorConfig(topic);
            
            if (!sensor) {
                // Not a sensor topic - return false so actuator handling can try
                return false;
            }

            console.log(`⚡ [RealTime] Processing ${sensor.type_code} from topic "${topic}"`);

            // Parse and validate value
            let value;
            if (sensor.type_code.includes('status') || sensor.unit === 'status') {
                value = payload.toUpperCase() === 'ON' ? 1 : 0;
            } else {
                value = parseFloat(payload);
                if (!Number.isFinite(value)) {
                    // Check for command echoes
                    const upperPayload = payload.toString().toUpperCase().trim();
                    if (['GET', 'READ', 'STATUS', '?', ''].includes(upperPayload)) {
                        console.warn(`⚠️ [RealTime] Ignoring command echo on ${topic}: "${payload}"`);
                        return false;
                    }
                    console.warn(`⚠️ [RealTime] Invalid value on ${topic}: "${payload}"`);
                    return false;
                }
                
                // Sanity check for extreme values
                if (Math.abs(value) > 1e10) {
                    console.warn(`⚠️ [RealTime] Value too extreme on ${topic}: ${value}`);
                    return false;
                }
            }

            // Track data reception
            this.lastReceivedData.set(topic, Date.now());

            // ⚡ IMMEDIATE DATABASE WRITE (no buffering)
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
                console.log(`   💾 [RealTime] DB write complete (ID: ${result.insertId})`);

            } catch (dbError) {
                await connection.rollback();
                throw dbError;
            } finally {
                connection.release();
            }

            // ⚡ IMMEDIATE SOCKET.IO EMISSION (parallel to all rooms)
            const roomCode = sensor.room_code || sensor.room_name || 'unknown';
            const userRoom = `user_${sensor.user_id}_${roomCode}`;
            const locationRoom = `location_${roomCode}`;
            const sensorRoom = `sensor_${sensor.id}`;

            console.log(`   📡 [RealTime] Emitting to rooms: ${sensorRoom}, ${userRoom}, ${locationRoom}`);

            // Emit to sensor-specific room (for charts)
            this.io.to(sensorRoom).emit('sensorData', {
                sensorId: sensor.id,
                value: value,
                timestamp: timestamp,
                quality: 'good'
            });

            // Emit to user room
            this.io.to(userRoom).emit('sensorUpdate', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                sensorName: sensor.sensor_name,
                roomCode: roomCode,
                roomName: sensor.room_name,
                location: roomCode,
                roomId: sensor.room_id,
                value: value,
                unit: sensor.unit || '',
                timestamp: timestamp,
                topic: sensor.mqtt_topic
            });

            // Emit chart data to location room
            this.io.to(locationRoom).emit('chartData', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                value: value,
                timestamp: timestamp,
                unit: sensor.unit || ''
            });

            // Emit environment update
            this.io.to(userRoom).emit('environmentUpdate', {
                [sensor.type_code]: value,
                timestamp: timestamp
            });

            const processingTime = Date.now() - startTime;
            console.log(`⚡ [RealTime] ${sensor.type_code}: ${value}${sensor.unit || ''} → ${userRoom} (${processingTime}ms)`);

            return true;

        } catch (error) {
            console.error(`❌ [RealTime] Error handling ${topic}:`, error.message);
            return false;
        }
    }

    /**
     * Handle multiple sensors on the same topic (parallel processing)
     */
    async handleMultipleSensors(topic, payload) {
        const startTime = Date.now();
        
        try {
            // Find ALL sensors for this topic
            const [sensors] = await pool.execute(
                `SELECT s.*, st.type_code, st.type_name, st.unit,
                 r.room_code, r.room_name, r.id as room_id
                 FROM sensors s
                 INNER JOIN sensor_types st ON s.sensor_type_id = st.id
                 LEFT JOIN rooms r ON s.room_id = r.id
                 WHERE s.mqtt_topic = ? AND s.is_active = 1`,
                [topic]
            );

            if (sensors.length === 0) {
                return false;
            }

            // Process all sensors in parallel
            await Promise.all(sensors.map(sensor => 
                this.processSingleSensor(sensor, payload)
            ));

            const processingTime = Date.now() - startTime;
            console.log(`⚡ [RealTime] Processed ${sensors.length} sensor(s) for ${topic} in ${processingTime}ms`);

            return true;

        } catch (error) {
            console.error(`❌ [RealTime] Error in handleMultipleSensors:`, error.message);
            return false;
        }
    }

    async processSingleSensor(sensor, payload) {
        const timestamp = new Date().toISOString();
        
        try {
            // Parse value
            let value;
            if (sensor.type_code.includes('status') || sensor.unit === 'status') {
                value = payload.toUpperCase() === 'ON' ? 1 : 0;
            } else {
                value = parseFloat(payload);
                if (!Number.isFinite(value) || Math.abs(value) > 1e10) {
                    return;
                }
            }

            // Track reception
            this.lastReceivedData.set(sensor.mqtt_topic, Date.now());

            // Database write with transaction
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                await connection.execute(
                    `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) 
                     VALUES (?, ?, NOW(3), 100)`,
                    [sensor.id, value]
                );

                await connection.execute(
                    'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                    [sensor.id]
                );

                await connection.commit();
            } catch (dbError) {
                await connection.rollback();
                throw dbError;
            } finally {
                connection.release();
            }

            // Socket.IO emissions
            const roomCode = sensor.room_code || sensor.room_name || 'unknown';
            const userRoom = `user_${sensor.user_id}_${roomCode}`;
            const locationRoom = `location_${roomCode}`;
            const sensorRoom = `sensor_${sensor.id}`;

            this.io.to(sensorRoom).emit('sensorData', {
                sensorId: sensor.id,
                value: value,
                timestamp: timestamp,
                quality: 'good'
            });

            this.io.to(userRoom).emit('sensorUpdate', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                sensorName: sensor.sensor_name,
                roomCode: roomCode,
                roomName: sensor.room_name,
                location: roomCode,
                roomId: sensor.room_id,
                value: value,
                unit: sensor.unit || '',
                timestamp: timestamp,
                topic: sensor.mqtt_topic
            });

            this.io.to(locationRoom).emit('chartData', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                value: value,
                timestamp: timestamp,
                unit: sensor.unit || ''
            });

            this.io.to(userRoom).emit('environmentUpdate', {
                [sensor.type_code]: value,
                timestamp: timestamp
            });

        } catch (error) {
            console.error(`❌ [RealTime] Error processing sensor ${sensor.id}:`, error.message);
        }
    }

    // Get status of all tracked sensors
    getStatus() {
        return {
            cachedSensors: this.sensorCache.size,
            lastCacheRefresh: new Date(this.lastCacheRefresh).toISOString(),
            trackedTopics: Array.from(this.lastReceivedData.entries()).map(([topic, ts]) => ({
                topic,
                lastReceived: new Date(ts).toISOString(),
                timeSinceLastData: Date.now() - ts
            }))
        };
    }

    // Check for stale sensors (no data in X seconds)
    getStaleSensors(thresholdMs = 10000) {
        const now = Date.now();
        const stale = [];
        
        for (const [topic, sensor] of this.sensorCache) {
            const lastReceived = this.lastReceivedData.get(topic);
            if (!lastReceived || (now - lastReceived) > thresholdMs) {
                stale.push({
                    topic,
                    sensorName: sensor.sensor_name,
                    sensorType: sensor.type_code,
                    lastReceived: lastReceived ? new Date(lastReceived).toISOString() : 'never'
                });
            }
        }
        
        return stale;
    }
}

module.exports = RealTimeSensorService;
