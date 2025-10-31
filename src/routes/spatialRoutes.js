const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");

const spatialRouter = express.Router();

// Get all sensor nodes for user
spatialRouter.get("/sensors", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { location } = req.query;

        let query = `SELECT 
      id, sensor_id, location, x_coordinate, y_coordinate, z_coordinate,
      sensor_type, calibration_offset, last_reading, last_update, is_active, mqtt_topic
      FROM sensor_nodes WHERE user_id = ?`;
        let params = [userId];

        if (location) {
            query += " AND location = ?";
            params.push(location);
        }

        query += " ORDER BY location, sensor_id";
        const [rows] = await pool.execute(query, params);

        // ✅ FIXED: Match frontend expectation
        res.json({ sensors: rows });
    } catch (error) {
        console.error("Error getting sensors:", error);
        res.status(500).json({ error: "Failed to fetch sensors" });
    }
});

// Get actuator nodes
spatialRouter.get("/actuators", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { location } = req.query;

        let query = `SELECT 
      id, actuator_id, location, x_coordinate, y_coordinate, z_coordinate,
      actuator_type, max_power, influence_radius, current_output, is_active
      FROM actuator_nodes WHERE user_id = ?`;
        let params = [userId];

        if (location) {
            query += " AND location = ?";
            params.push(location);
        }

        query += " ORDER BY location, actuator_id";
        const [rows] = await pool.execute(query, params);

        // ✅ FIXED: Match frontend expectation
        res.json({ actuators: rows });
    } catch (error) {
        console.error("Error getting actuators:", error);
        res.status(500).json({ error: "Failed to fetch actuators" });
    }
});

// ✅ FIXED: Get spatial temperature field for visualization
spatialRouter.get("/temperature-field/:location", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        // ✅ FIXED: Use actual tables instead of view
        const [rows] = await pool.execute(
            `SELECT DISTINCT
         m.temperature, m.humidity, m.airflow, m.created_at,
         s.sensor_id, s.x_coordinate, s.y_coordinate, s.sensor_type,
         s.last_reading, s.last_update
       FROM measurements m
       JOIN sensor_nodes s ON s.user_id = m.user_id 
       WHERE m.user_id = ? AND m.location = ? 
       AND m.created_at >= NOW() - INTERVAL 10 MINUTE
       AND s.is_active = TRUE
       AND s.location = ?
       ORDER BY m.created_at DESC`,
            [userId, location, location]
        );

        // ✅ FIXED: Match frontend expectation
        res.json({ temperatureField: rows });
    } catch (error) {
        console.error("Error getting temperature field:", error);
        res.status(500).json({ error: "Failed to fetch temperature field" });
    }
});

// Get system performance metrics
spatialRouter.get("/performance/:location", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const { hours = 24 } = req.query;

        const [rows] = await pool.execute(
            `SELECT metric_name, metric_value, timestamp
       FROM system_performance
       WHERE user_id = ? AND location = ?
       AND timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
       ORDER BY timestamp DESC`,
            [userId, location, hours]
        );

        // Group metrics by name
        const metrics = {};
        rows.forEach(row => {
            if (!metrics[row.metric_name]) {
                metrics[row.metric_name] = [];
            }
            metrics[row.metric_name].push({
                value: row.metric_value,
                timestamp: row.timestamp
            });
        });

        // ✅ FIXED: Match frontend expectation
        res.json({ metrics });
    } catch (error) {
        console.error("Error getting performance metrics:", error);
        res.status(500).json({ error: "Failed to fetch performance metrics" });
    }
});

// ✅ NEW: Add real-time sensor data endpoint
spatialRouter.get("/real-sensors/:location", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const [sensors] = await pool.execute(
            `SELECT sensor_id, x_coordinate, y_coordinate, sensor_type,
              last_reading, last_update, mqtt_topic,
              TIMESTAMPDIFF(SECOND, last_update, NOW()) as seconds_ago
       FROM sensor_nodes 
       WHERE user_id = ? AND location = ? 
       AND sensor_id LIKE 'REAL_%' AND is_active = TRUE
       ORDER BY sensor_id`,
            [userId, location]
        );

        res.json({
            realSensors: sensors,
            onlineCount: sensors.filter(s => s.seconds_ago < 120).length,
            totalCount: sensors.length
        });
    } catch (error) {
        console.error("Error getting real sensors:", error);
        res.status(500).json({ error: "Failed to fetch real sensors" });
    }
});

// Keep all your existing POST/PUT endpoints unchanged...
// (ADD all your existing POST/PUT methods here - they're perfect as they are)

module.exports = spatialRouter;

