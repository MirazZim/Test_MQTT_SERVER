const mysql = require('mysql2/promise');
require('dotenv').config();

const setupSpatialNodes = async () => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('🔧 Setting up spatial sensor and actuator nodes...');

        // AFTER - use your actual user ID
        const userId = 14; // Match your defaultUserId from mqttHandler
        const location = 'sensor-room'; // Match your defaultLocation

        // Insert sensor nodes
        const sensors = [
            { id: 'REAL_TEMP_001', x: 2.0, y: 2.0, type: 'temperature' }, // ESPX
            { id: 'REAL_TEMP_002', x: 8.0, y: 2.0, type: 'temperature' }, // ESPX2
            { id: 'REAL_TEMP_003', x: 5.0, y: 8.0, type: 'temperature' }, // ESPX3
            // Keep some simulated sensors if needed for comparison
            { id: 'TEMP_004', x: 8.0, y: 8.0, type: 'temperature' },
            { id: 'TEMP_005', x: 5.0, y: 5.0, type: 'temperature' },
            { id: 'HUM_001', x: 5.0, y: 2.0, type: 'humidity' }
        ];

        for (const sensor of sensors) {
            await connection.execute(
                `INSERT INTO sensor_nodes 
                 (user_id, sensor_id, location, x_coordinate, y_coordinate, sensor_type, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, TRUE)
                 ON DUPLICATE KEY UPDATE 
                 x_coordinate = VALUES(x_coordinate), 
                 y_coordinate = VALUES(y_coordinate)`,
                [userId, sensor.id, location, sensor.x, sensor.y, sensor.type]
            );
            console.log(`✅ Added sensor: ${sensor.id} at (${sensor.x}, ${sensor.y})`);
        }

        // Insert actuator nodes
        const actuators = [
            { id: 'HEATER_001', x: 1.0, y: 1.0, type: 'heater', power: 2000, radius: 3.0 },
            { id: 'HEATER_002', x: 9.0, y: 1.0, type: 'heater', power: 2000, radius: 3.0 },
            { id: 'COOLER_001', x: 1.0, y: 9.0, type: 'cooler', power: 1500, radius: 4.0 },
            { id: 'COOLER_002', x: 9.0, y: 9.0, type: 'cooler', power: 1500, radius: 4.0 },
            { id: 'FAN_001', x: 5.0, y: 5.0, type: 'fan', power: 500, radius: 5.0 }
        ];

        for (const actuator of actuators) {
            await connection.execute(
                `INSERT INTO actuator_nodes 
                 (user_id, actuator_id, location, x_coordinate, y_coordinate, 
                  actuator_type, max_power, influence_radius, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)
                 ON DUPLICATE KEY UPDATE 
                 x_coordinate = VALUES(x_coordinate), 
                 y_coordinate = VALUES(y_coordinate)`,
                [userId, actuator.id, location, actuator.x, actuator.y,
                    actuator.type, actuator.power, actuator.radius]
            );
            console.log(`✅ Added actuator: ${actuator.id} at (${actuator.x}, ${actuator.y})`);
        }

        console.log('🎉 Spatial nodes setup completed!');
        await connection.end();

    } catch (error) {
        console.error('❌ Error setting up spatial nodes:', error.message);
    }
};

setupSpatialNodes();
