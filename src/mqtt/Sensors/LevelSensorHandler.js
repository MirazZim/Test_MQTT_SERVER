// src/mqtt/Sensors/LevelSensorHandler.js
// Standalone Level/Sonar sensor handler

const mqtt = require('mqtt');
const pool = require('../../config/db');

class LevelSensorHandler {
    constructor(io) {
        this.io = io;
        this.client = null;
        this.messageCount = 0;
        this.lastMessage = null;
        this.sensorConfig = null;
        
        // MQTT config
        this.BROKER = 'mqtt://bdtmp.ultra-x.jp';
        this.PORT = 1883;
        this.USERNAME = 'admin';
        this.PASSWORD = 'StrongPassword123';
        this.TOPIC = 'level';
        
        console.log(`📏 [LevelSensorHandler] Initialized - standalone level/sonar handler`);
    }

    async loadSensorConfig() {
        try {
            const [sensors] = await pool.execute(
                `SELECT s.*, st.type_code, st.type_name, st.unit,
                 r.room_code, r.room_name, r.id as room_id
                 FROM sensors s
                 INNER JOIN sensor_types st ON s.sensor_type_id = st.id
                 LEFT JOIN rooms r ON s.room_id = r.id
                 WHERE s.mqtt_topic = 'level' AND s.is_active = 1
                 LIMIT 1`
            );
            
            if (sensors.length > 0) {
                this.sensorConfig = sensors[0];
                console.log(`📏 [Level] Loaded sensor: ID=${this.sensorConfig.id}, Type=${this.sensorConfig.type_code}, Room=${this.sensorConfig.room_code}`);
            } else {
                console.warn(`⚠️ [Level] No level sensor found in database`);
            }
        } catch (error) {
            console.error(`❌ [Level] Failed to load sensor config:`, error.message);
        }
    }

    connect() {
        const CLIENT_ID = `level_sub_${Date.now()}_${Math.random().toString(16).substr(2, 8)}`;
        
        const options = {
            port: this.PORT,
            clientId: CLIENT_ID,
            username: this.USERNAME,
            password: this.PASSWORD,
            clean: true,
            keepalive: 30,
            reconnectPeriod: 5000,
            connectTimeout: 30000,
            resubscribe: true,
            protocolVersion: 4,
            reschedulePings: true,
        };

        console.log(`📏 [Level] Connecting with client ID: ${CLIENT_ID}`);
        
        this.client = mqtt.connect(this.BROKER, options);

        this.client.on('connect', async () => {
            console.log(`📏 [Level] Connected to broker ✅`);
            
            await this.loadSensorConfig();
            
            this.client.subscribe(this.TOPIC, { qos: 1 }, (err) => {
                if (err) {
                    console.error(`❌ [Level] Subscribe error:`, err);
                } else {
                    console.log(`📏 [Level] Subscribed to topic: ${this.TOPIC}`);
                }
            });
        });

        this.client.on('message', async (topic, message) => {
            const payload = message.toString();
            const timestamp = new Date().toISOString();
            
            this.messageCount++;
            this.lastMessage = { topic, payload, timestamp };
            
            console.log(`📏 [Level] #${this.messageCount} RECV | payload=${payload} | time=${timestamp}`);
            
            await this.handleLevelData(payload, timestamp);
        });

        this.client.on('reconnect', () => console.log(`📏 [Level] Reconnecting...`));
        this.client.on('offline', () => console.log(`📏 [Level] Offline`));
        this.client.on('error', (err) => console.error(`❌ [Level] Error:`, err.message));
        this.client.on('close', () => console.log(`📏 [Level] Connection closed`));

        console.log(`📏 [Level] MQTT client started`);
    }

    async handleLevelData(payload, timestamp) {
        try {
            const value = parseFloat(payload);
            
            if (!Number.isFinite(value)) {
                console.warn(`⚠️ [Level] Invalid value: "${payload}"`);
                return;
            }

            if (!this.sensorConfig) {
                await this.loadSensorConfig();
                if (!this.sensorConfig) {
                    console.warn(`⚠️ [Level] No sensor config, skipping`);
                    return;
                }
            }

            const sensor = this.sensorConfig;

            // DB write
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [result] = await connection.execute(
                    `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator) 
                     VALUES (?, ?, NOW(3), 100)`,
                    [sensor.id, value]
                );

                await connection.execute(
                    'UPDATE sensors SET last_reading_at = NOW(3) WHERE id = ?',
                    [sensor.id]
                );

                await connection.commit();
                console.log(`   📏 💾 DB write (ID: ${result.insertId})`);

            } catch (dbError) {
                await connection.rollback();
                throw dbError;
            } finally {
                connection.release();
            }

            // Socket.IO
            const roomCode = sensor.room_code || sensor.room_name || 'unknown';
            const userRoom = `user_${sensor.user_id}_${roomCode}`;
            const locationRoom = `location_${roomCode}`;
            const sensorRoom = `sensor_${sensor.id}`;
            const unit = sensor.unit || 'cm';

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
                unit: unit,
                timestamp: timestamp,
                topic: 'level'
            });

            this.io.to(locationRoom).emit('chartData', {
                sensorId: sensor.id,
                sensorType: sensor.type_code,
                value: value,
                timestamp: timestamp,
                unit: unit
            });

            this.io.to(userRoom).emit('environmentUpdate', {
                [sensor.type_code]: value,
                timestamp: timestamp
            });

            console.log(`   📏 ${value}${unit} → ${userRoom}`);

        } catch (error) {
            console.error(`❌ [Level] Error:`, error.message);
        }
    }

    getStats() {
        return {
            connected: this.client?.connected || false,
            totalMessages: this.messageCount,
            lastMessage: this.lastMessage
        };
    }

    disconnect() {
        if (this.client?.connected) {
            console.log(`📏 [Level] Disconnecting (${this.messageCount} messages)`);
            this.client.end();
        }
    }
}

module.exports = LevelSensorHandler;
