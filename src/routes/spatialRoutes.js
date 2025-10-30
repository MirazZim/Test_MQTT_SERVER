// const express = require("express");
// const { adminOrUser } = require("../middleware/auth");
// const pool = require("../config/db");

// const spatialRouter = express.Router();

// // Get all sensor nodes for user
// spatialRouter.get("/sensors", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const { location } = req.query;

//         let query = `SELECT 
//       id, sensor_id, location, x_coordinate, y_coordinate, z_coordinate,
//       sensor_type, calibration_offset, last_reading, last_update, is_active, mqtt_topic
//       FROM sensor_nodes WHERE user_id = ?`;
//         let params = [userId];

//         if (location) {
//             query += " AND location = ?";
//             params.push(location);
//         }

//         query += " ORDER BY location, sensor_id";
//         const [rows] = await pool.execute(query, params);

//         // ✅ FIXED: Match frontend expectation
//         res.json({ sensors: rows });
//     } catch (error) {
//         console.error("Error getting sensors:", error);
//         res.status(500).json({ error: "Failed to fetch sensors" });
//     }
// });

// // Get actuator nodes
// spatialRouter.get("/actuators", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const { location } = req.query;

//         let query = `SELECT 
//       id, actuator_id, location, x_coordinate, y_coordinate, z_coordinate,
//       actuator_type, max_power, influence_radius, current_output, is_active
//       FROM actuator_nodes WHERE user_id = ?`;
//         let params = [userId];

//         if (location) {
//             query += " AND location = ?";
//             params.push(location);
//         }

//         query += " ORDER BY location, actuator_id";
//         const [rows] = await pool.execute(query, params);

//         // ✅ FIXED: Match frontend expectation
//         res.json({ actuators: rows });
//     } catch (error) {
//         console.error("Error getting actuators:", error);
//         res.status(500).json({ error: "Failed to fetch actuators" });
//     }
// });

// // ✅ FIXED: Get spatial temperature field for visualization
// spatialRouter.get("/temperature-field/:location", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);

//         // ✅ FIXED: Use actual tables instead of view
//         const [rows] = await pool.execute(
//             `SELECT DISTINCT
//          m.temperature, m.humidity, m.airflow, m.created_at,
//          s.sensor_id, s.x_coordinate, s.y_coordinate, s.sensor_type,
//          s.last_reading, s.last_update
//        FROM measurements m
//        JOIN sensor_nodes s ON s.user_id = m.user_id 
//        WHERE m.user_id = ? AND m.location = ? 
//        AND m.created_at >= NOW() - INTERVAL 10 MINUTE
//        AND s.is_active = TRUE
//        AND s.location = ?
//        ORDER BY m.created_at DESC`,
//             [userId, location, location]
//         );

//         // ✅ FIXED: Match frontend expectation
//         res.json({ temperatureField: rows });
//     } catch (error) {
//         console.error("Error getting temperature field:", error);
//         res.status(500).json({ error: "Failed to fetch temperature field" });
//     }
// });

// // Get system performance metrics
// spatialRouter.get("/performance/:location", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);
//         const { hours = 24 } = req.query;

//         const [rows] = await pool.execute(
//             `SELECT metric_name, metric_value, timestamp
//        FROM system_performance
//        WHERE user_id = ? AND location = ?
//        AND timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
//        ORDER BY timestamp DESC`,
//             [userId, location, hours]
//         );

//         // Group metrics by name
//         const metrics = {};
//         rows.forEach(row => {
//             if (!metrics[row.metric_name]) {
//                 metrics[row.metric_name] = [];
//             }
//             metrics[row.metric_name].push({
//                 value: row.metric_value,
//                 timestamp: row.timestamp
//             });
//         });

//         // ✅ FIXED: Match frontend expectation
//         res.json({ metrics });
//     } catch (error) {
//         console.error("Error getting performance metrics:", error);
//         res.status(500).json({ error: "Failed to fetch performance metrics" });
//     }
// });

// // ✅ NEW: Add real-time sensor data endpoint
// spatialRouter.get("/real-sensors/:location", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);

//         const [sensors] = await pool.execute(
//             `SELECT sensor_id, x_coordinate, y_coordinate, sensor_type,
//               last_reading, last_update, mqtt_topic,
//               TIMESTAMPDIFF(SECOND, last_update, NOW()) as seconds_ago
//        FROM sensor_nodes 
//        WHERE user_id = ? AND location = ? 
//        AND sensor_id LIKE 'REAL_%' AND is_active = TRUE
//        ORDER BY sensor_id`,
//             [userId, location]
//         );

//         res.json({
//             realSensors: sensors,
//             onlineCount: sensors.filter(s => s.seconds_ago < 120).length,
//             totalCount: sensors.length
//         });
//     } catch (error) {
//         console.error("Error getting real sensors:", error);
//         res.status(500).json({ error: "Failed to fetch real sensors" });
//     }
// });

// // Keep all your existing POST/PUT endpoints unchanged...
// // (ADD all your existing POST/PUT methods here - they're perfect as they are)

// module.exports = spatialRouter;
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");

const spatialRouter = express.Router();

// Updated: sensors from new 'sensors' table (was sensor_nodes), include room_id via join
spatialRouter.get("/sensors", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { location } = req.query;

        let query = `SELECT 
      s.id, s.sensor_code as sensor_id, r.room_code as location, s.x_coordinate, s.y_coordinate, s.z_coordinate,
      st.type_code as sensor_type, s.calibration_offset, s.last_reading_at as last_update, s.is_active, s.mqtt_topic
      FROM sensors s
      JOIN rooms r ON s.room_id = r.id
      JOIN sensor_types st ON s.sensor_type_id = st.id
      WHERE s.user_id = ?`;
        let params = [userId];

        if (location) {
            query += " AND r.room_code = ?";
            params.push(location);
        }

        query += " ORDER BY r.room_code, s.sensor_code";
        const [rows] = await pool.execute(query, params);

        res.json({ sensors: rows });
    } catch (error) {
        console.error("Error getting sensors:", error);
        res.status(500).json({ error: "Failed to fetch sensors" });
    }
});

// Updated: actuators from new 'actuators' table (was actuator_nodes), include room_id via join
spatialRouter.get("/actuators", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { location } = req.query;

        let query = `SELECT 
      a.id, a.actuator_code as actuator_id, r.room_code as location, a.x_coordinate, a.y_coordinate, a.z_coordinate,
      at.type_code as actuator_type, a.max_power, a.influence_radius, a.is_active
      FROM actuators a
      JOIN rooms r ON a.room_id = r.id
      JOIN actuator_types at ON a.actuator_type_id = at.id
      WHERE a.user_id = ?`;
        let params = [userId];

        if (location) {
            query += " AND r.room_code = ?";
            params.push(location);
        }

        query += " ORDER BY r.room_code, a.actuator_code";
        const [rows] = await pool.execute(query, params);

        res.json({ actuators: rows });
    } catch (error) {
        console.error("Error getting actuators:", error);
        res.status(500).json({ error: "Failed to fetch actuators" });
    }
});

// Updated: Temperature field from sensor_measurements (latest per temperature sensor)
spatialRouter.get("/temperature-field/:location", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const [rows] = await pool.execute(
            `SELECT 
         s.sensor_code as sensor_id, s.x_coordinate, s.y_coordinate, st.type_code as sensor_type,
         sm.measured_value as temperature, sm.measured_at as created_at
       FROM sensors s
       JOIN rooms r ON s.room_id = r.id
       JOIN sensor_types st ON s.sensor_type_id = st.id
       JOIN sensor_measurements sm ON s.id = sm.sensor_id
       WHERE s.user_id = ? AND r.room_code = ? AND st.type_code = 'temperature' AND s.is_active = 1
       AND sm.measured_at = (SELECT MAX(measured_at) FROM sensor_measurements WHERE sensor_id = s.id)
       ORDER BY sm.measured_at DESC`,
            [userId, location]
        );

        res.json({ temperatureField: rows });
    } catch (error) {
        console.error("Error getting temperature field:", error);
        res.status(500).json({ error: "Failed to fetch temperature field" });
    }
});

// Updated: Performance from system_performance_metrics (was system_performance), with room_id
spatialRouter.get("/performance/:location", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const { hours = 24 } = req.query;

        const [room] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, location]);
        if (room.length === 0) return res.status(404).json({ error: "Room not found" });
        const roomId = room[0].id;

        const [rows] = await pool.execute(
            `SELECT metric_type as metric_name, metric_value, measured_at as timestamp
       FROM system_performance_metrics
       WHERE room_id = ?
       AND measured_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
       ORDER BY measured_at DESC`,
            [roomId, hours]
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

        res.json({ metrics });
    } catch (error) {
        console.error("Error getting performance metrics:", error);
        res.status(500).json({ error: "Failed to fetch performance metrics" });
    }
});

// Updated: Real sensors from sensors table (include room_id)
spatialRouter.get("/real-sensors/:location", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const [room] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, location]);
        if (room.length === 0) return res.status(404).json({ error: "Room not found" });
        const roomId = room[0].id;

        const [sensors] = await pool.execute(
            `SELECT s.sensor_code as sensor_id, s.x_coordinate, s.y_coordinate, st.type_code as sensor_type,
              s.last_reading_at as last_update, s.mqtt_topic,
              TIMESTAMPDIFF(SECOND, s.last_reading_at, NOW()) as seconds_ago
       FROM sensors s 
       JOIN sensor_types st ON s.sensor_type_id = st.id
       WHERE s.user_id = ? AND s.room_id = ? 
       AND s.sensor_code LIKE 'REAL_%' AND s.is_active = 1
       ORDER BY s.sensor_code`,
            [userId, roomId]
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

module.exports = spatialRouter;