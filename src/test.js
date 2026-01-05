const mqtt = require("mqtt");
const io = require("socket.io"); // Add Socket.IO server

const BROKER = "mqtt://bdtmp.ultra-x.jp:1883";
const USERNAME = "admin";
const PASSWORD = "StrongPassword123";
const SEN1_TOPIC = "CO2";

const options = {
    clientId: "js_subscriber_001",
    username: USERNAME,
    password: PASSWORD,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 1000,
};

// Initialize Socket.IO server (adjust port as needed)
const socketServer = io(3001, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// MQTT Client
const client = mqtt.connect(BROKER, options);

// Store latest CO2 data
let latestCO2Data = {
    value: null,
    timestamp: null,
    status: 'disconnected'
};

client.on("connect", () => {
    console.log("[subscriber] Connected to broker");
    latestCO2Data.status = 'connected';

    client.subscribe(SEN1_TOPIC, { qos: 1 }, (err) => {
        if (err) {
            console.error("[subscriber] Subscribe error:", err);
            latestCO2Data.status = 'error';
        } else {
            console.log(`[subscriber] Subscribed to topic: ${SEN1_TOPIC}`);
            latestCO2Data.status = 'subscribed';
        }
    });
});

client.on("message", (topic, payload) => {
    const timestamp = new Date().toISOString();
    const value = payload.toString();

    console.log(`[subscriber] RECV ${topic} | payload=${value} | time=${timestamp}`);

    // Update latest data
    latestCO2Data = {
        value: parseFloat(value),
        timestamp: timestamp,
        status: 'active',
        topic: topic
    };

    // Emit to all connected Socket.IO clients
    socketServer.emit('co2Data', latestCO2Data);
});

client.on("error", (err) => {
    console.error("[subscriber] Error:", err);
    latestCO2Data.status = 'error';
    socketServer.emit('co2Data', latestCO2Data);
});

client.on("close", () => {
    console.log("[subscriber] Connection closed");
    latestCO2Data.status = 'disconnected';
    socketServer.emit('co2Data', latestCO2Data);
});

// Send latest data to new Socket.IO connections
socketServer.on('connection', (socket) => {
    console.log('[Socket.IO] Client connected:', socket.id);

    // Send current CO2 data immediately
    socket.emit('co2Data', latestCO2Data);

    socket.on('disconnect', () => {
        console.log('[Socket.IO] Client disconnected:', socket.id);
    });
});

// Graceful exit
process.on("SIGINT", () => {
    console.log("\n[main] stopping...");
    client.end(true, () => {
        socketServer.close();
        process.exit(0);
    });
});
