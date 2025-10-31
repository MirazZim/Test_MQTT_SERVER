// routes/locationRoutes.js
// ✅ UPDATED FOR redesigned_iot_database schema
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const Measurement = require("../models/Measurement");
const pool = require("../config/db");

const locationRouter = express.Router();

console.log("🔵 [Location Routes] Initializing routes");

// Get user's locations (rooms)
locationRouter.get("/locations", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations] GET user locations - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const locations = await Measurement.getUserLocations(userId);

        console.log(`✅ [Route /locations] Retrieved ${locations.length} locations`);
        res.json({
            status: "success",
            message: "User locations retrieved successfully",
            locations
        });
    } catch (error) {
        console.error("❌ [Route /locations] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Initialize location (create room with sensors)
locationRouter.post("/locations/:location/initialize", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/initialize] POST - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        console.log(`🔵 [Route] Initializing location: ${location}`);

        // Check if room already exists
        const [existingRooms] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ?',
            [userId, location]
        );

        let roomId;

        if (existingRooms.length === 0) {
            // Create new room
            const [roomResult] = await pool.execute(
                `INSERT INTO rooms (user_id, room_name, room_code, description, is_active) 
         VALUES (?, ?, ?, ?, 1)`,
                [userId, `Room ${location}`, location, `Auto-created room for ${location}`]
            );

            roomId = roomResult.insertId;
            console.log(`✅ [Route] Created new room with ID: ${roomId}`);

            // Create sensors for this room
            await pool.execute(
                `INSERT INTO sensors (user_id, room_id, sensor_type_id, sensor_code, sensor_name, mqtt_topic, is_active)
         SELECT 
           ?,
           ?,
           id,
           CONCAT(type_code, '_', UPPER(?), '_001'),
           CONCAT(type_name, ' - ', ?),
           CONCAT(?, '/', ?, '/', type_code),
           1
         FROM sensor_types
         WHERE is_system_type = 1`,
                [userId, roomId, location, location, userId, location]
            );

            console.log(`✅ [Route] Created sensors for room ${location}`);
        } else {
            roomId = existingRooms[0].id;
            console.log(`✅ [Route] Room already exists with ID: ${roomId}`);
        }

        // Register location with MQTT handler
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.registerUser) {
            mqttClient.registerUser(userId, location);
            console.log(`✅ [Route] Registered user ${userId} with MQTT for location: ${location}`);
        }

        res.json({
            status: "success",
            message: `Location "${location}" initialized successfully`,
            location,
            roomId
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/initialize] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get measurements for specific location
locationRouter.get("/locations/:location/measurements", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/measurements] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const measurements = await Measurement.getAllByUserAndLocation(userId, location, days);

        console.log(`✅ [Route] Retrieved ${measurements.length} measurements for ${location}`);
        res.json({
            status: "success",
            message: `Measurements for ${location} retrieved successfully`,
            location,
            measurements
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/measurements] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get latest measurement for specific location
locationRouter.get("/locations/:location/latest", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/latest] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const latest = await Measurement.getLatestForUser(userId, location);

        console.log(`✅ [Route] Latest measurement for ${location}: ${latest ? 'Found' : 'None'}`);
        res.json({
            status: "success",
            message: `Latest measurement for ${location} retrieved`,
            location,
            measurement: latest
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/latest] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get all sensor data for a location
locationRouter.get("/locations/:location/sensors", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/sensors] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const sensorData = await Measurement.getLocationSensorData(userId, location);

        console.log(`✅ [Route] Retrieved data for ${sensorData.length} sensors in ${location}`);
        res.json({
            status: "success",
            message: `Sensor data for ${location} retrieved successfully`,
            location,
            sensors: sensorData
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/sensors] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get statistics for a location
locationRouter.get("/locations/:location/stats", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/stats] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const stats = await Measurement.getLocationStats(userId, location, days);

        console.log(`✅ [Route] Retrieved stats for ${location}`);
        res.json({
            status: "success",
            message: `Statistics for ${location} retrieved successfully`,
            location,
            stats,
            days
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/stats] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get control state for specific location (actuators)
locationRouter.get("/locations/:location/control", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/control] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        // Get actuator states for this room
        const [actuators] = await pool.execute(
            `SELECT 
        a.id,
        a.actuator_name,
        a.actuator_code,
        at.type_code,
        at.type_name,
        a.current_state,
        a.target_state,
        a.last_command_at
      FROM actuators a
      INNER JOIN actuator_types at ON a.actuator_type_id = at.id
      INNER JOIN rooms r ON a.room_id = r.id
      WHERE a.user_id = ? 
        AND r.room_code = ? 
        AND a.is_active = 1`,
            [userId, location]
        );

        console.log(`✅ [Route] Retrieved ${actuators.length} actuators for ${location}`);
        res.json({
            status: "success",
            message: `Control state for ${location} retrieved`,
            location,
            actuators
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/control] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

// Get bowl temperature history for location
locationRouter.get("/locations/:location/bowl-history", adminOrUser, async (req, res) => {
    console.log(`🔵 [Route /locations/:location/bowl-history] GET - User: ${req.user.id}`);
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const history = await Measurement.getBowlTempHistory(userId, location, days);

        console.log(`✅ [Route] Retrieved ${history.length} bowl temp records for ${location}`);
        res.json({
            status: "success",
            message: `Bowl temperature history for ${location} retrieved`,
            location,
            history,
            days
        });
    } catch (error) {
        console.error("❌ [Route /locations/:location/bowl-history] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

console.log("✅ [Location Routes] All routes initialized");
module.exports = locationRouter;
