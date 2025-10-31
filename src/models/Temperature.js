// models/Temperature.js
// ✅ UPDATED FOR redesigned_iot_database schema
const pool = require("../config/db");

// Create a new temperature measurement
const create = async ({ user_id, value, location, sensor_id }) => {
  console.log(`🔵 [Temperature Model] Creating measurement for sensor_id: ${sensor_id}, value: ${value}`);
  try {
    const [result] = await pool.query(
      `INSERT INTO sensor_measurements (sensor_id, measured_value, measured_at, quality_indicator)
       VALUES (?, ?, NOW(3), 100)`,
      [sensor_id, value]
    );
    console.log(`✅ [Temperature Model] Measurement created with ID: ${result.insertId}`);
    return result;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error creating measurement:`, error.message);
    throw error;
  }
};

// Get all temperature readings (admin)
const getAll = async () => {
  console.log(`🔵 [Temperature Model] Fetching all temperature readings (admin)`);
  try {
    const [rows] = await pool.query(
      `SELECT 
        sm.id,
        sm.measured_value as value,
        sm.measured_at as created_at,
        s.sensor_name,
        s.sensor_code,
        s.mqtt_topic,
        s.user_id,
        r.room_name as location,
        st.type_name as sensor_type
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE st.type_code = 'temperature' AND s.is_active = 1
      ORDER BY sm.measured_at DESC`
    );
    console.log(`✅ [Temperature Model] Retrieved ${rows.length} temperature readings`);
    return rows;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching all temperatures:`, error.message);
    throw error;
  }
};

// Get all temperature readings for specific user
const getAllForUser = async (userId) => {
  console.log(`🔵 [Temperature Model] Fetching temperatures for user: ${userId}`);
  try {
    const [rows] = await pool.query(
      `SELECT 
        sm.id,
        sm.measured_value as value,
        sm.measured_at as created_at,
        s.sensor_name,
        s.sensor_code,
        s.mqtt_topic,
        s.user_id,
        r.room_name as location,
        st.type_name as sensor_type
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? AND st.type_code = 'temperature' AND s.is_active = 1
      ORDER BY sm.measured_at DESC`,
      [userId]
    );
    console.log(`✅ [Temperature Model] Retrieved ${rows.length} temperatures for user ${userId}`);
    return rows;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching user temperatures:`, error.message);
    throw error;
  }
};

// Get latest temperature reading (admin)
const getLatest = async () => {
  console.log(`🔵 [Temperature Model] Fetching latest temperature (admin)`);
  try {
    const [rows] = await pool.query(
      `SELECT 
        sm.id,
        sm.measured_value as value,
        sm.measured_at as created_at,
        s.sensor_name,
        s.sensor_code,
        s.user_id,
        r.room_name as location
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE st.type_code = 'temperature' AND s.is_active = 1
      ORDER BY sm.measured_at DESC
      LIMIT 1`
    );
    console.log(`✅ [Temperature Model] Latest temperature: ${rows[0] ? rows[0].value : 'None'}`);
    return rows[0] || null;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching latest temperature:`, error.message);
    throw error;
  }
};

// Get latest temperature for specific user
const getLatestForUser = async (userId) => {
  console.log(`🔵 [Temperature Model] Fetching latest temperature for user: ${userId}`);
  try {
    const [rows] = await pool.query(
      `SELECT 
        sm.id,
        sm.measured_value as value,
        sm.measured_at as created_at,
        s.sensor_name,
        s.sensor_code,
        s.user_id,
        r.room_name as location
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? AND st.type_code = 'temperature' AND s.is_active = 1
      ORDER BY sm.measured_at DESC
      LIMIT 1`,
      [userId]
    );
    console.log(`✅ [Temperature Model] Latest temperature for user ${userId}: ${rows[0] ? rows[0].value : 'None'}`);
    return rows[0] || null;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching latest user temperature:`, error.message);
    throw error;
  }
};

// Get temperature history aggregated by time intervals
const getHistoryForDays = async (days) => {
  console.log(`🔵 [Temperature Model] Fetching temperature history for ${days} days (admin)`);
  try {
    const [rows] = await pool.query(
      `SELECT 
        DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:%i') as timestamp,
        AVG(sm.measured_value) as average_temp,
        MIN(sm.measured_value) as min_temp,
        MAX(sm.measured_value) as max_temp,
        COUNT(*) as readings_count
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      WHERE st.type_code = 'temperature'
        AND s.is_active = 1
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:%i')
      ORDER BY sm.measured_at ASC`,
      [days]
    );
    console.log(`✅ [Temperature Model] Retrieved ${rows.length} history records for ${days} days`);
    return rows;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching temperature history:`, error.message);
    throw error;
  }
};

// Get temperature history for specific user
const getHistoryForUserAndDays = async (userId, days) => {
  console.log(`🔵 [Temperature Model] Fetching temperature history for user ${userId}, ${days} days`);
  try {
    const [rows] = await pool.query(
      `SELECT 
        DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:%i') as timestamp,
        AVG(sm.measured_value) as average_temp,
        MIN(sm.measured_value) as min_temp,
        MAX(sm.measured_value) as max_temp,
        COUNT(*) as readings_count
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      WHERE s.user_id = ?
        AND st.type_code = 'temperature'
        AND s.is_active = 1
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:%i')
      ORDER BY sm.measured_at ASC`,
      [userId, days]
    );
    console.log(`✅ [Temperature Model] Retrieved ${rows.length} history records for user ${userId}`);
    return rows;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching user temperature history:`, error.message);
    throw error;
  }
};

// Get bowl temperature history
const getBowlTempHistory = async (userId, location, days) => {
  console.log(`🔵 [Temperature Model] Fetching bowl temp history for user ${userId}, location: ${location}, ${days} days`);
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
    console.log(`✅ [Temperature Model] Retrieved ${rows.length} bowl temp records`);
    return rows;
  } catch (error) {
    console.error(`❌ [Temperature Model] Error fetching bowl temp history:`, error.message);
    throw error;
  }
};

module.exports = {
  create,
  getAll,
  getAllForUser,
  getLatest,
  getLatestForUser,
  getHistoryForDays,
  getHistoryForUserAndDays,
  getBowlTempHistory
};
