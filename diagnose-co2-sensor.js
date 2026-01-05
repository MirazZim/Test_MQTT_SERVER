// diagnose-co2-sensor.js
// Diagnostic tool to help configure your CO2 sensor

require('dotenv').config();
const mqtt = require('mqtt');

console.log('\n🔍 CO2 Sensor Diagnostic Tool\n');
console.log('This tool will help you understand what your CO2 sensor is sending.\n');

// MQTT Configuration
const MQTT_HOST = process.env.MQTT_HOST || 'mqtt://192.168.88.221:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'admin';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'StrongPassword123';
const CO2_TOPIC = 'CO2';  // Your CO2 sensor topic

console.log('📡 MQTT Configuration:');
console.log(`   Host: ${MQTT_HOST}`);
console.log(`   Username: ${MQTT_USERNAME}`);
console.log(`   Topic: ${CO2_TOPIC}\n`);

// Check if MQTT_HOST is valid
if (!MQTT_HOST.startsWith('mqtt://') && !MQTT_HOST.startsWith('mqtts://')) {
    console.error('❌ ERROR: MQTT_HOST must start with mqtt:// or mqtts://');
    console.error(`   Current value: ${MQTT_HOST}`);
    console.error('\n💡 Fix your .env file first:');
    console.error('   MQTT_HOST=mqtt://192.168.88.221:1883');
    console.error('   or');
    console.error('   MQTT_HOST=mqtts://192.168.88.221:8883\n');
    process.exit(1);
}

const client = mqtt.connect(MQTT_HOST, {
    clientId: `co2-diagnostic-${Math.random().toString(16).substr(2, 8)}`,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    keepalive: 60,
    clean: true,
    reconnectPeriod: 2000
});

let messageCount = 0;
let validDataCount = 0;
let invalidDataCount = 0;
const receivedMessages = [];

client.on('connect', () => {
    console.log('✅ Connected to MQTT broker\n');
    console.log(`📡 Subscribing to topic: ${CO2_TOPIC}`);
    
    client.subscribe(CO2_TOPIC, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Failed to subscribe:', err.message);
            process.exit(1);
        }
        
        console.log('✅ Subscribed successfully\n');
        console.log('🎧 Listening for CO2 data...');
        console.log('   (Press Ctrl+C to stop)\n');
        console.log('='.repeat(80));
    });
});

client.on('message', (topic, message) => {
    messageCount++;
    const payload = message.toString();
    const timestamp = new Date().toISOString();
    const value = parseFloat(payload);
    
    console.log(`\n📨 Message #${messageCount} at ${timestamp}`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Payload: "${payload}"`);
    console.log(`   Length: ${payload.length} bytes`);
    
    if (Number.isFinite(value)) {
        validDataCount++;
        console.log(`   ✅ VALID: Numeric value = ${value} ppm`);
        receivedMessages.push({ timestamp, payload, value, valid: true });
    } else {
        invalidDataCount++;
        console.log(`   ❌ INVALID: Not a number`);
        
        // Check if it's a command echo
        const upperPayload = payload.toUpperCase().trim();
        if (['GET', 'READ', 'STATUS', '?', ''].includes(upperPayload)) {
            console.log(`   ⚠️  This looks like a command echo!`);
            console.log(`   💡 Your sensor is echoing back commands instead of sending data`);
        }
        
        receivedMessages.push({ timestamp, payload, value: null, valid: false });
    }
    
    console.log('='.repeat(80));
});

client.on('error', (error) => {
    console.error('\n❌ MQTT Error:', error.message);
    process.exit(1);
});

client.on('close', () => {
    console.log('\n🔌 Connection closed');
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n📊 Diagnostic Summary:');
    console.log('='.repeat(80));
    console.log(`Total messages received: ${messageCount}`);
    console.log(`Valid CO2 readings: ${validDataCount} (${messageCount > 0 ? Math.round(validDataCount/messageCount*100) : 0}%)`);
    console.log(`Invalid messages: ${invalidDataCount} (${messageCount > 0 ? Math.round(invalidDataCount/messageCount*100) : 0}%)`);
    
    if (validDataCount > 0) {
        console.log('\n✅ Good news! Your sensor IS sending valid data.');
        console.log('   The backend should be receiving and storing this data.');
        
        const validMessages = receivedMessages.filter(m => m.valid);
        if (validMessages.length > 1) {
            const times = validMessages.map(m => new Date(m.timestamp).getTime());
            const intervals = [];
            for (let i = 1; i < times.length; i++) {
                intervals.push(times[i] - times[i-1]);
            }
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            console.log(`   Average interval: ${Math.round(avgInterval)}ms (${(1000/avgInterval).toFixed(1)} readings/sec)`);
        }
        
        console.log('\n   Recent valid readings:');
        validMessages.slice(-5).forEach((m, i) => {
            console.log(`   ${i+1}. ${m.value.toFixed(2)} ppm at ${m.timestamp}`);
        });
    } else if (invalidDataCount > 0) {
        console.log('\n⚠️  Problem detected: Only receiving invalid data');
        console.log('\n   Possible causes:');
        console.log('   1. Sensor is echoing back commands (GET, READ, etc.)');
        console.log('   2. Sensor is not configured to auto-publish data');
        console.log('   3. Sensor firmware needs updating');
        
        console.log('\n   💡 Solutions:');
        console.log('   1. Check your sensor configuration/firmware');
        console.log('   2. Look for "auto-publish" or "periodic send" settings');
        console.log('   3. Disable "echo" or "command response" mode');
        console.log('   4. Set sensor to publish data every 1 second automatically');
        
        console.log('\n   Recent invalid messages:');
        receivedMessages.filter(m => !m.valid).slice(-5).forEach((m, i) => {
            console.log(`   ${i+1}. "${m.payload}" at ${m.timestamp}`);
        });
    } else {
        console.log('\n⚠️  No messages received from CO2 sensor!');
        console.log('\n   Possible causes:');
        console.log('   1. Sensor is not connected to MQTT broker');
        console.log('   2. Sensor is publishing to a different topic');
        console.log('   3. Sensor is not powered on');
        console.log('   4. Network connectivity issues');
        
        console.log('\n   💡 Next steps:');
        console.log('   1. Check if sensor is powered on and connected');
        console.log('   2. Verify sensor is configured to publish to topic: "CO2"');
        console.log('   3. Check MQTT broker logs');
        console.log('   4. Use MQTT Explorer to see all topics');
    }
    
    console.log('\n='.repeat(80));
    console.log('\n👋 Diagnostic complete. Disconnecting...\n');
    
    client.end();
    process.exit(0);
});

// Auto-exit after 60 seconds if no Ctrl+C
setTimeout(() => {
    console.log('\n⏱️  60 seconds elapsed. Auto-stopping diagnostic...');
    process.emit('SIGINT');
}, 60000);
