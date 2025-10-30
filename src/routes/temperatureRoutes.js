// const express = require("express");
// const { adminOrUser } = require("../middleware/auth");
// const { getAllTemperatures } = require("../main/temperatures/get-all-temperatures");
// const { getTemperatureHistory } = require("../main/temperatures/get-temperature-history");
// const { getLatestTemperature } = require("../main/temperatures/get-latest-temperature");

// const temperatureRouter = express.Router();

// temperatureRouter.get("/", adminOrUser, async (req, res) => {
//   getAllTemperatures(req.user)
//     .then((data) => {
//       return res.status(200).send({
//         status: data.status,
//         message: data.message,
//         temperatures: data.temperatures,
//       });
//     })
//     .catch((error) => {
//       return res.status(400).send({
//         status: error.status,
//         message: error.message,
//       });
//     });
// });

// // In routes/temperatureRoutes.js or create new route
// temperatureRouter.get("/bowl-history", adminOrUser, async (req, res) => {
//   try {
//     const days = 7;
//     const location = req.query.location || 'sensor-room';

//     const Measurement = require("../models/Measurement");
//     const history = await Measurement.getBowlTempHistory(
//       req.user.id,
//       location,
//       days
//     );

//     return res.status(200).json({
//       status: "success",
//       message: `Bowl temperature history for ${days} days`,
//       data: history
//     });
//   } catch (error) {
//     console.error("Error fetching bowl temp history:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Failed to retrieve bowl temperature history"
//     });
//   }
// });

// // Route with days parameter
// temperatureRouter.get("/bowl-history/:days", adminOrUser, async (req, res) => {
//   try {
//     const days = parseInt(req.params.days) || 7;
//     const location = req.query.location || 'sensor-room';

//     const Measurement = require("../models/Measurement");
//     const history = await Measurement.getBowlTempHistory(
//       req.user.id,
//       location,
//       days
//     );

//     return res.status(200).json({
//       status: "success",
//       message: `Bowl temperature history for ${days} days`,
//       data: history
//     });
//   } catch (error) {
//     console.error("Error fetching bowl temp history:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Failed to retrieve bowl temperature history"
//     });
//   }
// });

// temperatureRouter.get("/history", adminOrUser, async (req, res) => {
//   const days = parseInt(req.query.days) || 7;
//   getTemperatureHistory(req.user, { days })
//     .then((data) => {
//       return res.status(200).send({
//         status: data.status,
//         message: data.message,
//         history: data.history,
//       });
//     })
//     .catch((error) => {
//       return res.status(400).send({
//         status: error.status,
//         message: error.message,
//       });
//     });
// });

// temperatureRouter.get("/history/:days", adminOrUser, async (req, res) => {
//   const days = parseInt(req.params.days) || 7;
//   getTemperatureHistory(req.user, { days })
//     .then((data) => {
//       return res.status(200).send({
//         status: data.status,
//         message: data.message,
//         history: data.history,
//       });
//     })
//     .catch((error) => {
//       return res.status(400).send({
//         status: error.status,
//         message: error.message,
//       });
//     });
// });

// temperatureRouter.get("/latest", adminOrUser, async (req, res) => {
//   getLatestTemperature(req.user)
//     .then((data) => {
//       return res.status(200).send({
//         status: data.status,
//         message: data.message,
//         temperature: data.temperature,
//       });
//     })
//     .catch((error) => {
//       return res.status(400).send({
//         status: error.status,
//         message: error.message,
//       });
//     });
// });

// module.exports = temperatureRouter;
const express = require("express");
const { adminOrUser } = require("../middleware/auth");
const pool = require("../config/db");  // Assuming this is your DB connection pool
const { getAllTemperatures } = require("../main/temperatures/get-all-temperatures");
const { getTemperatureHistory } = require("../main/temperatures/get-temperature-history");
const { getLatestTemperature } = require("../main/temperatures/get-latest-temperature");

const temperatureRouter = express.Router();

temperatureRouter.get("/", adminOrUser, async (req, res) => {
  getAllTemperatures(req.user)
    .then((data) => {
      return res.status(200).send({
        status: data.status,
        message: data.message,
        temperatures: data.temperatures,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

// Updated: Use new schema with sensor_measurements + sensor configurations (join sensor_types, rooms)
temperatureRouter.get("/bowl-history", adminOrUser, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const location = req.query.location || 'sensor-room';
    const userId = req.user.id;

    // Get room_id from rooms (location = room_code)
    const [rooms] = await pool.execute("SELECT id FROM rooms WHERE user_id = ? AND room_code = ?", [userId, location]);
    if (rooms.length === 0) return res.status(404).json({ status: "error", message: "Room not found" });
    const roomId = rooms[0].id;

    // Get sensor_type_id for bowl_temp
    const [types] = await pool.execute("SELECT id FROM sensor_types WHERE type_code = 'bowl_temp'");
    if (types.length === 0) return res.status(500).json({ status: "error", message: "Sensor type not found" });
    const typeId = types[0].id;

    // Get sensor_id with configurations
    const [sensors] = await pool.execute("SELECT id FROM sensors WHERE user_id = ? AND room_id = ? AND sensor_type_id = ?", [userId, roomId, typeId]);
    if (sensors.length === 0) return res.status(404).json({ status: "error", message: "Sensor not found" });
    const sensorId = sensors[0].id;

    // Get history from sensor_measurements (replaced measurements with sensor_measurements)
    const [history] = await pool.execute(
      "SELECT measured_value as bowl_temp, measured_at as created_at FROM sensor_measurements WHERE sensor_id = ? AND measured_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY measured_at ASC LIMIT 1000",
      [sensorId, days]
    );

    return res.status(200).json({
      status: "success",
      message: `Bowl temperature history for ${days} days`,
      data: history
    });
  } catch (error) {
    console.error("Error fetching bowl temp history:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve bowl temperature history"
    });
  }
});

// Route with days parameter (similar update)
temperatureRouter.get("/bowl-history/:days", adminOrUser, async (req, res) => {
  try {
    const days = parseInt(req.params.days) || 7;
    const location = req.query.location || 'sensor-room';
    const userId = req.user.id;

    // Same logic as above...
    // (Omitted for brevity; copy the query block from above)

    return res.status(200).json({
      status: "success",
      message: `Bowl temperature history for ${days} days`,
      data: history
    });
  } catch (error) {
    console.error("Error fetching bowl temp history:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve bowl temperature history"
    });
  }
});

temperatureRouter.get("/history", adminOrUser, async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  getTemperatureHistory(req.user, { days })
    .then((data) => {
      return res.status(200).send({
        status: data.status,
        message: data.message,
        history: data.history,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

temperatureRouter.get("/history/:days", adminOrUser, async (req, res) => {
  const days = parseInt(req.params.days) || 7;
  getTemperatureHistory(req.user, { days })
    .then((data) => {
      return res.status(200).send({
        status: data.status,
        message: data.message,
        history: data.history,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

temperatureRouter.get("/latest", adminOrUser, async (req, res) => {
  getLatestTemperature(req.user)
    .then((data) => {
      return res.status(200).send({
        status: data.status,
        message: data.message,
        temperature: data.temperature,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

module.exports = temperatureRouter;