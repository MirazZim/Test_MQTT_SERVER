// routes/actuatorRoutes.js
const express = require('express');
const { adminOrUser } = require('../middleware/auth');
const pool = require('../config/db');

const actuatorRouter = express.Router();

// ✅ Changed from '/room-actuators' to '/' to match frontend
actuatorRouter.get('/', adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /api/actuators] User: ${req.user.id}`);

    try {
        const roomCode = req.query.roomCode;
        const userId = req.user.id;

        if (!roomCode) {
            return res.status(400).json({
                status: "failed",
                message: "roomCode parameter is required"
            });
        }

        console.log(`🔍 [Route] Fetching actuators for room: ${roomCode}`);

        // Get room_id
        const [roomRows] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, roomCode]
        );

        if (roomRows.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: `Room '${roomCode}' not found or access denied`
            });
        }

        const roomId = roomRows[0].id;

        // Get all actuators with type information
        const [actuators] = await pool.execute(
            `SELECT 
                a.id,
                a.actuator_code,
                a.actuator_name,
                a.mqtt_topic,
                a.current_state,
                a.is_active,
                a.updated_at,
                at.id as type_id,
                at.type_code as actuator_type_code,
                at.type_name as actuator_type_name,
                at.control_type,
                at.category
            FROM actuators a
            INNER JOIN actuator_types at ON a.actuator_type_id = at.id
            WHERE a.room_id = ? AND a.is_active = 1
            ORDER BY at.category, a.actuator_name`,
            [roomId]
        );

        console.log(`✅ [Route] Retrieved ${actuators.length} actuators for room ${roomCode}`);

        res.status(200).json({
            status: "success",
            message: "Actuators retrieved successfully",
            actuators: actuators  // ✅ Return directly in response root for frontend compatibility
        });

    } catch (error) {
        console.error("❌ [Route GET /api/actuators] Error:", error);

        res.status(500).json({
            status: "failed",
            message: "Failed to retrieve actuators"
        });
    }
});

module.exports = actuatorRouter;
