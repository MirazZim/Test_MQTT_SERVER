const authRoutes = require("./authRoutes");
const deviceRoutes = require("./deviceRoutes");
const userRoutes = require("./userRoutes");
const temperatureRoutes = require("./temperatureRoutes");
const temperatureControlRoutes = require("./temperatureControlRoutes");
const locationRoutes = require("./locationRoutes");
const spatialRoutes = require("./spatialRoutes");
const adminRoutes = require("./adminRoutes");
const cameraRoutes = require("./cameraRoutes");
const environmentRoutes = require("./environmentRoutes");
const sensorRoutes = require("./sensorRoutes");

const setupRoutes = (app) => {
    app.use("/api", authRoutes);
    app.use("/api", deviceRoutes);
    app.use("/api", userRoutes);
    app.use("/api/temperature", temperatureRoutes);
    app.use("/api/temperature", temperatureControlRoutes);
    app.use("/api", locationRoutes);
    app.use("/api/spatial", spatialRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/camera", cameraRoutes);
    app.use("/api/environment", environmentRoutes);
    app.use("/api/sensors", sensorRoutes);

    // Health check endpoint
    app.get("/health", (req, res) => {
        res.json({ status: "OK", timestamp: new Date().toISOString() });
    });
};

module.exports = { setupRoutes };
