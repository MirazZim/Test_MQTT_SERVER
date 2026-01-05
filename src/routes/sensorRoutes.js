const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");
const router = express.Router();

console.log("🟢 [Sensor Routes] Loading...");

// Get all sensors for authenticated user
router.get("/", adminOrUser, async (req, res) => {
    console.log(`\n🔵 ========== GET /api/sensors ==========`);
    console.log(`   User ID: ${req.user.id}`);
    console.log(`   Username: ${req.user.username}`);

    try {
        const userId = req.user.id;

        console.log(`   Querying database for user ${userId}...`);

        const [sensors] = await pool.execute(
            `SELECT 
        s.id,
        s.sensor_code,
        s.sensor_name,
        s.is_active,
        st.type_code,
        st.type_name,
        st.unit,
        r.room_name,
        r.room_code
       FROM sensors s
       JOIN sensor_types st ON s.sensor_type_id = st.id
       LEFT JOIN rooms r ON s.room_id = r.id
       WHERE s.user_id = ?
       ORDER BY st.type_code, s.sensor_name`,
            [userId]
        );

        console.log(`   ✅ Query successful - Found ${sensors.length} sensors`);

        if (sensors.length > 0) {
            console.log(`   First sensor: ${sensors[0].sensor_name} (ID: ${sensors[0].id})`);
        } else {
            console.log(`   ⚠️ No sensors found for user ${userId}`);
        }

        return res.status(200).json({
            status: "success",
            message: "Sensors retrieved successfully",
            sensors: sensors,
        });

    } catch (error) {
        console.error(`   ❌ Database error:`, error.message);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve sensors",
            error: error.message,
        });
    }
});

// Get CO2 polling status
router.get("/co2/polling-status", adminOrUser, async (req, res) => {
    console.log(`\n🔵 ========== GET /api/sensors/co2/polling-status ==========`);
    
    try {
        // Get the MQTT handler instance from the app
        const mqttHandler = req.app.get('mqttHandler');
        
        if (!mqttHandler) {
            return res.status(503).json({
                status: "error",
                message: "MQTT handler not initialized"
            });
        }

        const pollingStatus = mqttHandler.getCO2PollingStatus();
        
        console.log(`   ✅ Polling status retrieved:`, pollingStatus);
        
        return res.status(200).json({
            status: "success",
            message: "CO2 polling status retrieved",
            data: pollingStatus
        });

    } catch (error) {
        console.error(`   ❌ Error getting polling status:`, error.message);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve polling status",
            error: error.message
        });
    }
});

console.log("✅ [Sensor Routes] Loaded successfully");
module.exports = router;
