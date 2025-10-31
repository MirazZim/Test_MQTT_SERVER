const pool = require("../config/db");

const create = async ({ user_id, temperature, humidity, bowl_temp, airflow, unit_airflow = 'm/s', location }) => {

    if (!location || location.trim() === '') {
        throw new Error("Location is required for creating a measurement");
    }

    const [result] = await pool.execute(
        "INSERT INTO measurements (user_id, temperature, humidity,bowl_temp, airflow, unit_airflow, location) VALUES (?, ?, ?, ?, ?, ?)",
        [user_id, temperature, humidity, bowl_temp, airflow, unit_airflow, location.trim()]
    );
    return result;

};


const getLatestForUser = async (userId, location = null) => {
    let query = "SELECT * FROM measurements WHERE user_id = ?";
    let params = [userId];

    if (location) {
        query += " AND location = ?";
        params.push(location);
    }

    query += " ORDER BY created_at DESC LIMIT 1";

    const [rows] = await pool.execute(query, params);
    return rows[0] || null;
};


const getUserLocations = async (userId) => {
    const [rows] = await pool.execute(
        `SELECT location, 
     COUNT(*) as measurement_count,
     MAX(created_at) as last_measurement,
     AVG(temperature) as avg_temp,
     AVG(humidity) as avg_humidity,
     AVG(bowl_temp) as avg_bowl_temp,
     AVG(airflow) as avg_airflow
     FROM measurements 
     WHERE user_id = ? 
     GROUP BY location 
     ORDER BY last_measurement DESC`,
        [userId]
    );
    return rows;
};

const getBowlTempHistory = async (userId, location, days) => {
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
    return rows;
};


module.exports = { create, getLatestForUser, getUserLocations, getBowlTempHistory };