// routes/actuatorRoutes.js (create new file or add to existing routes)
const express = require('express');
const { adminOrUser } = require('../middleware/auth');
const pool = require('../config/db');

const actuatorRouter = express.Router();

// ✅ Get all actuators for a room
actuatorRouter.get('/room-actuators', adminOrUser, async (req, res) => {
    console.log(`🔵 [Route GET /room-actuators] User: ${req.user.id}`);

    try {
        const location = req.query.location || 'sensor-room';
        const userId = req.user.id;

        // Get room_id
        const [roomRows] = await pool.execute(
            'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
            [userId, location]
        );

        if (roomRows.length === 0) {
            return res.status(404).json({
                status: "failed",
                message: `Room not found for location: ${location}`
            });
        }

        const roomId = roomRows[0].id;

        // Get all actuators for this room
        const [actuators] = await pool.execute(
            `SELECT 
                a.id,
                a.actuator_code,
                a.actuator_name,
                a.mqtt_topic,
                a.current_state,
                a.is_active,
                at.id as type_id,
                at.type_code,
                at.type_name,
                at.control_type,
                at.category
            FROM actuators a
            INNER JOIN actuator_types at ON a.actuator_type_id = at.id
            WHERE a.room_id = ? AND a.is_active = 1
            ORDER BY at.category, a.actuator_name`,
            [roomId]
        );

        console.log(`✅ [Route] Retrieved ${actuators.length} actuators for room ${location}`);

        res.status(200).json({
            status: "success",
            message: "Actuators retrieved successfully",
            data: {
                roomId,
                location,
                actuators
            }
        });

    } catch (error) {
        console.error("❌ [Route GET /room-actuators] Error:", error.message);
        res.status(500).json({
            status: "failed",
            message: "Internal server error"
        });
    }
});

module.exports = actuatorRouter;
