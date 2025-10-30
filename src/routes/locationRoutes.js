// const express = require("express");
// const { adminOrUser } = require("../middleware/auth");
// const Measurement = require("../models/Measurement");
// const pool = require("../config/db");

// const locationRouter = express.Router();

// // Get user's locations
// locationRouter.get("/locations", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const locations = await Measurement.getUserLocations(userId);

//         res.json({
//             status: "success",
//             message: "User locations retrieved successfully",
//             locations
//         });
//     } catch (error) {
//         console.error("Error getting user locations:", error);
//         res.status(500).json({ status: "failed", message: "Internal server error" });
//     }
// });

// // NEW: Initialize location (creates initial measurement for simulation)
// locationRouter.post("/locations/:location/initialize", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);

//         // Check if location already has measurements
//         const existing = await Measurement.getLatestForUser(userId, location);

//         if (!existing) {
//             // Create initial measurement to enable simulation
//             await Measurement.create({
//                 user_id: userId,
//                 temperature: null,
//                 humidity: null,
//                 airflow: null,
//                 location
//             });

//             console.log(`📍 Initialized location "${location}" for user ${userId}`);
//         }

//         // Add location to MQTT handler for simulation
//         const { mqttClient } = require("../server");
//         if (mqttClient && mqttClient.addLocationForUser) {
//             mqttClient.addLocationForUser(userId, location);
//         }

//         res.json({
//             status: "success",
//             message: `Location "${location}" initialized successfully`,
//             location
//         });

//     } catch (error) {
//         console.error("Error initializing location:", error);
//         res.status(500).json({ status: "failed", message: "Internal server error" });
//     }
// });

// // Get measurements for specific location
// locationRouter.get("/locations/:location/measurements", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);
//         const days = parseInt(req.query.days) || 7;

//         const [rows] = await pool.execute(
//             `SELECT * FROM measurements 
//        WHERE user_id = ? AND location = ? 
//        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
//        ORDER BY created_at DESC LIMIT 100`,
//             [userId, location, days]
//         );

//         res.json({
//             status: "success",
//             message: `Measurements for ${location} retrieved successfully`,
//             location,
//             measurements: rows
//         });
//     } catch (error) {
//         console.error("Error getting location measurements:", error);
//         res.status(500).json({ status: "failed", message: "Internal server error" });
//     }
// });

// // Get latest measurement for specific location
// locationRouter.get("/locations/:location/latest", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);

//         const latest = await Measurement.getLatestForUser(userId, location);

//         res.json({
//             status: "success",
//             message: `Latest measurement for ${location} retrieved`,
//             location,
//             measurement: latest
//         });
//     } catch (error) {
//         console.error("Error getting latest measurement:", error);
//         res.status(500).json({ status: "failed", message: "Internal server error" });
//     }
// });

// // Get control state for specific location
// locationRouter.get("/locations/:location/control", adminOrUser, async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const location = decodeURIComponent(req.params.location);

//         const [rows] = await pool.execute(
//             "SELECT * FROM device_control_states WHERE user_id = ? AND location = ?",
//             [userId, location]
//         );

//         const controlState = rows[0] || {
//             heater_state: false,
//             cooler_state: false,
//             humidifier_state: false,
//             dehumidifier_state: false,
//             fan_level: 0,
//             control_mode: 'auto'
//         };

//         res.json({
//             status: "success",
//             message: `Control state for ${location} retrieved`,
//             location,
//             controlState
//         });
//     } catch (error) {
//         console.error("Error getting control state:", error);
//         res.status(500).json({ status: "failed", message: "Internal server error" });
//     }
// });

// module.exports = locationRouter;
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");

const locationRouter = express.Router();

// Updated: Get locations from rooms table (added room_id support)
locationRouter.get("/locations", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const [rows] = await pool.execute("SELECT room_code as location FROM rooms WHERE user_id = ?", [userId]);
        const locations = rows.map(r => r.location);
        res.json({
            status: "success",
            message: "User locations retrieved successfully",
            locations
        });
    } catch (error) {
        console.error("Error getting user locations:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Updated: Initialize as room creation (new schema, added room_id)
locationRouter.post("/locations/:location/initialize", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const roomCode = decodeURIComponent(req.params.location);
        const roomName = roomCode.replace('-', ' ').toUpperCase();  // Derive name from code

        const [existing] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, roomCode]);

        if (existing.length === 0) {
            await pool.execute(
                "INSERT INTO rooms (user_id, room_name, room_code, description, is_active) VALUES (?, ?, ?, 'Initialized room', 1)",
                [userId, roomName, roomCode]
            );
            const [newRoom] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, roomCode]);
            const roomId = newRoom[0].id;

            // Initialize control settings
            await pool.execute("INSERT INTO room_control_settings (room_id) VALUES (?)", [roomId]);
        }

        // Add location to MQTT handler for simulation (kept as-is)
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.addLocationForUser) {
            mqttClient.addLocationForUser(userId, roomCode);
        }

        res.json({
            status: "success",
            message: `Location "${roomCode}" initialized successfully`,
            location: roomCode
        });
    } catch (error) {
        console.error("Error initializing location:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Updated: Measurements per sensor/type (new schema, from sensor_measurements + joins)
locationRouter.get("/locations/:location/measurements", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const roomCode = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const [rooms] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, roomCode]);
        if (rooms.length === 0) return res.status(404).json({ status: "error", message: "Room not found" });
        const roomId = rooms[0].id;

        const [measurements] = await pool.execute(
            `SELECT sm.id, s.sensor_code, st.type_code, sm.measured_value, sm.measured_at 
             FROM sensor_measurements sm
             JOIN sensors s ON sm.sensor_id = s.id
             JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE s.room_id = ? 
             AND sm.measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY sm.measured_at DESC LIMIT 100`,
            [roomId, days]
        );

        res.json({
            status: "success",
            message: `Measurements for ${roomCode} retrieved successfully`,
            location: roomCode,
            measurements: measurements
        });
    } catch (error) {
        console.error("Error getting location measurements:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Updated: Latest as aggregated per type (new schema)
locationRouter.get("/locations/:location/latest", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const roomCode = decodeURIComponent(req.params.location);

        const [rooms] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, roomCode]);
        if (rooms.length === 0) return res.status(404).json({ status: "error", message: "Room not found" });
        const roomId = rooms[0].id;

        const [latest] = await pool.execute(
            `SELECT st.type_code, AVG(sm.measured_value) as value, MAX(sm.measured_at) as last_at
             FROM sensor_measurements sm
             JOIN sensors s ON sm.sensor_id = s.id
             JOIN sensor_types st ON s.sensor_type_id = st.id
             WHERE s.room_id = ? 
             GROUP BY st.id
             ORDER BY st.type_code`,
            [roomId]
        );

        const measurement = latest.reduce((acc, r) => ({ ...acc, [r.type_code]: r.value }), {});

        res.json({
            status: "success",
            message: `Latest measurement for ${roomCode} retrieved`,
            location: roomCode,
            measurement
        });
    } catch (error) {
        console.error("Error getting latest measurement:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Updated: Control from room_control_settings + actuator_states (new schema)
locationRouter.get("/locations/:location/control", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const roomCode = decodeURIComponent(req.params.location);

        const [rooms] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, roomCode]);
        if (rooms.length === 0) return res.status(404).json({ status: "error", message: "Room not found" });
        const roomId = rooms[0].id;

        const [settings] = await pool.execute("SELECT control_mode FROM room_control_settings WHERE room_id = ?", [roomId]);
        const controlMode = settings[0] ? settings[0].control_mode : 'auto';

        const [states] = await pool.execute("SELECT actuator_type, state FROM actuator_states WHERE room_id = ?", [roomId]);

        const controlState = {
            heater_state: states.find(s => s.actuator_type === 'heater')?.state || false,
            cooler_state: states.find(s => s.actuator_type === 'cooler')?.state || false,
            humidifier_state: states.find(s => s.actuator_type === 'humidifier')?.state || false,
            dehumidifier_state: states.find(s => s.actuator_type === 'dehumidifier')?.state || false,
            fan_level: states.find(s => s.actuator_type === 'fan')?.state || 0,
            control_mode: controlMode
        };

        res.json({
            status: "success",
            message: `Control state for ${roomCode} retrieved`,
            location: roomCode,
            controlState
        });
    } catch (error) {
        console.error("Error getting control state:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

module.exports = locationRouter;