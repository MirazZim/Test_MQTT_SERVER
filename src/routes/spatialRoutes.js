// routes/spatialRoutes.js
// ✅ UPDATED FOR redesigned_iot_database schema
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");

const spatialRouter = express.Router();

console.log("🔵 [Spatial Routes] Initializing routes");

// ============================================
// GET /sensors - Get all sensor nodes for user
// ============================================
spatialRouter.get("/sensors", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /sensors] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const { location } = req.query;

        console.log(`🔵 [Route] Getting sensors for location: ${location || 'all'}`);

        let query = `
      SELECT 
        s.id,
        s.sensor_code as sensor_id,
        r.room_code as location,
        s.x_coordinate,
        s.y_coordinate,
        s.z_coordinate,
        st.type_code as sensor_type,
        st.type_name,
        s.calibration_offset,
        s.last_reading_at as last_update,
        s.is_active,
        s.mqtt_topic,
        (SELECT sm.measured_value 
         FROM sensor_measurements sm 
         WHERE sm.sensor_id = s.id 
         ORDER BY sm.measured_at DESC 
         LIMIT 1) as last_reading
      FROM sensors s
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ?`;

        let params = [userId];

        if (location) {
            query += " AND r.room_code = ?";
            params.push(location);
        }

        query += " ORDER BY r.room_code, s.sensor_code";

        const [rows] = await pool.execute(query, params);

        console.log(`✅ [Route] Retrieved ${rows.length} sensors`);
        res.json({
            status: "success",
            sensors: rows
        });
    } catch (error) {
        console.error("❌ [Route GET /sensors] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to fetch sensors"
        });
    }
});

// ============================================
// GET /actuators - Get actuator nodes
// ============================================
spatialRouter.get("/actuators", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /actuators] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const { location } = req.query;

        console.log(`🔵 [Route] Getting actuators for location: ${location || 'all'}`);

        let query = `
      SELECT 
        a.id,
        a.actuator_code as actuator_id,
        r.room_code as location,
        a.x_coordinate,
        a.y_coordinate,
        a.z_coordinate,
        at.type_code as actuator_type,
        at.type_name,
        a.max_power,
        a.influence_radius,
        a.current_state as current_output,
        a.is_active,
        a.mqtt_topic,
        a.last_command_at
      FROM actuators a
      INNER JOIN actuator_types at ON a.actuator_type_id = at.id
      INNER JOIN rooms r ON a.room_id = r.id
      WHERE a.user_id = ?`;

        let params = [userId];

        if (location) {
            query += " AND r.room_code = ?";
            params.push(location);
        }

        query += " ORDER BY r.room_code, a.actuator_code";

        const [rows] = await pool.execute(query, params);

        console.log(`✅ [Route] Retrieved ${rows.length} actuators`);
        res.json({
            status: "success",
            actuators: rows
        });
    } catch (error) {
        console.error("❌ [Route GET /actuators] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to fetch actuators"
        });
    }
});

// ============================================
// GET /temperature-field/:location - Spatial temperature field
// ============================================
spatialRouter.get("/temperature-field/:location", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /temperature-field/:location] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        console.log(`🔵 [Route] Getting temperature field for: ${location}`);

        const [rows] = await pool.execute(
            `SELECT 
        sm.measured_value as temperature,
        sm.measured_at as created_at,
        s.sensor_code as sensor_id,
        s.x_coordinate,
        s.y_coordinate,
        s.z_coordinate,
        st.type_code as sensor_type,
        st.type_name,
        s.last_reading_at as last_update,
        r.room_code as location
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? 
        AND r.room_code = ? 
        AND sm.measured_at >= NOW() - INTERVAL 10 MINUTE
        AND s.is_active = 1
        AND st.type_code IN ('temperature', 'bowl_temp')
      ORDER BY sm.measured_at DESC
      LIMIT 100`,
            [userId, location]
        );

        console.log(`✅ [Route] Retrieved ${rows.length} temperature field data points`);
        res.json({
            status: "success",
            temperatureField: rows,
            location: location,
            dataPoints: rows.length
        });
    } catch (error) {
        console.error("❌ [Route GET /temperature-field/:location] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to fetch temperature field"
        });
    }
});

// ============================================
// GET /performance/:location - System performance metrics
// ============================================
spatialRouter.get("/performance/:location", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /performance/:location] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const { hours = 24 } = req.query;

        console.log(`🔵 [Route] Getting ${hours}h performance metrics for: ${location}`);

        // Get sensor statistics for the location
        const [sensorStats] = await pool.execute(
            `SELECT 
        st.type_code as metric_name,
        AVG(sm.measured_value) as avg_value,
        MIN(sm.measured_value) as min_value,
        MAX(sm.measured_value) as max_value,
        COUNT(sm.id) as reading_count,
        MAX(sm.measured_at) as last_timestamp
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? 
        AND r.room_code = ?
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND s.is_active = 1
      GROUP BY st.type_code
      ORDER BY st.display_order`,
            [userId, location, hours]
        );

        // Format metrics
        const metrics = {};
        sensorStats.forEach(stat => {
            metrics[stat.metric_name] = [{
                value: stat.avg_value,
                min: stat.min_value,
                max: stat.max_value,
                count: stat.reading_count,
                timestamp: stat.last_timestamp
            }];
        });

        // Add system health metrics
        const [activeStats] = await pool.execute(
            `SELECT 
        COUNT(DISTINCT s.id) as active_sensors,
        COUNT(DISTINCT a.id) as active_actuators,
        COUNT(DISTINCT sm.id) as total_readings
      FROM rooms r
      LEFT JOIN sensors s ON r.id = s.room_id AND s.is_active = 1
      LEFT JOIN actuators a ON r.id = a.room_id AND a.is_active = 1
      LEFT JOIN sensor_measurements sm ON s.id = sm.sensor_id 
        AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      WHERE r.user_id = ? AND r.room_code = ?`,
            [hours, userId, location]
        );

        if (activeStats.length > 0) {
            metrics['system_health'] = [{
                active_sensors: activeStats[0].active_sensors,
                active_actuators: activeStats[0].active_actuators,
                total_readings: activeStats[0].total_readings,
                timestamp: new Date()
            }];
        }

        console.log(`✅ [Route] Retrieved ${Object.keys(metrics).length} performance metrics`);
        res.json({
            status: "success",
            metrics,
            location,
            hours: parseInt(hours)
        });
    } catch (error) {
        console.error("❌ [Route GET /performance/:location] Error:", error.message);
        res.status(400).json({
            status: "failed",
            error: "Failed to fetch performance metrics"
        });
    }
});

// ============================================
// GET /real-sensors/:location - Real-time sensor data
// ============================================
spatialRouter.get("/real-sensors/:location", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /real-sensors/:location] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        console.log(`🔵 [Route] Getting real sensors for: ${location}`);

        const [sensors] = await pool.execute(
            `SELECT 
        s.sensor_code as sensor_id,
        s.x_coordinate,
        s.y_coordinate,
        s.z_coordinate,
        st.type_code as sensor_type,
        st.type_name,
        s.mqtt_topic,
        s.last_reading_at as last_update,
        TIMESTAMPDIFF(SECOND, s.last_reading_at, NOW()) as seconds_ago,
        (SELECT sm.measured_value 
         FROM sensor_measurements sm 
         WHERE sm.sensor_id = s.id 
         ORDER BY sm.measured_at DESC 
         LIMIT 1) as last_reading
      FROM sensors s
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE s.user_id = ? 
        AND r.room_code = ? 
        AND s.sensor_code LIKE 'REAL_%' 
        AND s.is_active = 1
      ORDER BY s.sensor_code`,
            [userId, location]
        );

        const onlineCount = sensors.filter(s => s.seconds_ago < 120).length;

        console.log(`✅ [Route] Retrieved ${sensors.length} real sensors (${onlineCount} online)`);
        res.json({
            status: "success",
            realSensors: sensors,
            onlineCount: onlineCount,
            totalCount: sensors.length,
            location: location
        });
    } catch (error) {
        console.error("❌ [Route GET /real-sensors/:location] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to fetch real sensors"
        });
    }
});

// ============================================
// POST /sensors - Create new sensor
// ============================================
spatialRouter.post("/sensors", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /sensors] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const {
            sensor_id,
            location,
            sensor_type,
            x_coordinate,
            y_coordinate,
            z_coordinate,
            calibration_offset = 0,
            mqtt_topic
        } = req.body;

        console.log(`🔵 [Route] Creating sensor: ${sensor_id} in ${location}`);

        // Get room_id
        const [rooms] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (rooms.length === 0) {
            return res.status(404).json({
                status: "failed",
                error: `Room not found for location: ${location}`
            });
        }

        const roomId = rooms[0].id;

        // Get sensor_type_id
        const [sensorTypes] = await pool.execute(
            'SELECT id FROM sensor_types WHERE type_code = ?',
            [sensor_type]
        );

        if (sensorTypes.length === 0) {
            return res.status(400).json({
                status: "failed",
                error: `Invalid sensor type: ${sensor_type}`
            });
        }

        const sensorTypeId = sensorTypes[0].id;

        // Insert sensor
        const [result] = await pool.execute(
            `INSERT INTO sensors 
       (user_id, room_id, sensor_type_id, sensor_code, sensor_name, 
        x_coordinate, y_coordinate, z_coordinate, calibration_offset, 
        mqtt_topic, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                userId,
                roomId,
                sensorTypeId,
                sensor_id,
                `${sensor_type} - ${sensor_id}`,
                x_coordinate || 0,
                y_coordinate || 0,
                z_coordinate || 0,
                calibration_offset,
                mqtt_topic || `${userId}/${location}/${sensor_type}/${sensor_id}`
            ]
        );

        console.log(`✅ [Route] Created sensor with ID: ${result.insertId}`);
        res.status(201).json({
            status: "success",
            message: "Sensor created successfully",
            sensorId: result.insertId,
            sensor_code: sensor_id
        });
    } catch (error) {
        console.error("❌ [Route POST /sensors] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to create sensor"
        });
    }
});

// ============================================
// PUT /sensors/:id - Update sensor
// ============================================
spatialRouter.put("/sensors/:id", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route PUT /sensors/:id] User: ${req.user.id}, Sensor: ${req.params.id}`);
    try {
        const userId = req.user.id;
        const sensorId = req.params.id;
        const {
            x_coordinate,
            y_coordinate,
            z_coordinate,
            calibration_offset,
            is_active
        } = req.body;

        console.log(`🔵 [Route] Updating sensor ${sensorId}`);

        // Build update query dynamically
        let updates = [];
        let params = [];

        if (x_coordinate !== undefined) {
            updates.push('x_coordinate = ?');
            params.push(x_coordinate);
        }
        if (y_coordinate !== undefined) {
            updates.push('y_coordinate = ?');
            params.push(y_coordinate);
        }
        if (z_coordinate !== undefined) {
            updates.push('z_coordinate = ?');
            params.push(z_coordinate);
        }
        if (calibration_offset !== undefined) {
            updates.push('calibration_offset = ?');
            params.push(calibration_offset);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            params.push(is_active ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                status: "failed",
                error: "No fields to update"
            });
        }

        params.push(userId, sensorId);

        const [result] = await pool.execute(
            `UPDATE sensors SET ${updates.join(', ')} WHERE user_id = ? AND id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "failed",
                error: "Sensor not found"
            });
        }

        console.log(`✅ [Route] Updated sensor ${sensorId}`);
        res.json({
            status: "success",
            message: "Sensor updated successfully"
        });
    } catch (error) {
        console.error("❌ [Route PUT /sensors/:id] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to update sensor"
        });
    }
});

// ============================================
// DELETE /sensors/:id - Delete sensor
// ============================================
spatialRouter.delete("/sensors/:id", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route DELETE /sensors/:id] User: ${req.user.id}, Sensor: ${req.params.id}`);
    try {
        const userId = req.user.id;
        const sensorId = req.params.id;

        console.log(`🔵 [Route] Deleting sensor ${sensorId}`);

        // Soft delete (set is_active = 0)
        const [result] = await pool.execute(
            'UPDATE sensors SET is_active = 0 WHERE user_id = ? AND id = ?',
            [userId, sensorId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "failed",
                error: "Sensor not found"
            });
        }

        console.log(`✅ [Route] Deleted sensor ${sensorId}`);
        res.json({
            status: "success",
            message: "Sensor deleted successfully"
        });
    } catch (error) {
        console.error("❌ [Route DELETE /sensors/:id] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to delete sensor"
        });
    }
});

// ============================================
// POST /actuators - Create new actuator
// ============================================
spatialRouter.post("/actuators", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route POST /actuators] User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const {
            actuator_id,
            location,
            actuator_type,
            x_coordinate,
            y_coordinate,
            z_coordinate,
            max_power = 100,
            influence_radius = 1.0,
            mqtt_topic
        } = req.body;

        console.log(`🔵 [Route] Creating actuator: ${actuator_id} in ${location}`);

        // Get room_id
        const [rooms] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (rooms.length === 0) {
            return res.status(404).json({
                status: "failed",
                error: `Room not found for location: ${location}`
            });
        }

        const roomId = rooms[0].id;

        // Get actuator_type_id
        const [actuatorTypes] = await pool.execute(
            'SELECT id FROM actuator_types WHERE type_code = ?',
            [actuator_type]
        );

        if (actuatorTypes.length === 0) {
            return res.status(400).json({
                status: "failed",
                error: `Invalid actuator type: ${actuator_type}`
            });
        }

        const actuatorTypeId = actuatorTypes[0].id;

        // Insert actuator
        const [result] = await pool.execute(
            `INSERT INTO actuators 
       (user_id, room_id, actuator_type_id, actuator_code, actuator_name, 
        x_coordinate, y_coordinate, z_coordinate, max_power, influence_radius,
        mqtt_topic, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                userId,
                roomId,
                actuatorTypeId,
                actuator_id,
                `${actuator_type} - ${actuator_id}`,
                x_coordinate || 0,
                y_coordinate || 0,
                z_coordinate || 0,
                max_power,
                influence_radius,
                mqtt_topic || `${userId}/${location}/control/${actuator_type}/${actuator_id}`
            ]
        );

        console.log(`✅ [Route] Created actuator with ID: ${result.insertId}`);
        res.status(201).json({
            status: "success",
            message: "Actuator created successfully",
            actuatorId: result.insertId,
            actuator_code: actuator_id
        });
    } catch (error) {
        console.error("❌ [Route POST /actuators] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to create actuator"
        });
    }
});

// ============================================
// PUT /actuators/:id - Update actuator
// ============================================
spatialRouter.put("/actuators/:id", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route PUT /actuators/:id] User: ${req.user.id}, Actuator: ${req.params.id}`);
    try {
        const userId = req.user.id;
        const actuatorId = req.params.id;
        const {
            x_coordinate,
            y_coordinate,
            z_coordinate,
            max_power,
            influence_radius,
            is_active
        } = req.body;

        console.log(`🔵 [Route] Updating actuator ${actuatorId}`);

        // Build update query dynamically
        let updates = [];
        let params = [];

        if (x_coordinate !== undefined) {
            updates.push('x_coordinate = ?');
            params.push(x_coordinate);
        }
        if (y_coordinate !== undefined) {
            updates.push('y_coordinate = ?');
            params.push(y_coordinate);
        }
        if (z_coordinate !== undefined) {
            updates.push('z_coordinate = ?');
            params.push(z_coordinate);
        }
        if (max_power !== undefined) {
            updates.push('max_power = ?');
            params.push(max_power);
        }
        if (influence_radius !== undefined) {
            updates.push('influence_radius = ?');
            params.push(influence_radius);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            params.push(is_active ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                status: "failed",
                error: "No fields to update"
            });
        }

        params.push(userId, actuatorId);

        const [result] = await pool.execute(
            `UPDATE actuators SET ${updates.join(', ')} WHERE user_id = ? AND id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "failed",
                error: "Actuator not found"
            });
        }

        console.log(`✅ [Route] Updated actuator ${actuatorId}`);
        res.json({
            status: "success",
            message: "Actuator updated successfully"
        });
    } catch (error) {
        console.error("❌ [Route PUT /actuators/:id] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to update actuator"
        });
    }
});

// ============================================
// DELETE /actuators/:id - Delete actuator
// ============================================
spatialRouter.delete("/actuators/:id", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route DELETE /actuators/:id] User: ${req.user.id}, Actuator: ${req.params.id}`);
    try {
        const userId = req.user.id;
        const actuatorId = req.params.id;

        console.log(`🔵 [Route] Deleting actuator ${actuatorId}`);

        // Soft delete (set is_active = 0)
        const [result] = await pool.execute(
            'UPDATE actuators SET is_active = 0 WHERE user_id = ? AND id = ?',
            [userId, actuatorId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "failed",
                error: "Actuator not found"
            });
        }

        console.log(`✅ [Route] Deleted actuator ${actuatorId}`);
        res.json({
            status: "success",
            message: "Actuator deleted successfully"
        });
    } catch (error) {
        console.error("❌ [Route DELETE /actuators/:id] Error:", error.message);
        res.status(500).json({
            status: "failed",
            error: "Failed to delete actuator"
        });
    }
});

console.log("✅ [Spatial Routes] All routes initialized");
module.exports = spatialRouter;
