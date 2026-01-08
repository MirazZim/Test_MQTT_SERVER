const mqtt = require('mqtt');

// ---------- MQTT CONFIG ----------
const BROKER = 'mqtt://bdtmp.ultra-x.jp';
const PORT = 1883;

const USERNAME = 'admin';
const PASSWORD = 'StrongPassword123';

const SEN1_TOPIC = 'level';
const { format } = require('date-fns');

// ---------- MQTT OPTIONS ----------
const options = {
  port: PORT,
  clientId: `sonar_test_${Date.now()}`,
  username: USERNAME,
  password: PASSWORD,
  clean: true,
  keepalive: 60,
};

// ---------- CONNECT ----------
const client = mqtt.connect(BROKER, options);

client.on('connect', () => {
  console.log('[subscriber] Connected to broker ✅');

  client.subscribe(SEN1_TOPIC, { qos: 1 }, (err) => {
    if (err) {
      console.error('[subscriber] Subscribe error:', err);
    } else {
      console.log(`[subscriber] Subscribed to topic: ${SEN1_TOPIC}`);
    }
  });
});

// ---------- MESSAGE ----------
client.on('message', (topic, message) => {
  console.log(
    `[subscriber] RECV ${topic} | payload=${message.toString()} | time=${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`
  );
});

// ---------- ERROR ----------
client.on('error', (err) => {
  console.error('[subscriber] MQTT Error:', err);
});

// ---------- CLOSE ----------
client.on('close', () => {
  console.log('[subscriber] Connection closed');
});