// src/mqtt/Sensors/CO2PollingService.js
// Active polling service to ensure CO2 data is captured every second

const pool = require('../../config/db');

class CO2PollingService {
    constructor(primaryClient, co2Client, co2Handler) {
        this.primaryClient = primaryClient;
        this.co2Client = co2Client;  // ← NEW: Dedicated CO2 client
        this.co2Handler = co2Handler;
        this.pollingInterval = null;
        this.isPolling = false;
        this.pollFrequency = 1000; // Poll every 1 second
        this.co2Topics = new Map(); // Map of topic -> sensor info
        this.lastReceivedData = new Map(); // Track last received data per topic

        console.log(`🔵 [CO2PollingService] Initialized with ${co2Client ? 'dedicated CO2 client' : 'primary client only'}`);
    }

    async loadCO2Sensors() {
        try {
            console.log(`🔍 [CO2PollingService] Loading CO2 sensors from database...`);

            const [sensors] = await pool.execute(
                `SELECT s.id, s.sensor_name, s.mqtt_topic, s.user_id, s.room_id, 
                        r.room_code, r.room_name, st.type_code
                 FROM sensors s
                 LEFT JOIN rooms r ON s.room_id = r.id
                 LEFT JOIN sensor_types st ON s.sensor_type_id = st.id
                 WHERE st.type_code = 'co2_level' AND s.is_active = 1`
            );

            this.co2Topics.clear();

            for (const sensor of sensors) {
                if (sensor.mqtt_topic) {
                    this.co2Topics.set(sensor.mqtt_topic, {
                        id: sensor.id,
                        name: sensor.sensor_name,
                        topic: sensor.mqtt_topic,
                        userId: sensor.user_id,
                        roomId: sensor.room_id,
                        roomCode: sensor.room_code,
                        roomName: sensor.room_name
                    });
                    console.log(`   ✅ Loaded CO2 sensor: ${sensor.sensor_name} (Topic: ${sensor.mqtt_topic})`);
                }
            }

            console.log(`✅ [CO2PollingService] Loaded ${this.co2Topics.size} CO2 sensor(s)`);
            return this.co2Topics.size;

        } catch (error) {
            console.error(`❌ [CO2PollingService] Error loading sensors:`, error.message);
            return 0;
        }
    }

    async start() {
        if (this.isPolling) {
            console.warn(`⚠️ [CO2PollingService] Already polling`);
            return;
        }

        // Load CO2 sensors first
        const sensorCount = await this.loadCO2Sensors();

        if (sensorCount === 0) {
            console.warn(`⚠️ [CO2PollingService] No CO2 sensors found. Polling not started.`);
            return;
        }

        this.isPolling = true;
        console.log(`🚀 [CO2PollingService] Starting monitoring every ${this.pollFrequency}ms`);
        console.log(`📝 Note: CO2 topics are subscribed by MqttConnection.connectCO2Broker()`);
        console.log(`📝 This service only monitors data flow and checks for gaps`);

        // Start monitoring interval (no subscriptions - already done in MqttConnection)
        this.pollingInterval = setInterval(() => {
            this.pollCO2Data();
        }, this.pollFrequency);

        console.log(`✅ [CO2PollingService] Monitoring started for topics: ${Array.from(this.co2Topics.keys()).join(', ')}`);
    }

    subscribeToTopic(topic) {
        // Use the appropriate client based on setup
        const client = this.co2Client || this.primaryClient;

        if (!client || !client.connected) {
            console.error(`❌ [CO2PollingService] MQTT client not connected for topic: ${topic}`);
            return;
        }

        client.subscribe(topic, { qos: 1 }, (err) => {
            if (err) {
                console.error(`❌ [CO2PollingService] Failed to subscribe to ${topic}:`, err.message);
            } else {
                const clientType = this.co2Client ? 'CO2 broker' : 'primary broker';
                console.log(`✅ [CO2PollingService] Subscribed to ${topic} on ${clientType}`);
            }
        });
    }

    async pollCO2Data() {
        const now = Date.now();

        for (const [topic, sensor] of this.co2Topics) {
            try {
                // Check if we've received data recently
                const lastReceived = this.lastReceivedData.get(topic);
                const timeSinceLastData = lastReceived ? now - lastReceived : Infinity;

                // If no data received in last 5 seconds, log warning
                if (timeSinceLastData > 5000) {
                    // Only log every 10 seconds to avoid spam
                    if (timeSinceLastData % 10000 < 1000) {
                        console.warn(`⚠️ [CO2PollingService] No data from ${topic} for ${Math.round(timeSinceLastData / 1000)}s`);
                        console.warn(`   💡 Last value: ${this._lastValues?.get(topic) || 'never received'}`);
                    }
                }

                // Check database for latest reading (less frequently)
                if (now % 5000 < 1000) {  // Check every 5 seconds
                    await this.checkDatabaseForRecentData(sensor);
                }

            } catch (error) {
                console.error(`❌ [CO2PollingService] Error polling ${topic}:`, error.message);
            }
        }
    }

    async checkDatabaseForRecentData(sensor) {
        try {
            const [measurements] = await pool.execute(
                `SELECT measured_value, measured_at 
                 FROM sensor_measurements 
                 WHERE sensor_id = ? 
                 ORDER BY measured_at DESC 
                 LIMIT 1`,
                [sensor.id]
            );

            if (measurements.length > 0) {
                const lastMeasurement = measurements[0];
                const lastMeasurementTime = new Date(lastMeasurement.measured_at).getTime();
                const timeSinceLastMeasurement = Date.now() - lastMeasurementTime;

                if (timeSinceLastMeasurement > 10000) {
                    console.warn(`⚠️ [CO2PollingService] Database shows stale data for ${sensor.name} (last: ${Math.round(timeSinceLastMeasurement / 1000)}s ago, value: ${lastMeasurement.measured_value})`);
                }
            } else {
                console.warn(`⚠️ [CO2PollingService] No measurements found in database for ${sensor.name}`);
            }
        } catch (error) {
            console.error(`❌ [CO2PollingService] Database check error:`, error.message);
        }
    }

    // Call this when data is received to update tracking
    onDataReceived(topic, value) {
        // Only track valid numeric values, not echo responses
        const numericValue = parseFloat(value);
        if (Number.isFinite(numericValue)) {
            this.lastReceivedData.set(topic, Date.now());

            // Track last values for debugging
            if (!this._lastValues) this._lastValues = new Map();
            this._lastValues.set(topic, numericValue);

            const timeSinceStart = Date.now() - (this._startTime || Date.now());
            console.log(`✅ [CO2PollingService] Data received on "${topic}": ${numericValue} ppm (runtime: ${Math.round(timeSinceStart / 1000)}s)`);
        } else {
            console.warn(`⚠️ [CO2PollingService] Received non-numeric value on "${topic}": "${value}" (ignoring)`);
        }
    }

    stop() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            this.isPolling = false;
            console.log(`🛑 [CO2PollingService] Polling stopped`);
        }
    }

    async reloadSensors() {
        console.log(`🔄 [CO2PollingService] Reloading sensors...`);
        await this.loadCO2Sensors();

        // Resubscribe to new topics if needed
        if (!this.co2Client) {
            for (const [topic] of this.co2Topics) {
                this.subscribeToTopic(topic);
            }
        }
    }

    getStatus() {
        return {
            isPolling: this.isPolling,
            pollFrequency: this.pollFrequency,
            sensorCount: this.co2Topics.size,
            hasCO2Client: !!this.co2Client,
            sensors: Array.from(this.co2Topics.values()),
            lastReceivedData: Array.from(this.lastReceivedData.entries()).map(([topic, timestamp]) => ({
                topic,
                lastReceived: new Date(timestamp).toISOString(),
                timeSinceLastData: Date.now() - timestamp,
                lastValue: this._lastValues?.get(topic)
            }))
        };
    }
}

module.exports = CO2PollingService;