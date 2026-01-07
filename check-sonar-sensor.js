// Check sonar sensor configuration in database
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSonarSensor() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('🔍 Checking SONAR sensor configuration...\n');

    try {
        // Get all sonar-related sensors
        const [sensors] = await pool.execute(`
            SELECT 
                s.id,
                s.sensor_name,
                s.mqtt_topic,
                s.is_active,
                s.user_id,
                s.room_id,
                st.type_code,
                st.type_name,
                st.unit,
                r.room_code,
                r.room_name
            FROM sensors s
            JOIN sensor_types st ON s.sensor_type_id = st.id
            LEFT JOIN rooms r ON s.room_id = r.id
            WHERE st.type_code LIKE '%sonar%' 
               OR s.mqtt_topic LIKE '%sonar%'
               OR s.sensor_name LIKE '%sonar%'
               OR s.sensor_name LIKE '%distance%'
            ORDER BY s.id
        `);

        console.log('📊 Sonar Sensors Found:\n');
        console.log('='.repeat(100));

        if (sensors.length === 0) {
            console.log('❌ NO SONAR SENSOR FOUND IN DATABASE!');
        } else {
            sensors.forEach(s => {
                const status = s.is_active ? '✅ ACTIVE' : '❌ INACTIVE';
                console.log(`${status} | ID: ${s.id} | Type: ${s.type_code} | Topic: "${s.mqtt_topic}"`);
                console.log(`         | Name: ${s.sensor_name}`);
                console.log(`         | User: ${s.user_id} | Room: ${s.room_code || s.room_name || 'N/A'} | Unit: ${s.unit || 'N/A'}`);
                console.log('-'.repeat(100));
            });
        }

        // Check recent sonar measurements
        console.log('\n📈 Recent Sonar Measurements (last 10):\n');
        const [measurements] = await pool.execute(`
            SELECT 
                sm.id,
                sm.sensor_id,
                sm.measured_value,
                sm.measured_at,
                s.sensor_name,
                s.mqtt_topic,
                st.type_code
            FROM sensor_measurements sm
            JOIN sensors s ON sm.sensor_id = s.id
            JOIN sensor_types st ON s.sensor_type_id = st.id
            WHERE st.type_code LIKE '%sonar%' 
               OR s.mqtt_topic LIKE '%sonar%'
            ORDER BY sm.measured_at DESC
            LIMIT 10
        `);

        if (measurements.length === 0) {
            console.log('❌ NO SONAR MEASUREMENTS FOUND!');
        } else {
            measurements.forEach(m => {
                const time = new Date(m.measured_at).toISOString();
                console.log(`  ${time} | ${m.type_code}: ${m.measured_value} | Topic: ${m.mqtt_topic}`);
            });
        }

        // Show all sensor types for reference
        console.log('\n📋 All Sensor Types in Database:\n');
        const [types] = await pool.execute(`SELECT * FROM sensor_types ORDER BY type_code`);
        types.forEach(t => {
            console.log(`  • ${t.type_code}: ${t.type_name} (${t.unit || 'no unit'})`);
        });

        // Show all active sensors with their topics
        console.log('\n📡 All Active Sensors with MQTT Topics:\n');
        const [allSensors] = await pool.execute(`
            SELECT s.id, s.sensor_name, s.mqtt_topic, st.type_code
            FROM sensors s
            JOIN sensor_types st ON s.sensor_type_id = st.id
            WHERE s.is_active = 1 AND s.mqtt_topic IS NOT NULL
            ORDER BY s.mqtt_topic
        `);
        
        allSensors.forEach(s => {
            console.log(`  Topic: "${s.mqtt_topic}" → ${s.type_code} (ID: ${s.id})`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkSonarSensor();
