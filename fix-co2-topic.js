// fix-co2-topic.js
// Update CO2 sensor topic to match what your sensor is actually publishing

require('dotenv').config();
const pool = require('./src/config/db');

async function fixCO2Topic() {
    console.log('\n🔧 Fixing CO2 Sensor Topic...\n');

    try {
        // Show current CO2 sensors
        console.log('📋 Current CO2 sensors:');
        const [sensors] = await pool.execute(
            `SELECT s.id, s.sensor_name, s.mqtt_topic, s.is_active, r.room_name
             FROM sensors s
             LEFT JOIN rooms r ON s.room_id = r.id
             LEFT JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE st.type_code = 'co2_level'`
        );

        sensors.forEach((s, i) => {
            console.log(`   ${i + 1}. ${s.sensor_name}`);
            console.log(`      Topic: "${s.mqtt_topic}"`);
            console.log(`      Room: ${s.room_name}`);
            console.log(`      Active: ${s.is_active ? 'Yes' : 'No'}`);
            console.log('');
        });

        // Find the sensor in Sensor-Room
        const sensorRoomSensor = sensors.find(s => s.room_name === 'Sensor-Room');
        
        if (!sensorRoomSensor) {
            console.error('❌ No CO2 sensor found in Sensor-Room');
            process.exit(1);
        }

        console.log(`🎯 Target sensor: ${sensorRoomSensor.sensor_name} (ID: ${sensorRoomSensor.id})`);
        console.log(`   Current topic: "${sensorRoomSensor.mqtt_topic}"`);
        
        // Your manual test shows the sensor publishes to "co2_level"
        const newTopic = 'co2_level';
        
        if (sensorRoomSensor.mqtt_topic === newTopic) {
            console.log(`✅ Topic is already correct: "${newTopic}"`);
        } else {
            console.log(`   New topic: "${newTopic}"`);
            console.log('');
            console.log('🔄 Updating...');
            
            await pool.execute(
                'UPDATE sensors SET mqtt_topic = ? WHERE id = ?',
                [newTopic, sensorRoomSensor.id]
            );
            
            console.log('✅ Topic updated successfully!');
        }

        console.log('');
        console.log('📊 Verification:');
        const [updated] = await pool.execute(
            'SELECT mqtt_topic FROM sensors WHERE id = ?',
            [sensorRoomSensor.id]
        );
        console.log(`   Sensor ${sensorRoomSensor.id} topic: "${updated[0].mqtt_topic}"`);

        console.log('');
        console.log('✅ Done! Now restart your backend:');
        console.log('   pm2 restart all');
        console.log('');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

fixCO2Topic();
