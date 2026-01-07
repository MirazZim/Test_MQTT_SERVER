// src/mqtt/connection/MqttConnection.js
const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");

class MqttConnection {
    constructor() {
        this.mqttClient = null;
        this.co2Client = null; // Secondary client for CO2
        this.host = process.env.MQTT_HOST || "mqtts://192.168.88.221:8883";
        this.co2Host = process.env.MQTT_HOST_CO2; // Optional secondary broker for CO2
        this.isTLS = this.host.startsWith('mqtts://');
        this.tlsOptions = this.isTLS ? this.prepareTLSOptions() : {};
        
        console.log(`🔗 Primary MQTT Host: ${this.host} (TLS: ${this.isTLS})`);
        if (this.co2Host) {
            console.log(`🔗 Secondary MQTT Host (CO2): ${this.co2Host}`);
        }
    }

    prepareTLSOptions() {
        try {
            const caCertPath = process.env.MQTT_CA_CERT_PATH;
            const possiblePaths = [
                caCertPath,
                './src/mqtt/Connection/broker (1).crt',
                './src/mqtt/broker.crt',
                path.join(__dirname, 'broker (1).crt'),
            ];

            let validCertPath = null;
            for (const certPath of possiblePaths) {
                if (certPath && fs.existsSync(certPath)) {
                    validCertPath = certPath;
                    console.log(`✅ Found TLS certificate at: ${certPath}`);
                    break;
                }
            }

            if (!validCertPath) {
                console.warn(`⚠️ No TLS certificate found, will try connection without CA verification`);
                // Still return TLS options but without CA - allows self-signed certs
                return {
                    rejectUnauthorized: false,
                    secureProtocol: 'TLSv1_2_method',
                    checkServerIdentity: () => undefined,
                    requestCert: false,
                    agent: false
                };
            }

            return {
                ca: fs.readFileSync(validCertPath),
                rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true',
                secureProtocol: 'TLSv1_2_method',
                checkServerIdentity: () => undefined,
                requestCert: false,
                agent: false
            };
        } catch (error) {
            console.warn('⚠️ TLS configuration error:', error.message);
            // Return minimal TLS options to still attempt secure connection
            return {
                rejectUnauthorized: false,
                checkServerIdentity: () => undefined
            };
        }
    }

    connect(onConnectCallback, onMessageCallback, onErrorCallback) {
        // Connect to primary broker
        const connectOptions = {
            clientId: `backend-server-${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 60,
            clean: true,
            username: process.env.MQTT_USERNAME || "admin",
            password: process.env.MQTT_PASSWORD || "StrongPassword123",
            connectTimeout: 30000,
            reconnectPeriod: 5000,
            protocolVersion: 4,
            ...(this.isTLS ? this.tlsOptions : {})
        };

        console.log(`🔗 Connecting to primary MQTT broker: ${this.host}`);
        console.log(`🔐 TLS enabled: ${this.isTLS}, TLS options keys: ${Object.keys(this.tlsOptions).join(', ') || 'none'}`);
        
        this.mqttClient = mqtt.connect(this.host, connectOptions);

        this.mqttClient.on("connect", () => {
            console.log("🌐 Primary MQTT Connected!");
            if (onConnectCallback) onConnectCallback(this.mqttClient);
        });

        this.mqttClient.on("message", onMessageCallback);
        this.mqttClient.on("error", (err) => {
            // Only log connection errors once, not on every reconnect attempt
            if (!this._primaryErrorLogged) {
                console.error("❌ Primary MQTT Error:", err.message);
                console.warn("⚠️  Primary broker may be unreachable. Other sensors (temp, humidity, etc.) won't work until it's available.");
                this._primaryErrorLogged = true;
            }
            if (onErrorCallback) onErrorCallback(err);
        });
        this.mqttClient.on("offline", () => {
            if (!this._primaryOfflineLogged) {
                console.warn("📴 Primary MQTT offline - will keep trying to reconnect");
                this._primaryOfflineLogged = true;
            }
        });
        this.mqttClient.on("reconnect", () => {
            // Reset error flags on reconnect attempt
            this._primaryErrorLogged = false;
            this._primaryOfflineLogged = false;
        });
        this.mqttClient.on("connect", () => {
            // Reset flags on successful connection
            this._primaryErrorLogged = false;
            this._primaryOfflineLogged = false;
        });

        // Connect to secondary broker for CO2 if configured
        if (this.co2Host) {
            this.connectCO2Broker(onMessageCallback, onErrorCallback);
        }

        return this.mqttClient;
    }

    connectCO2Broker(onMessageCallback, onErrorCallback) {
        const co2Options = {
            clientId: `backend-co2-${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 60,
            clean: true,
            username: process.env.MQTT_USERNAME_CO2 || process.env.MQTT_USERNAME || "admin",
            password: process.env.MQTT_PASSWORD_CO2 || process.env.MQTT_PASSWORD || "StrongPassword123",
            connectTimeout: 30000,
            reconnectPeriod: 2000,
            protocolVersion: 4
        };

        console.log(`🔗 Connecting to CO2 MQTT broker: ${this.co2Host}`);
        this.co2Client = mqtt.connect(this.co2Host, co2Options);

        this.co2Client.on("connect", () => {
            console.log("🌐 CO2 MQTT Connected!");
            
            // Subscribe to CO2 topic
            this.co2Client.subscribe("CO2", { qos: 1 }, (err) => {
                if (err) {
                    console.error("❌ Failed to subscribe to CO2:", err.message);
                } else {
                    console.log("✅ Subscribed to CO2 topic on secondary broker");
                }
            });

            // Subscribe to sonar (level) topic
            this.co2Client.subscribe("level", { qos: 1 }, (err) => {
                if (err) {
                    console.error("❌ Failed to subscribe to level:", err.message);
                } else {
                    console.log("✅ Subscribed to level (sonar) topic on secondary broker");
                }
            });
        });

        this.co2Client.on("message", (topic, message) => {
            console.log(`📨 [CO2 Broker] Topic: "${topic}" | Payload: "${message.toString()}"`);
            onMessageCallback(topic, message);
        });

        this.co2Client.on("error", (err) => {
            console.error("❌ CO2 MQTT Error:", err.message);
        });
        this.co2Client.on("offline", () => console.warn("📴 CO2 MQTT offline"));
        this.co2Client.on("reconnect", () => console.log("🔄 CO2 MQTT Reconnecting..."));
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
            this.mqttClient.end();
            console.log("🔌 Primary MQTT disconnected");
        }
        if (this.co2Client?.connected) {
            this.co2Client.end();
            console.log("🔌 CO2 MQTT disconnected");
        }
    }
}

module.exports = MqttConnection;
