// src/mqtt/connection/MqttConnection.js
const mqtt = require("mqtt");
const fs = require("fs");

class MqttConnection {
    constructor() {
        this.mqttClient = null;
        this.host = process.env.MQTT_HOST || "mqtts://192.168.88.221:8883";
        this.tlsOptions = this.prepareTLSOptions();
    }

    prepareTLSOptions() {
        try {
            const caCertPath = process.env.MQTT_CA_CERT_PATH;
            const clientCertPath = process.env.MQTT_CLIENT_CERT_PATH;
            const clientKeyPath = process.env.MQTT_CLIENT_KEY_PATH;

            // Check if broker.crt exists with multiple path attempts
            const possiblePaths = [
                caCertPath,
                './src/mqtt/Connection/broker (1).crt',
            ];

            let validCertPath = null;
            for (const path of possiblePaths) {
                if (fs.existsSync(path)) {
                    validCertPath = path;
                    console.log(`✅ Found certificate at: ${path}`);
                    break;
                }
            }

            if (!validCertPath) {
                throw new Error(`Broker certificate not found. Tried paths: ${possiblePaths.join(', ')}`);
            }

            const tlsOptions = {
                // Use your broker.crt as CA certificate
                ca: fs.readFileSync(validCertPath),
                // 🔒 CRITICAL FIX: Properly handle rejectUnauthorized
                rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true',
                // Only add client cert/key if they exist
                ...(clientCertPath && fs.existsSync(clientCertPath) && {
                    cert: fs.readFileSync(clientCertPath)
                }),
                ...(clientKeyPath && fs.existsSync(clientKeyPath) && {
                    key: fs.readFileSync(clientKeyPath)
                }),
                // Security settings for self-signed certificates
                secureProtocol: 'TLSv1_2_method',
                // ✅ FIXED: checkServerIdentity must be a function, not boolean
                checkServerIdentity: () => undefined, // Disables hostname verification
                requestCert: false,
                agent: false
            };

            console.log(`✅ TLS configured using certificate: ${validCertPath}`);
            console.log(`🔒 Reject Unauthorized: ${tlsOptions.rejectUnauthorized}`);
            console.log(`🔒 Server Identity Check: Disabled (function provided)`);
            return tlsOptions;
        } catch (error) {
            console.error('❌ Failed to configure TLS:', error.message);
            console.error('⚠️ This will prevent secure MQTT connection');
            // 🚨 DON'T FALLBACK - Let user fix the issue
            throw new Error(`TLS Configuration Failed: ${error.message}`);
        }
    }

    // 🔒 Validate TLS connection
    validateTLSConnection() {
        if (!this.mqttClient || !this.mqttClient.stream) {
            return false;
        }

        const socket = this.mqttClient.stream;
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

    connect(onConnectCallback, onMessageCallback, onErrorCallback) {
        const connectOptions = {
            clientId: `backend-server-${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 60,
            clean: false,
            username: process.env.MQTT_USERNAME || "admin",
            password: process.env.MQTT_PASSWORD || "StrongPassword123",
            ...this.tlsOptions,
            connectTimeout: 30000,
            reconnectPeriod: 2000,
            protocolVersion: 4,
            will: {
                topic: 'system/status',
                payload: JSON.stringify({
                    status: 'offline',
                    timestamp: new Date().toISOString()
                }),
                qos: 1,
                retain: true
            }
        };

        console.log(`🔗 Connecting to: ${this.host}`);
        this.mqttClient = mqtt.connect(this.host, connectOptions);

        this.mqttClient.on("connect", () => {
            console.log("🌐 MQTT Connected!");
            this.validateTLSConnection();
            if (onConnectCallback) onConnectCallback(this.mqttClient);
        });

        this.mqttClient.on("message", onMessageCallback);
        this.mqttClient.on("error", onErrorCallback);
        this.mqttClient.on("offline", () => console.warn("📴 MQTT offline"));
        this.mqttClient.on("reconnect", () => console.log("🔄 Reconnecting..."));
        this.mqttClient.on("close", () => console.log("🔌 Connection closed"));

        return this.mqttClient;
    }

    publish(topic, message, options = { qos: 1, retain: false }) {
        if (!this.mqttClient?.connected) {
            console.error('❌ MQTT not connected');
            return false;
        }
        this.mqttClient.publish(topic, message.toString(), options, (err) => {
            if (err) console.error(`❌ Publish failed:`, err);
        });
        return true;
    }

    disconnect() {
        if (this.mqttClient?.connected) {
            this.mqttClient.publish('system/status', JSON.stringify({
                status: 'offline',
                timestamp: new Date().toISOString()
            }), { qos: 1, retain: true });
            this.mqttClient.end();
            console.log("🔌 Disconnected gracefully");
        }
    }
}

module.exports = MqttConnection;
