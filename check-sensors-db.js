// Check sensor configuration in database
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSensors() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('🔍 Checking sensor configuration...\n');

    try {
        // Get all sensors with their types
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
            ORDER BY st.type_code
        `);

        console.log('📊 All Sensors in Database:\n');
        console.log('='.repeat(100));

        sensors.forEach(s => {
            const status = s.is_active ? '✅ ACTIVE' : '❌ INACTIVE';
            console.log(`${status} | ID: ${s.id} | Type: ${s.type_code} | Topic: "${s.mqtt_topic}" | Name: ${s.sensor_name}`);
            console.log(`         | User: ${s.user_id} | Room: ${s.room_code || s.room_name || 'N/A'} | Unit: ${s.unit || 'N/A'}`);
            console.log('-'.repeat(100));
        });

        // Find CO2 sensor specifically
        console.log('\n🔍 CO2 Sensor Details:\n');
        const co2Sensors = sensors.filter(s => s.type_code === 'co2_level' || s.mqtt_topic === 'CO2');

        if (co2Sensors.length === 0) {
            console.log('❌ NO CO2 SENSOR FOUND IN DATABASE!');
            console.log('   This is likely the problem - the sensor is not registered.');
        } else {
            co2Sensors.forEach(s => {
                console.log(`Found CO2 sensor:`);
                console.log(`  ID: ${s.id}`);
                console.log(`  Name: ${s.sensor_name}`);
                console.log(`  Topic: "${s.mqtt_topic}"`);
                console.log(`  Type Code: ${s.type_code}`);
                console.log(`  Active: ${s.is_active ? 'YES' : 'NO'}`);
                console.log(`  User ID: ${s.user_id}`);
                console.log(`  Room: ${s.room_code || s.room_name || 'N/A'}`);
            });
        }

        // Compare with other sensors
        console.log('\n📊 Comparison - How other sensors are configured:\n');
        const otherSensors = sensors.filter(s => s.type_code !== 'co2_level' && s.is_active);

        if (otherSensors.length > 0) {
            console.log('Working sensors (for reference):');
            otherSensors.slice(0, 5).forEach(s => {
                console.log(`  • ${s.type_code}: Topic="${s.mqtt_topic}", User=${s.user_id}, Room=${s.room_code || s.room_name}`);
            });
        }

        // Check recent measurements
        console.log('\n📈 Recent Measurements (last 10):\n');
        const [measurements] = await pool.execute(`
            SELECT 
                sm.id,
                sm.sensor_id,
                sm.measured_value,
                sm.measured_at,
                s.sensor_name,
                st.type_code
            FROM sensor_measurements sm
            JOIN sensors s ON sm.sensor_id = s.id
            JOIN sensor_types st ON s.sensor_type_id = st.id
            ORDER BY sm.measured_at DESC
            LIMIT 10
        `);

        measurements.forEach(m => {
            const time = new Date(m.measured_at).toISOString();
            console.log(`  ${time} | ${m.type_code}: ${m.measured_value} | Sensor: ${m.sensor_name}`);
        });

        // Check CO2 measurements specifically
        console.log('\n📈 Recent CO2 Measurements:\n');
        const [co2Measurements] = await pool.execute(`
            SELECT 
                sm.id,
                sm.measured_value,
                sm.measured_at
            FROM sensor_measurements sm
            JOIN sensors s ON sm.sensor_id = s.id
            JOIN sensor_types st ON s.sensor_type_id = st.id
            WHERE st.type_code = 'co2_level'
            ORDER BY sm.measured_at DESC
            LIMIT 10
        `);

        if (co2Measurements.length === 0) {
            console.log('❌ NO CO2 MEASUREMENTS FOUND!');
        } else {
            co2Measurements.forEach(m => {
                const time = new Date(m.measured_at).toISOString();
                console.log(`  ${time} | CO2: ${m.measured_value} ppm`);
            });
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkSensors();
