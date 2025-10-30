// const express = require("express");
// const router = express.Router();
// const authenticate = require("../middleware/auth");
// const {
//   createDevice,
//   assignDevice,
//   getDevices,
//   getDeviceData,
//   simulateMessage,
// } = require("../controllers/deviceController");

// router.post("/", authenticate.adminOnly, createDevice);
// router.post("/assign", authenticate.adminOnly, assignDevice);
// router.get("/", authenticate.adminOrUser, getDevices);
// router.get("/:id/data", authenticate.adminOrUser, getDeviceData);
// router.post("/simulate", authenticate.adminOnly, simulateMessage);

// module.exports = router;
const express = require("express");
const authenticate = require("../middleware/auth");
const { createDevice } = require("../main/devices/create-device");
const { assignDevice } = require("../main/devices/assign-device");
const { getDevices } = require("../main/devices/get-devices");
const { getDeviceData } = require("../main/devices/get-device-data");
const { simulateMessage } = require("../main/devices/simulate-message");

const deviceRouter = express.Router();

deviceRouter.post("/devices", authenticate.adminOnly, async (req, res) => {
  createDevice(req.body)
    .then((data) => {
      return res.status(201).send({
        status: data.status,
        message: data.message,
        device: data.device,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

deviceRouter.post("/devices/assign", authenticate.adminOnly, async (req, res) => {
  assignDevice(req.body)
    .then((data) => {
      return res.status(201).send({
        status: data.status,
        message: data.message,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

deviceRouter.get("/devices", authenticate.adminOrUser, async (req, res) => {
  getDevices(req.user)
    .then((data) => {
      return res.status(200).send({
        status: data.status,
        message: data.message,
        devices: data.devices,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

deviceRouter.get("/devices/:id/data", authenticate.adminOrUser, async (req, res) => {
  getDeviceData(req.user, { deviceId: req.params.id })
    .then((data) => {
      return res.status(200).send({
        status: data.status,
        message: data.message,
        data: data.data,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

deviceRouter.post("/devices/simulate", authenticate.adminOnly, async (req, res) => {
  simulateMessage(req.body)
    .then((data) => {
      return res.status(201).send({
        status: data.status,
        message: data.message,
      });
    })
    .catch((error) => {
      return res.status(400).send({
        status: error.status,
        message: error.message,
      });
    });
});

module.exports = deviceRouter;
