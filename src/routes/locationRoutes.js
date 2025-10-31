const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const Measurement = require("../models/Measurement");
const pool = require("../config/db");

const locationRouter = express.Router();

// Get user's locations
locationRouter.get("/locations", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const locations = await Measurement.getUserLocations(userId);

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

// NEW: Initialize location (creates initial measurement for simulation)
locationRouter.post("/locations/:location/initialize", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        // Check if location already has measurements
        const existing = await Measurement.getLatestForUser(userId, location);

        if (!existing) {
            // Create initial measurement to enable simulation
            await Measurement.create({
                user_id: userId,
                temperature: null,
                humidity: null,
                airflow: null,
                location
            });

            console.log(`📍 Initialized location "${location}" for user ${userId}`);
        }

        // Add location to MQTT handler for simulation
        const { mqttClient } = require("../server");
        if (mqttClient && mqttClient.addLocationForUser) {
            mqttClient.addLocationForUser(userId, location);
        }

        res.json({
            status: "success",
            message: `Location "${location}" initialized successfully`,
            location
        });

    } catch (error) {
        console.error("Error initializing location:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Get measurements for specific location
locationRouter.get("/locations/:location/measurements", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);
        const days = parseInt(req.query.days) || 7;

        const [rows] = await pool.execute(
            `SELECT * FROM measurements
       WHERE user_id = ? AND location = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY created_at DESC LIMIT 100`,
            [userId, location, days]
        );

        res.json({
            status: "success",
            message: `Measurements for ${location} retrieved successfully`,
            location,
            measurements: rows
        });
    } catch (error) {
        console.error("Error getting location measurements:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Get latest measurement for specific location
locationRouter.get("/locations/:location/latest", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const latest = await Measurement.getLatestForUser(userId, location);

        res.json({
            status: "success",
            message: `Latest measurement for ${location} retrieved`,
            location,
            measurement: latest
        });
    } catch (error) {
        console.error("Error getting latest measurement:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

// Get control state for specific location
locationRouter.get("/locations/:location/control", adminOrUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const location = decodeURIComponent(req.params.location);

        const [rows] = await pool.execute(
            "SELECT * FROM device_control_states WHERE user_id = ? AND location = ?",
            [userId, location]
        );

        const controlState = rows[0] || {
            heater_state: false,
            cooler_state: false,
            humidifier_state: false,
            dehumidifier_state: false,
            fan_level: 0,
            control_mode: 'auto'
        };

        res.json({
            status: "success",
            message: `Control state for ${location} retrieved`,
            location,
            controlState
        });
    } catch (error) {
        console.error("Error getting control state:", error);
        res.status(500).json({ status: "failed", message: "Internal server error" });
    }
});

module.exports = locationRouter;


