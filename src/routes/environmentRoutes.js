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
    console.log(`   Timestamp: ${new Date().toISOString()}`);

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

        console.log(`   SQL Interval: ${interval}`);

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

        console.log(`   ✅ Sensor verified: ${sensorCheck[0].sensor_name} (${sensorCheck[0].type_code})`);

        // Fetch measurements
        console.log(`   Fetching measurements from NOW() - INTERVAL ${interval}...`);
        const startTime = new Date();

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

        const queryTime = new Date() - startTime;
        console.log(`   ⏱️  Query took ${queryTime}ms`);
        console.log(`   ✅ Found ${measurements.length} measurements`);

        if (measurements.length > 0) {
            console.log(`   📊 First: ${measurements[0].timestamp} = ${measurements[0].value}`);
            console.log(`   📊 Last: ${measurements[measurements.length - 1].timestamp} = ${measurements[measurements.length - 1].value}`);
        }

        // Process chart data
        const chartData = measurements.map(m => ({
            timestamp: new Date(m.timestamp).toISOString(),
            value: parseFloat(m.value),
            quality: m.quality_indicator,
            anomaly: m.is_anomaly
        }));

        // Set cache-control headers to prevent 304
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });

        console.log(`   ✅ Sending ${chartData.length} data points`);
        console.log(`   🏁 Request complete\n`);

        return res.status(200).json({
            status: "success",
            sensor: {
                id: sensorCheck[0].id,
                name: sensorCheck[0].sensor_name,
                type: sensorCheck[0].type_code,
                unit: sensorCheck[0].unit
            },
            period,
            interval,
            dataPoints: chartData.length,
            data: chartData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        console.error(`   Stack:`, error.stack);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve sensor data",
            error: error.message
        });
    }
});


console.log("✅ [Environment Routes] Loaded successfully");
module.exports = router;
