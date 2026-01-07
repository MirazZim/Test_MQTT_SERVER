// Test script to verify MQTT messages are being received
const mqtt = require("mqtt");
const fs = require("fs");
require('dotenv').config();

const host = process.env.MQTT_HOST || "mqtts://192.168.88.221:8883";
const isTLS = host.startsWith('mqtts://');

let tlsOptions = {};
if (isTLS) {
    const certPaths = [
        './src/mqtt/Connection/broker (1).crt',
        './src/mqtt/broker.crt'
    ];
    
    for (const certPath of certPaths) {
        if (fs.existsSync(certPath)) {
            tlsOptions = {
                ca: fs.readFileSync(certPath),
                rejectUnauthorized: false,
                checkServerIdentity: () => undefined
            };
            console.log(`✅ Using certificate: ${certPath}`);
            break;
        }
    }
}

const client = mqtt.connect(host, {
    clientId: `test-receiver-${Date.now()}`,
    keepalive: 60,
    clean: true,
    username: process.env.MQTT_USERNAME || "admin",
    password: process.env.MQTT_PASSWORD || "StrongPassword123",
    ...tlsOptions
});

// Track message counts
const messageCounts = {};
const startTime = Date.now();

client.on("connect", () => {
    console.log(`\n🌐 Connected to MQTT broker: ${host}`);
    console.log(`📡 Subscribing to all topics...\n`);
    
    // Subscribe to all sensor topics
    const topics = ['level', 'CO2', 'ESPX', 'ESP2X', 'ds18', 'auto', 'airflow', '#'];
    
    topics.forEach(topic => {
        client.subscribe(topic, { qos: 1 }, (err) => {
            if (!err) {
                console.log(`✅ Subscribed to: ${topic}`);
            }
        });
    });
    
    console.log(`\n⏱️  Listening for messages... (Press Ctrl+C to stop)\n`);
    console.log(`${'='.repeat(80)}`);
});

client.on("message", (topic, message) => {
    const payload = message.toString();
    const now = new Date().toISOString();
    
    // Count messages per topic
    messageCounts[topic] = (messageCounts[topic] || 0) + 1;
    
    // Highlight sonar/level topic
    const highlight = topic === 'level' ? '🔴 SONAR → ' : '';
    
    console.log(`${highlight}[${now}] Topic: "${topic}" | Value: ${payload} | Count: ${messageCounts[topic]}`);
});

client.on("error", (err) => {
    console.error("❌ MQTT Error:", err.message);
});

// Print summary on exit
process.on('SIGINT', () => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📊 Summary (${duration}s):\n`);
    
    Object.entries(messageCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([topic, count]) => {
            const rate = (count / (duration / 60)).toFixed(1);
            console.log(`   ${topic}: ${count} messages (${rate}/min)`);
        });
    
    console.log(`\n`);
    client.end();
    process.exit(0);
});
