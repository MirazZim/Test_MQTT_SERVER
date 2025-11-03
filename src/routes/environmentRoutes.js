const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");
const router = express.Router();

console.log("🟢 [Environment Routes] Loading...");

// Get sensor measurements by sensor ID
router.get("/:sensorId", adminOrUser, async (req, res) => {
    console.log(`\n🔵 ========== GET /api/environment/${req.params.sensorId} ==========`);
    console.log(`   User ID: ${req.user.id}`);
    console.log(`   Period: ${req.query.period || '24h'}`);

    try {
        const { sensorId } = req.params;
        const { period = "24h" } = req.query;
        const userId = req.user.id;

        const periodMap = {
            "1h": "1 HOUR",
            "6h": "6 HOUR",
            "24h": "24 HOUR",
            "7d": "7 DAY",
            "30d": "30 DAY"
        };
        const interval = periodMap[period] || "24 HOUR";

        console.log(`   Interval: ${interval}`);

        // Verify sensor ownership
        console.log(`   Checking sensor ownership...`);
        const [sensorCheck] = await pool.execute(
            `SELECT s.id, s.sensor_name, st.type_code, st.unit 
       FROM sensors s
       JOIN sensor_types st ON s.sensor_type_id = st.id
       WHERE s.id = ? AND s.user_id = ? AND s.is_active = 1`,
            [sensorId, userId]
        );

        if (sensorCheck.length === 0) {
            console.log(`   ❌ Sensor not found or access denied`);
            return res.status(404).json({
                status: "error",
                message: "Sensor not found or access denied"
            });
        }

        console.log(`   ✅ Sensor verified: ${sensorCheck[0].sensor_name}`);

        // Fetch measurements
        console.log(`   Fetching measurements...`);
        const [measurements] = await pool.execute(
            `SELECT 
        measured_value as value,
        measured_at as timestamp,
        quality_indicator,
        is_anomaly
       FROM sensor_measurements
       WHERE sensor_id = ? 
       AND measured_at >= NOW() - INTERVAL ${interval}
       ORDER BY measured_at ASC
       LIMIT 10000`,
            [sensorId]
        );

        console.log(`   ✅ Found ${measurements.length} measurements`);

        const chartData = measurements.map(m => ({
            timestamp: new Date(m.timestamp).toISOString(),
            value: parseFloat(m.value),
            quality: m.quality_indicator,
            anomaly: m.is_anomaly
        }));

        return res.status(200).json({
            status: "success",
            sensor: sensorCheck[0],
            period,
            dataPoints: chartData.length,
            data: chartData
        });

    } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve sensor data",
            error: error.message
        });
    }
});

console.log("✅ [Environment Routes] Loaded successfully");
module.exports = router;
