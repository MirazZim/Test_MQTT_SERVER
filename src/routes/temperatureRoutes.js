// routes/temperatureRoutes.js
// ✅ ALREADY COMPATIBLE - No changes needed
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const { getAllTemperatures } = require("../main/temperatures/get-all-temperatures");
const { getTemperatureHistory } = require("../main/temperatures/get-temperature-history");
const { getLatestTemperature } = require("../main/temperatures/get-latest-temperature");

const temperatureRouter = express.Router();

console.log("🔵 [Temperature Routes] Initializing routes");

temperatureRouter.get("/", adminOrUser, async (req, res) => {
  console.log(`🔵 [Route /] GET all temperatures - User: ${req.user.id}`);
  getAllTemperatures(req.user)
    .then((data) => {
      console.log(`✅ [Route /] Success - returning ${data.temperatures.length} records`);
      return res.status(200).send({
        status: data.status,
        message: data.message,
        temperatures: data.temperatures,
      });
    })
    .catch((error) => {
      console.error(`❌ [Route /] Error:`, error.message);
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

// Bowl history route
temperatureRouter.get("/bowl-history", adminOrUser, async (req, res) => {
  console.log(`🔵 [Route /bowl-history] GET bowl temp history - User: ${req.user.id}`);
  try {
    const days = 7;
    const location = req.query.location || 'sensor-room';
    const Measurement = require("../models/Temperature");

    const history = await Measurement.getBowlTempHistory(
      req.user.id,
      location,
      days
    );

    console.log(`✅ [Route /bowl-history] Retrieved ${history.length} records`);
    return res.status(200).json({
      status: "success",
      message: `Bowl temperature history for ${days} days`,
      data: history
    });
  } catch (error) {
    console.error("❌ [Route /bowl-history] Error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve bowl temperature history"
    });
  }
});

// Bowl history with days parameter
temperatureRouter.get("/bowl-history/:days", adminOrUser, async (req, res) => {
  const days = parseInt(req.params.days) || 7;
  console.log(`🔵 [Route /bowl-history/:days] GET ${days} days - User: ${req.user.id}`);
  try {
    const location = req.query.location || 'sensor-room';
    const Measurement = require("../models/Temperature");

    const history = await Measurement.getBowlTempHistory(
      req.user.id,
      location,
      days
    );

    console.log(`✅ [Route /bowl-history/:days] Retrieved ${history.length} records`);
    return res.status(200).json({
      status: "success",
      message: `Bowl temperature history for ${days} days`,
      data: history
    });
  } catch (error) {
    console.error("❌ [Route /bowl-history/:days] Error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve bowl temperature history"
    });
  }
});

// Temperature history
temperatureRouter.get("/history", adminOrUser, async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  console.log(`🔵 [Route /history] GET ${days} days history - User: ${req.user.id}`);

  getTemperatureHistory(req.user, { days })
    .then((data) => {
      console.log(`✅ [Route /history] Success - ${data.history.length} records`);
      return res.status(200).send({
        status: data.status,
        message: data.message,
        history: data.history,
      });
    })
    .catch((error) => {
      console.error(`❌ [Route /history] Error:`, error.message);
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

// Temperature history with days parameter
temperatureRouter.get("/history/:days", adminOrUser, async (req, res) => {
  const days = parseInt(req.params.days) || 7;
  console.log(`🔵 [Route /history/:days] GET ${days} days - User: ${req.user.id}`);

  getTemperatureHistory(req.user, { days })
    .then((data) => {
      console.log(`✅ [Route /history/:days] Success - ${data.history.length} records`);
      return res.status(200).send({
        status: data.status,
        message: data.message,
        history: data.history,
      });
    })
    .catch((error) => {
      console.error(`❌ [Route /history/:days] Error:`, error.message);
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

// Latest temperature
temperatureRouter.get("/latest", adminOrUser, async (req, res) => {
  console.log(`🔵 [Route /latest] GET latest temperature - User: ${req.user.id}`);

  getLatestTemperature(req.user)
    .then((data) => {
      console.log(`✅ [Route /latest] Success`);
      return res.status(200).send({
        status: data.status,
        message: data.message,
        temperature: data.temperature,
      });
    })
    .catch((error) => {
      console.error(`❌ [Route /latest] Error:`, error.message);
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

console.log("✅ [Temperature Routes] All routes initialized");
module.exports = temperatureRouter;
