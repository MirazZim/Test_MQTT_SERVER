// src/mqtt/connection/MqttConnection.js
const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");

class MqttConnection {
    constructor() {
        this.mqttClient = null;
        this.co2Client = null;
        this.host = process.env.MQTT_HOST || "mqtts://192.168.88.221:8883";
        this.co2Host = process.env.MQTT_HOST_CO2;
        this.isTLS = this.host.startsWith('mqtts://');
        this.tlsOptions = this.isTLS ? this.prepareTLSOptions() : {};

        // Diagnostic tracking
        this.co2MessageCount = 0;
        this.co2LastMessage = null;

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
            return {
                rejectUnauthorized: false,
                checkServerIdentity: () => undefined
            };
        }
    }

    connect(onConnectCallback, onMessageCallback, onErrorCallback) {
        const connectOptions = {
            clientId: `backend-primary-${Date.now()}-${Math.random().toString(16).substr(2, 8)}`,
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
            this._primaryErrorLogged = false;
            this._primaryOfflineLogged = false;
        });
        this.mqttClient.on("connect", () => {
            this._primaryErrorLogged = false;
            this._primaryOfflineLogged = false;
        });

        // CO2 is now handled by standalone CO2SensorHandler
        // Keeping this disabled to avoid duplicate subscriptions
        // if (this.co2Host) {
        //     console.log(`🔗 Connecting to CO2 broker: ${this.co2Host}`);
        //     this.connectCO2Broker(onMessageCallback, onErrorCallback);
        // }

        return this.mqttClient;
    }

    connectCO2Broker(onMessageCallback, onErrorCallback) {
        // Use same client ID pattern as working test script (js_sub_xxx)
        const co2Options = {
            clientId: `js_sub_${Date.now()}_${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 30,              // Match test script
            clean: true,
            username: process.env.MQTT_USERNAME_CO2 || process.env.MQTT_USERNAME || "admin",
            password: process.env.MQTT_PASSWORD_CO2 || process.env.MQTT_PASSWORD || "StrongPassword123",
            connectTimeout: 30000,
            reconnectPeriod: 5000,      // Match test script
            protocolVersion: 4,
            resubscribe: true,          // Match test script
            reschedulePings: true       // Match test script
        };

        console.log(`🔗 Connecting to CO2 MQTT broker: ${this.co2Host}`);
        console.log(`🔗 CO2 broker credentials: user=${co2Options.username}`);
        this.co2Client = mqtt.connect(this.co2Host, co2Options);

        this.co2Client.on("connect", () => {
            console.log("🌐 CO2 MQTT Connected!");
            console.log(`🌐 CO2 Client ID: ${this.co2Client.options.clientId}`);

            const topics = ["CO2", "level"];
            console.log(`📡 Subscribing to topics: ${topics.join(", ")}`);

            this.co2Client.subscribe(topics, { qos: 1 }, (err, granted) => {
                if (err) {
                    console.error("❌ Failed to subscribe to CO2/level topics:", err.message);
                } else {
                    console.log("✅ Subscribed to CO2 and level topics on secondary broker");
                    console.log(`✅ Subscriptions granted:`, JSON.stringify(granted));

                    granted.forEach(g => {
                        console.log(`   📡 Topic: "${g.topic}" → QoS: ${g.qos}`);
                    });
                }
            });
        });

        this.co2Client.on("message", (topic, message) => {
            const payload = message.toString();
            const now = new Date().toISOString();

            // Update diagnostics
            this.co2MessageCount++;
            this.co2LastMessage = { topic, payload, timestamp: now };

            console.log(`📨 [CO2 Broker] #${this.co2MessageCount} Topic: "${topic}" | Payload: "${payload}" | Time: ${now}`);

            try {
                onMessageCallback(topic, message);
                console.log(`📨 [CO2 Broker] Message handler completed successfully`);
            } catch (err) {
                console.error(`❌ [CO2 Broker] Error in message handler:`, err.message);
                console.error(`❌ [CO2 Broker] Stack:`, err.stack);
            }
        });

        this.co2Client.on("error", (err) => {
            console.error("❌ CO2 MQTT Error:", err.message);
            console.error("❌ CO2 MQTT Error details:", err);
            if (onErrorCallback) onErrorCallback(err);
        });

        this.co2Client.on("offline", () => {
            console.warn("📴 CO2 MQTT offline");
            console.warn(`📴 Last message was: ${JSON.stringify(this.co2LastMessage)}`);
        });

        this.co2Client.on("reconnect", () => {
            console.log("🔄 CO2 MQTT Reconnecting...");
        });

        this.co2Client.on("close", () => {
            console.warn("🔌 CO2 MQTT connection closed");
            console.warn(`🔌 Total messages received before close: ${this.co2MessageCount}`);
        });

        this.co2Client.on("disconnect", () => {
            console.warn("🔌 CO2 MQTT disconnected");
        });

        // Enhanced debug: Log connection status every 10 seconds
        setInterval(() => {
            if (this.co2Client) {
                const stats = {
                    connected: this.co2Client.connected,
                    reconnecting: this.co2Client.reconnecting,
                    totalMessages: this.co2MessageCount,
                    lastMessage: this.co2LastMessage,
                    clientId: this.co2Client.options?.clientId
                };
                console.log(`🔍 [CO2 Debug] Status:`, JSON.stringify(stats, null, 2));

                // Alert if no messages in last 15 seconds
                if (this.co2LastMessage) {
                    const lastMsgTime = new Date(this.co2LastMessage.timestamp).getTime();
                    const timeSinceLastMsg = Date.now() - lastMsgTime;
                    if (timeSinceLastMsg > 15000) {
                        console.warn(`⚠️ [CO2 Debug] No messages for ${Math.round(timeSinceLastMsg / 1000)}s`);
                    }
                }
            }
        }, 10000);
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
            console.log(`🔌 CO2 MQTT disconnecting (received ${this.co2MessageCount} messages total)`);
            this.co2Client.end();
            console.log("🔌 CO2 MQTT disconnected");
        }
    }

    // Get diagnostic info
    getCO2Stats() {
        return {
            connected: this.co2Client?.connected || false,
            totalMessages: this.co2MessageCount,
            lastMessage: this.co2LastMessage,
            clientId: this.co2Client?.options?.clientId
        };
    }
}

module.exports = MqttConnection;