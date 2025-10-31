// models/Measurement.js
// ✅ UPDATED FOR redesigned_iot_database schema
const pool = require("../config/db");

// Get user's locations (rooms)
const getUserLocations = async (userId) => {
    console.log(`🔵 [Measurement Model] Getting locations for user: ${userId}`);
    try {
        const [rows] = await pool.execute(
            `SELECT 
        r.id as room_id,
        r.room_code as location,
        r.room_name,
        r.description,
        COUNT(DISTINCT sm.id) as measurement_count,
        MAX(sm.measured_at) as last_measurement,
        COUNT(DISTINCT s.id) as sensor_count
      FROM rooms r
      LEFT JOIN sensors s ON r.id = s.room_id AND s.is_active = 1
      LEFT JOIN sensor_measurements sm ON s.id = sm.sensor_id
      WHERE r.user_id = ? AND r.is_active = 1
      GROUP BY r.id, r.room_code, r.room_name, r.description
      ORDER BY last_measurement DESC`,
            [userId]
        );
        console.log(`✅ [Measurement Model] Retrieved ${rows.length} locations`);
        return rows;
    } catch (error) {
        console.error(`❌ [Measurement Model] Error getting locations:`, error.message);
        throw error;
    }
};

// Get latest measurement for user and location (room)
const getLatestForUser = async (userId, location = null) => {
    console.log(`🔵 [Measurement Model] Getting latest for user: ${userId}, location: ${location}`);
    try {
        let query = `
      SELECT 
        sm.id,
        sm.measured_value,
        sm.measured_at,
        s.sensor_name,
        s.sensor_code,
        st.type_code,
        st.type_name,
        r.room_code as location,
        r.room_name
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? AND s.is_active = 1`;

        let params = [userId];

        if (location) {
            query += ` AND r.room_code = ?`;
            params.push(location);
        }

        query += ` ORDER BY sm.measured_at DESC LIMIT 1`;

        const [rows] = await pool.execute(query, params);
        console.log(`✅ [Measurement Model] Latest measurement: ${rows[0] ? 'Found' : 'None'}`);
        return rows[0] || null;
    } catch (error) {
        console.error(`❌ [Measurement Model] Error getting latest:`, error.message);
        throw error;
    }
};

// Get all measurements for a location (room)
const getAllByUserAndLocation = async (userId, location, days = 7) => {
    console.log(`🔵 [Measurement Model] Getting measurements - User: ${userId}, Location: ${location}, Days: ${days}`);
    try {
        const [rows] = await pool.execute(
            `SELECT 
        sm.id,
        sm.measured_value,
        sm.measured_at,
        sm.quality_indicator,
        s.sensor_name,
        s.sensor_code,
        st.type_code,
        st.type_name,
        r.room_code as location,
        r.room_name
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? 
        AND r.room_code = ? 
        AND s.is_active = 1
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY sm.measured_at DESC 
      LIMIT 1000`,
            [userId, location, days]
        );
        console.log(`✅ [Measurement Model] Retrieved ${rows.length} measurements`);
        return rows;
    } catch (error) {
        console.error(`❌ [Measurement Model] Error getting measurements:`, error.message);
        throw error;
    }
};

// Get measurements grouped by sensor type for a location
const getLocationSensorData = async (userId, location) => {
    console.log(`🔵 [Measurement Model] Getting sensor data for location: ${location}`);
    try {
        const [rows] = await pool.execute(
            `SELECT 
        st.type_code,
        st.type_name,
        s.sensor_name,
        s.id as sensor_id,
        sm.measured_value,
        sm.measured_at,
        sm.quality_indicator
      FROM sensors s
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      LEFT JOIN sensor_measurements sm ON s.id = sm.sensor_id
        AND sm.id = (
          SELECT id FROM sensor_measurements 
          WHERE sensor_id = s.id 
          ORDER BY measured_at DESC 
          LIMIT 1
        )
      WHERE s.user_id = ? 
        AND r.room_code = ? 
        AND s.is_active = 1
      ORDER BY st.display_order, s.sensor_name`,
            [userId, location]
        );
        console.log(`✅ [Measurement Model] Retrieved data for ${rows.length} sensors`);
        return rows;
    } catch (error) {
        console.error(`❌ [Measurement Model] Error getting sensor data:`, error.message);
        throw error;
    }
};

// Get bowl temperature history (already updated in previous response)
const getBowlTempHistory = async (userId, location, days) => {
    console.log(`🔵 [Measurement Model] Getting bowl temp history - User: ${userId}, Location: ${location}, Days: ${days}`);
    try {
        const [rows] = await pool.query(
            `SELECT
        DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:%i:%s') as timestamp,
        sm.measured_value as value,
        s.sensor_name,
        r.room_name
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ?
        AND st.type_code = 'bowl_temp'
        AND r.room_code = ?
        AND s.is_active = 1
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY sm.measured_at ASC`,
            [userId, location, days]
        );
        console.log(`✅ [Measurement Model] Retrieved ${rows.length} bowl temp records`);
        return rows;
    } catch (error) {
        console.error(`❌ [Measurement Model] Error getting bowl temp history:`, error.message);
        throw error;
    }
};

// Get aggregated sensor statistics for a location
const getLocationStats = async (userId, location, days = 7) => {
    console.log(`🔵 [Measurement Model] Getting location stats - Location: ${location}, Days: ${days}`);
    try {
        const [rows] = await pool.execute(
            `SELECT 
        st.type_code,
        st.type_name,
        st.unit,
        COUNT(sm.id) as measurement_count,
        AVG(sm.measured_value) as avg_value,
        MIN(sm.measured_value) as min_value,
        MAX(sm.measured_value) as max_value,
        MAX(sm.measured_at) as last_measurement
      FROM sensors s
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      LEFT JOIN sensor_measurements sm ON s.id = sm.sensor_id
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      WHERE s.user_id = ? 
        AND r.room_code = ? 
        AND s.is_active = 1
      GROUP BY st.type_code, st.type_name, st.unit
      ORDER BY st.display_order`,
            [days, userId, location]
        );
        console.log(`✅ [Measurement Model] Retrieved stats for ${rows.length} sensor types`);
        return rows;
    } catch (error) {
        console.error(`❌ [Measurement Model] Error getting location stats:`, error.message);
        throw error;
    }
};

module.exports = {
    getUserLocations,
    getLatestForUser,
    getAllByUserAndLocation,
    getLocationSensorData,
    getBowlTempHistory,
    getLocationStats
};
