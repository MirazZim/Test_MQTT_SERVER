// test-co2-polling.js
// Quick test script to verify CO2 polling service

require('dotenv').config();
const pool = require('./src/config/db');

async function testCO2Setup() {
    console.log('\n🔍 Testing CO2 Sensor Setup...\n');

    try {
        // 1. Check database connection
        console.log('1️⃣ Testing database connection...');
        const [dbTest] = await pool.execute('SELECT 1 as test');
        console.log('   ✅ Database connected\n');

        // 2. Check for CO2 sensors
        console.log('2️⃣ Checking for CO2 sensors...');
        const [sensors] = await pool.execute(
            `SELECT s.id, s.sensor_name, s.mqtt_topic, s.is_active,
                    st.type_code, st.type_name,
                    r.room_code, r.room_name, u.username
             FROM sensors s
             LEFT JOIN sensor_types st ON s.sensor_type_id = st.id
             LEFT JOIN rooms r ON s.room_id = r.id
             LEFT JOIN users u ON s.user_id = u.id
             WHERE st.type_code = 'co2_level'`
        );

        if (sensors.length === 0) {
            console.log('   ⚠️ No CO2 sensors found in database!');
            console.log('   💡 You need to create a CO2 sensor first.\n');
            
            // Show how to create one
            console.log('   To create a CO2 sensor, you need:');
            console.log('   - A sensor_type with type_code = "co2_level"');
            console.log('   - A sensor record with mqtt_topic set\n');
        } else {
            console.log(`   ✅ Found ${sensors.length} CO2 sensor(s):\n`);
            sensors.forEach((sensor, index) => {
                console.log(`   ${index + 1}. ${sensor.sensor_name}`);
                console.log(`      - ID: ${sensor.id}`);
                console.log(`      - MQTT Topic: ${sensor.mqtt_topic || '❌ NOT SET'}`);
                console.log(`      - Active: ${sensor.is_active ? '✅ Yes' : '❌ No'}`);
                console.log(`      - Room: ${sensor.room_name || 'N/A'} (${sensor.room_code || 'N/A'})`);
                console.log(`      - User: ${sensor.username || 'N/A'}`);
                console.log('');
            });
        }

        // 3. Check recent measurements
        console.log('3️⃣ Checking recent CO2 measurements...');
        const [measurements] = await pool.execute(
            `SELECT sm.id, sm.sensor_id, sm.measured_value, sm.measured_at,
                    s.sensor_name, s.mqtt_topic
             FROM sensor_measurements sm
             JOIN sensors s ON sm.sensor_id = s.id
             JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE st.type_code = 'co2_level'
             ORDER BY sm.measured_at DESC
             LIMIT 5`
        );

        if (measurements.length === 0) {
            console.log('   ⚠️ No CO2 measurements found\n');
        } else {
            console.log(`   ✅ Found ${measurements.length} recent measurement(s):\n`);
            measurements.forEach((m, index) => {
                const timeAgo = Math.round((Date.now() - new Date(m.measured_at).getTime()) / 1000);
                console.log(`   ${index + 1}. ${m.sensor_name}: ${m.measured_value} ppm`);
                console.log(`      - Time: ${m.measured_at} (${timeAgo}s ago)`);
                console.log(`      - Topic: ${m.mqtt_topic}`);
                console.log('');
            });
        }

        // 4. Check MQTT configuration
        console.log('4️⃣ Checking MQTT configuration...');
        console.log(`   - MQTT_HOST: ${process.env.MQTT_HOST}`);
        console.log(`   - MQTT_USERNAME: ${process.env.MQTT_USERNAME || 'NOT SET'}`);
        console.log(`   - MQTT_PASSWORD: ${process.env.MQTT_PASSWORD ? '***' : 'NOT SET'}`);
        
        if (!process.env.MQTT_HOST.startsWith('mqtt://') && !process.env.MQTT_HOST.startsWith('mqtts://')) {
            console.log('\n   ⚠️ WARNING: MQTT_HOST should start with mqtt:// or mqtts://');
            console.log('   Current value looks like an HTTP URL, not MQTT!');
            console.log('   Example: mqtt://192.168.88.221:1883 or mqtts://192.168.88.221:8883\n');
        } else {
            console.log('   ✅ MQTT_HOST format looks correct\n');
        }

        console.log('✅ Test completed!\n');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

testCO2Setup();
