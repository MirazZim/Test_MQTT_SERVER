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
const getBowlTempHistory = async (userId, location, days = 7) => {
    const [rows] = await pool.execute(
        `SELECT 
      DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as timestamp,
      AVG(bowl_temp) as avg_bowl_temp,
      MIN(bowl_temp) as min_bowl_temp,
      MAX(bowl_temp) as max_bowl_temp,
      COUNT(*) as readings_count
    FROM measurements
    WHERE user_id = ? 
      AND location = ? 
      AND bowl_temp IS NOT NULL
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')
    ORDER BY created_at ASC`,
        [userId, location, days]
    );
    return rows;
};

module.exports = { create, getLatestForUser, getUserLocations, getBowlTempHistory };