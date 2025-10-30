const mysql = require('mysql2/promise');
require('dotenv').config();

const integrateRealSensors = async () => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('🔧 Integrating real sensors into spatial system...');

        const userId = 14; // Your actual user ID
        const location = 'sensor-room'; // Your actual location

        // Insert real sensor nodes
        const realSensors = [
            { id: 'REAL_TEMP_001', x: 2.0, y: 2.0, type: 'temperature', mqtt_topic: 'ESPX' },
            { id: 'REAL_TEMP_002', x: 8.0, y: 2.0, type: 'temperature', mqtt_topic: 'ESPX2' },
            { id: 'REAL_TEMP_003', x: 5.0, y: 8.0, type: 'temperature', mqtt_topic: 'ESPX3' }
        ];

        for (const sensor of realSensors) {
            await connection.execute(
                `INSERT INTO sensor_nodes
        (user_id, sensor_id, location, x_coordinate, y_coordinate, sensor_type, is_active, mqtt_topic)
        VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)
        ON DUPLICATE KEY UPDATE
        x_coordinate = VALUES(x_coordinate),
        y_coordinate = VALUES(y_coordinate),
        mqtt_topic = VALUES(mqtt_topic)`,
                [userId, sensor.id, location, sensor.x, sensor.y, sensor.type, sensor.mqtt_topic]
            );
            console.log(`✅ Added real sensor: ${sensor.id} (${sensor.mqtt_topic}) at (${sensor.x}, ${sensor.y})`);
        }

        console.log('🎉 Real sensors integration completed!');
        await connection.end();

    } catch (error) {
        console.error('❌ Error integrating real sensors:', error.message);
    }
};

integrateRealSensors();
