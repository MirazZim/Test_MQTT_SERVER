const mqtt = require('mqtt');
const fs = require('fs');
require('dotenv').config();

class SpatialSensorSimulator {
    constructor() {
        this.client = null;
        this.userId = 14;
        this.location = 'test-warehouse';

        this.sensors = [
            { id: 'TEMP_001', x: 2.0, y: 2.0, baseTemp: 19.0 },
            { id: 'TEMP_002', x: 8.0, y: 2.0, baseTemp: 24.0 },
            { id: 'TEMP_003', x: 2.0, y: 8.0, baseTemp: 20.5 },
            { id: 'TEMP_004', x: 8.0, y: 8.0, baseTemp: 23.5 },
            { id: 'TEMP_005', x: 5.0, y: 5.0, baseTemp: 22.0 },
            { id: 'HUM_001', x: 5.0, y: 2.0, baseTemp: 21.0 }
        ];

        this.targetTemp = 22.0;
        this.simulationStep = 0;

        // 🔒 NEW: Prepare TLS options
        this.tlsOptions = this.prepareTLSOptions();
    }

    // 🔒 NEW: TLS configuration method
    prepareTLSOptions() {
        try {
            const caCertPath = process.env.MQTT_CA_CERT_PATH;
            const clientCertPath = process.env.MQTT_CLIENT_CERT_PATH;
            const clientKeyPath = process.env.MQTT_CLIENT_KEY_PATH;

            // Check if certificate exists with multiple path attempts
            const possiblePaths = [
                caCertPath,
                './src/mqtt/broker.crt'
            ];

            let validCertPath = null;
            for (const path of possiblePaths) {
                if (path && fs.existsSync(path)) {
                    validCertPath = path;
                    console.log(`✅ Found certificate at: ${path}`);
                    break;
                }
            }

            if (!validCertPath) {
                console.warn(`⚠️ No certificate found. Tried paths: ${possiblePaths.join(', ')}`);
                console.warn(`⚠️ Falling back to non-TLS connection`);
                return {}; // Return empty options for non-TLS
            }

            const tlsOptions = {
                // ✅ CRITICAL: Read CA certificate
                ca: [fs.readFileSync(validCertPath)],

                // ✅ FIXED: Allow self-signed certificates
                rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true' ? true : false,

                // Only add client cert/key if they exist
                ...(clientCertPath && fs.existsSync(clientCertPath) && {
                    cert: fs.readFileSync(clientCertPath)
                }),
                ...(clientKeyPath && fs.existsSync(clientKeyPath) && {
                    key: fs.readFileSync(clientKeyPath)
                }),

                // Security settings
                secureProtocol: 'TLSv1_2_method',
                checkServerIdentity: () => undefined, // Disable hostname verification
                requestCert: false,
                agent: false
            };

            console.log(`✅ TLS configured using certificate: ${validCertPath}`);
            console.log(`🔒 Reject Unauthorized: ${tlsOptions.rejectUnauthorized}`);

            return tlsOptions;
        } catch (error) {
            console.error('❌ Failed to configure TLS:', error.message);
            console.warn('⚠️ Falling back to non-TLS connection');
            return {}; // Return empty options to allow non-TLS fallback
        }
    }

    async connect() {
        // 🔒 Enhanced connection options with TLS support
        const connectOptions = {
            username: process.env.MQTT_USERNAME || "admin",
            password: process.env.MQTT_PASSWORD || "StrongPassword123",
            clientId: `spatial-simulator-${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 60,
            clean: true,
            reconnectPeriod: 5000,
            connectTimeout: 30 * 1000,
            protocolVersion: 4,

            // 🔒 Add TLS options if certificate is available
            ...this.tlsOptions
        };

        // Determine broker URL based on TLS availability
        const hasSSL = Object.keys(this.tlsOptions).length > 0;
        const defaultHost = hasSSL ?
            "mqtts://192.168.88.221:8883" :
            "mqtt://192.168.88.221:1883";

        const brokerUrl = process.env.MQTT_HOST || defaultHost;

        console.log(`🔗 Connecting to MQTT broker: ${brokerUrl}`);
        console.log(`👤 Username: ${connectOptions.username}`);
        console.log(`🔒 TLS Mode: ${hasSSL ? 'Enabled' : 'Disabled'}`);

        this.client = mqtt.connect(brokerUrl, connectOptions);

        this.client.on('connect', () => {
            console.log('🌐 Spatial Sensor Simulator connected to MQTT');

            // Validate TLS connection if using SSL
            if (hasSSL) {
                this.validateTLSConnection();
            }

            console.log(`📍 Location: ${this.location}`);
            this.startSimulation();
        });

        // 🔒 Enhanced error handling for TLS issues
        this.client.on('error', (error) => {
            console.error('🚨 MQTT Error:', error.message);

            // Handle specific TLS/SSL errors
            if (error.code === 'ENOTFOUND') {
                console.error("💡 Solution: Check broker hostname/IP address");
            } else if (error.code === 'ECONNREFUSED') {
                console.error("💡 Solution: Ensure broker is running and accessible");
            } else if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.message.includes('self signed certificate')) {
                console.error("💡 Self-signed certificate detected:");
                console.error("   - Ensure certificate path is correct");
                console.error("   - Set MQTT_REJECT_UNAUTHORIZED=false in .env");
                console.error("   - Verify broker.crt matches broker's certificate");
            } else if (error.code === 'CERT_UNTRUSTED') {
                console.error("💡 Solution: Add broker certificate to trusted certificates");
            } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
                console.error("💡 Solution: Check certificate chain and CA certificate");
            }
        });
    }

    // 🔒 NEW: Validate TLS connection
    validateTLSConnection() {
        if (!this.client || !this.client.stream) {
            return false;
        }

        const socket = this.client.stream;
        if (socket.encrypted) {
            const cipher = socket.getCipher();
            const peerCert = socket.getPeerCertificate();

            console.log('🔒 Secure TLS Connection Established:');
            console.log(` 📡 Protocol: ${socket.getProtocol()}`);
            console.log(` 🔐 Cipher: ${cipher?.name || 'Unknown'} (${cipher?.version || 'N/A'})`);
            console.log(` 📜 Server Certificate: ${peerCert?.subject?.CN || 'Self-signed'}`);
            console.log(` ⏰ Valid Until: ${peerCert?.valid_to || 'Unknown'}`);

            return true;
        }

        console.warn('⚠️ Connection is not encrypted - using plain MQTT');
        return false;
    }

    startSimulation() {
        setInterval(() => {
            this.publishSensorData();
            this.simulationStep++;
        }, 10000);
    }

    publishSensorData() {
        this.sensors.forEach(sensor => {
            const temperature = this.calculateRealisticTemperature(sensor);
            const humidity = 45 + Math.random() * 20;
            const airflow = 1.5 + Math.random() * 1.0;

            const sensorData = {
                temperature: parseFloat(temperature.toFixed(2)),
                humidity: parseFloat(humidity.toFixed(1)),
                airflow: parseFloat(airflow.toFixed(3)),
                timestamp: new Date().toISOString()
            };

            const topic = `home/${this.userId}/${this.location}/sensors/${sensor.id}/data`;

            this.client.publish(topic, JSON.stringify(sensorData), { qos: 1 }, (error) => {
                if (!error) {
                    console.log(`📡 ${sensor.id}: ${temperature.toFixed(1)}°C`);
                }
            });
        });
    }

    calculateRealisticTemperature(sensor) {
        let temperature = sensor.baseTemp;
        const timeVariation = Math.sin(this.simulationStep * 0.1) * 1.5;
        const randomNoise = (Math.random() - 0.5) * 1.0;
        const controlEffect = (this.targetTemp - temperature) * 0.05;

        temperature += timeVariation + randomNoise + controlEffect;
        return Math.max(15.0, Math.min(30.0, temperature));
    }
}

const simulator = new SpatialSensorSimulator();
simulator.connect();

module.exports = SpatialSensorSimulator;
