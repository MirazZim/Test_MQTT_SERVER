// find-mqtt-broker.js
// Helper script to test MQTT broker connectivity

const mqtt = require('mqtt');

console.log('\n🔍 MQTT Broker Connection Tester\n');
console.log('This script will help you find the correct MQTT broker URL.\n');

// Test configurations to try
const testConfigs = [
    {
        name: 'Local MQTT (unencrypted)',
        url: 'mqtt://192.168.88.221:1883',
        username: 'admin',
        password: 'StrongPassword123'
    },
    {
        name: 'Local MQTT (encrypted)',
        url: 'mqtts://192.168.88.221:8883',
        username: 'admin',
        password: 'StrongPassword123'
    },
    {
        name: 'Public HiveMQ Broker (test)',
        url: 'mqtt://broker.hivemq.com:1883',
        username: null,
        password: null
    }
];

async function testConnection(config) {
    return new Promise((resolve) => {
        console.log(`\n📡 Testing: ${config.name}`);
        console.log(`   URL: ${config.url}`);
        
        const options = {
            clientId: `test-client-${Math.random().toString(16).substr(2, 8)}`,
            connectTimeout: 5000,
            reconnectPeriod: 0, // Disable auto-reconnect for testing
        };

        if (config.username) {
            options.username = config.username;
            options.password = config.password;
            console.log(`   Username: ${config.username}`);
        }

        const client = mqtt.connect(config.url, options);

        const timeout = setTimeout(() => {
            console.log('   ❌ Connection timeout (5s)');
            client.end(true);
            resolve({ success: false, config, error: 'Timeout' });
        }, 5000);

        client.on('connect', () => {
            clearTimeout(timeout);
            console.log('   ✅ Connected successfully!');
            
            // Try to subscribe to a test topic
            client.subscribe('test/connection', { qos: 1 }, (err) => {
                if (err) {
                    console.log('   ⚠️ Subscribe failed:', err.message);
                } else {
                    console.log('   ✅ Subscribe successful');
                }
                
                client.end();
                resolve({ success: true, config });
            });
        });

        client.on('error', (error) => {
            clearTimeout(timeout);
            console.log('   ❌ Connection error:', error.message);
            client.end(true);
            resolve({ success: false, config, error: error.message });
        });
    });
}

async function runTests() {
    console.log('Starting connection tests...\n');
    console.log('='.repeat(60));

    const results = [];

    for (const config of testConfigs) {
        const result = await testConnection(config);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between tests
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Test Results Summary:\n');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
        console.log('✅ Successful Connections:');
        successful.forEach(r => {
            console.log(`   - ${r.config.name}`);
            console.log(`     URL: ${r.config.url}`);
        });
        console.log('');
    }

    if (failed.length > 0) {
        console.log('❌ Failed Connections:');
        failed.forEach(r => {
            console.log(`   - ${r.config.name}`);
            console.log(`     Error: ${r.error}`);
        });
        console.log('');
    }

    if (successful.length > 0) {
        console.log('💡 Recommendation:');
        console.log(`   Update your .env file with:`);
        console.log(`   MQTT_HOST=${successful[0].config.url}`);
        if (successful[0].config.username) {
            console.log(`   MQTT_USERNAME=${successful[0].config.username}`);
            console.log(`   MQTT_PASSWORD=${successful[0].config.password}`);
        }
        console.log('');
    } else {
        console.log('⚠️ No successful connections found!');
        console.log('');
        console.log('Possible issues:');
        console.log('   1. MQTT broker is not running');
        console.log('   2. Firewall blocking connection');
        console.log('   3. Wrong IP address or port');
        console.log('   4. Wrong credentials');
        console.log('');
        console.log('Next steps:');
        console.log('   1. Verify MQTT broker is running on 192.168.88.221');
        console.log('   2. Check firewall settings');
        console.log('   3. Try connecting with MQTT Explorer or mosquitto_sub');
        console.log('');
    }

    process.exit(0);
}

// Custom test - if you know your broker details
console.log('💡 Tip: Edit this file to add your custom broker configuration\n');

runTests();
