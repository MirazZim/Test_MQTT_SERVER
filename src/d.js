// diagnostic/checkSensorRegistration.js
// Run this to verify your sensor setup is correct

const mysql = require('mysql2/promise');
require('dotenv').config();

const checkSensorRegistration = async () => {
    let connection;

    try {
        // Connect to database
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('✅ Connected to database\n');

        // 1. Check all users
        console.log('========== USERS ==========');
        const [users] = await connection.execute(
            'SELECT id, username, role, is_active FROM users'
        );
        console.log(`Found ${users.length} users:`);
        users.forEach(u => {
            console.log(`  - User ${u.id}: ${u.username} (${u.role}) ${u.is_active ? '🟢' : '🔴'}`);
        });
        console.log('');

        // 2. Check rooms
        console.log('========== ROOMS ==========');
        const [rooms] = await connection.execute(`
            SELECT r.id, r.user_id, r.room_code, r.room_name, r.is_active,
                   COUNT(s.id) as sensor_count
            FROM rooms r
            LEFT JOIN sensors s ON r.id = s.room_id AND s.is_active = 1
            GROUP BY r.id
            ORDER BY r.user_id, r.room_code
        `);
        console.log(`Found ${rooms.length} rooms:`);
        rooms.forEach(r => {
            console.log(`  - Room ${r.id}: ${r.room_code} (${r.room_name}) - User ${r.user_id} - ${r.sensor_count} sensors ${r.is_active ? '🟢' : '🔴'}`);
        });
        console.log('');

        // 3. Check sensor types
        console.log('========== SENSOR TYPES ==========');
        const [sensorTypes] = await connection.execute(
            'SELECT id, type_code, type_name, unit, is_system_type FROM sensor_types ORDER BY display_order'
        );
        console.log(`Found ${sensorTypes.length} sensor types:`);
        sensorTypes.forEach(st => {
            console.log(`  - ${st.type_code} (${st.type_name}) - Unit: ${st.unit} ${st.is_system_type ? '🔧' : ''}`);
        });
        console.log('');

        // 4. Check sensors per user
        console.log('========== SENSORS BY USER ==========');
        for (const user of users) {
            const [userSensors] = await connection.execute(`
                SELECT 
                    s.id,
                    s.sensor_code,
                    s.sensor_name,
                    st.type_code,
                    r.room_code,
                    s.mqtt_topic,
                    s.is_active,
                    s.last_reading_at,
                    TIMESTAMPDIFF(SECOND, s.last_reading_at, NOW()) as seconds_since_reading
                FROM sensors s
                JOIN sensor_types st ON s.sensor_type_id = st.id
                LEFT JOIN rooms r ON s.room_id = r.id
                WHERE s.user_id = ?
                ORDER BY st.type_code, s.sensor_code
            `, [user.id]);

            console.log(`\nUser ${user.id} (${user.username}) - ${userSensors.length} sensors:`);

            if (userSensors.length === 0) {
                console.log('  ⚠️ NO SENSORS FOUND - This user has no sensors!');
            }

            userSensors.forEach(s => {
                const status = s.is_active ? '🟢' : '🔴';
                const recentData = s.last_reading_at && s.seconds_since_reading < 300 ? '📊' : '📭';
                console.log(`  ${status}${recentData} Sensor ${s.id}: ${s.sensor_code} (${s.type_code})`);
                console.log(`      Room: ${s.room_code || 'N/A'}`);
                console.log(`      MQTT: ${s.mqtt_topic}`);
                console.log(`      Last reading: ${s.last_reading_at || 'Never'} (${s.seconds_since_reading || 'N/A'}s ago)`);
            });
        }
        console.log('');

        // 5. Check recent measurements
        console.log('========== RECENT MEASUREMENTS (Last 5 minutes) ==========');
        const [recentMeasurements] = await connection.execute(`
            SELECT 
                s.id as sensor_id,
                s.sensor_code,
                st.type_code,
                COUNT(sm.id) as measurement_count,
                MAX(sm.measured_at) as last_measurement,
                AVG(sm.measured_value) as avg_value
            FROM sensors s
            JOIN sensor_types st ON s.sensor_type_id = st.id
            LEFT JOIN sensor_measurements sm ON s.id = sm.sensor_id 
                AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            GROUP BY s.id, s.sensor_code, st.type_code
            HAVING measurement_count > 0
            ORDER BY last_measurement DESC
        `);

        if (recentMeasurements.length === 0) {
            console.log('⚠️ NO RECENT MEASUREMENTS - No sensor data in the last 5 minutes!');
        } else {
            console.log(`Found ${recentMeasurements.length} sensors with recent data:`);
            recentMeasurements.forEach(m => {
                console.log(`  📊 Sensor ${m.sensor_id} (${m.sensor_code} - ${m.type_code}): ${m.measurement_count} measurements, avg ${m.avg_value?.toFixed(2)}, last: ${m.last_measurement}`);
            });
        }
        console.log('');

        // 6. Check MQTT topic mapping
        console.log('========== MQTT TOPIC MAPPING ==========');
        const [mqttTopics] = await connection.execute(`
            SELECT 
                s.id,
                s.sensor_code,
                st.type_code,
                s.mqtt_topic,
                r.room_code,
                s.is_active
            FROM sensors s
            JOIN sensor_types st ON s.sensor_type_id = st.id
            LEFT JOIN rooms r ON s.room_id = r.id
            WHERE s.is_active = 1
            ORDER BY s.mqtt_topic
        `);

        console.log(`Active sensors with MQTT topics (${mqttTopics.length}):`);
        const topicGroups = {};
        mqttTopics.forEach(s => {
            if (!topicGroups[s.mqtt_topic]) {
                topicGroups[s.mqtt_topic] = [];
            }
            topicGroups[s.mqtt_topic].push(s);
        });

        Object.entries(topicGroups).forEach(([topic, sensors]) => {
            console.log(`\n  📡 Topic: "${topic}"`);
            sensors.forEach(s => {
                console.log(`     → Sensor ${s.id}: ${s.sensor_code} (${s.type_code}) in room ${s.room_code}`);
            });
        });
        console.log('');

        // 7. Identify issues
        console.log('========== DIAGNOSTIC SUMMARY ==========');
        let issuesFound = false;

        // Check for users without sensors
        for (const user of users) {
            const [count] = await connection.execute(
                'SELECT COUNT(*) as cnt FROM sensors WHERE user_id = ? AND is_active = 1',
                [user.id]
            );
            if (count[0].cnt === 0) {
                console.log(`❌ User ${user.id} (${user.username}) has NO ACTIVE SENSORS`);
                issuesFound = true;
            }
        }

        // Check for sensors without measurements
        const [sensorsWithoutData] = await connection.execute(`
            SELECT s.id, s.sensor_code, st.type_code, s.mqtt_topic
            FROM sensors s
            JOIN sensor_types st ON s.sensor_type_id = st.id
            WHERE s.is_active = 1
            AND NOT EXISTS (
                SELECT 1 FROM sensor_measurements sm 
                WHERE sm.sensor_id = s.id 
                AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
            )
        `);

        if (sensorsWithoutData.length > 0) {
            console.log(`\n⚠️ ${sensorsWithoutData.length} active sensors have NO DATA in the last hour:`);
            sensorsWithoutData.forEach(s => {
                console.log(`   - Sensor ${s.id}: ${s.sensor_code} (${s.type_code}) - Topic: ${s.mqtt_topic}`);
            });
            issuesFound = true;
        }

        // Check for duplicate MQTT topics
        const [duplicateTopics] = await connection.execute(`
            SELECT mqtt_topic, COUNT(*) as cnt
            FROM sensors
            WHERE is_active = 1 AND mqtt_topic IS NOT NULL
            GROUP BY mqtt_topic
            HAVING cnt > 1
        `);

        if (duplicateTopics.length > 0) {
            console.log(`\n⚠️ DUPLICATE MQTT TOPICS FOUND (${duplicateTopics.length}):`);
            duplicateTopics.forEach(d => {
                console.log(`   - Topic "${d.mqtt_topic}" used by ${d.cnt} sensors`);
            });
            issuesFound = true;
        }

        if (!issuesFound) {
            console.log('✅ No major issues found!');
        }

        console.log('\n========================================\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};

// Run the diagnostic
checkSensorRegistration().then(() => {
    console.log('Diagnostic complete!');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});