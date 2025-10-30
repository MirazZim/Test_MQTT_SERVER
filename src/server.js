
const express = require("express");
const http = require("http");

require("dotenv").config();

const { setupMiddleware } = require("./config/middleware");
const { setupRoutes } = require("./routes");
const { createSocketIOServer } = require("./utils/socketio/socketioHandler");
const { createWebSocketServer } = require("./utils/websocket/websocketServer");
const { initializeMQTT } = require("./mqtt/mqttSetup");
const { messageEmitter, storeMessage } = require("./utils/messageHandler");

const app = express();
const server = http.createServer(app);

server.keepAliveTimeout = 65000; // 65 seconds (higher than typical load balancer 60s)
server.headersTimeout = 66000; // Must be higher than keepAliveTimeout
server.maxHeadersCount = 100; // Prevent header-based attacks
server.requestTimeout = 30000; // 30s timeout for slow requests

// ✅ NEW: Set maximum concurrent connections
server.maxConnections = 10000; // Increase from default (typically 511)


setupMiddleware(app);
setupRoutes(app);

// Initialize Socket.IO first
const io = createSocketIOServer(server);

// Initialize WebSocket server with path routing (fixed version)
const wss = createWebSocketServer(server, messageEmitter);

// Initialize MQTT and get the instance
const { mqttClient, spatialController } = initializeMQTT(io);

// ✅ CRITICAL FIX: Inject MQTT instance into Socket.IO
io.setMqtt(mqttClient);

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🔌 Socket.IO server ready`);
  console.log(`📊 MQTT client initialized`);
});

module.exports = {
  app, server, io, wss, mqttClient, spatialController, messageEmitter, storeMessage
};

