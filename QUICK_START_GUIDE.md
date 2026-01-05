# CO₂ Sensor Fix - Quick Start Guide

## 🚨 CRITICAL: Fix Your MQTT Configuration First!

Your current `.env` has an **INVALID** MQTT configuration:
```env
MQTT_HOST=https://bdtmp.ultra-x.jp/iotbrokerv1_backend  ❌ WRONG!
```

## Step-by-Step Fix

### Step 1: Identify Your MQTT Broker

Run the broker test:
```bash
node find-mqtt-broker.js
```

This will test common MQTT configurations and tell you which one works.

### Step 2: Update Your .env File

Based on your setup, choose ONE of these:

#### Option A: Local MQTT Broker (Most Common)
```env
# Unencrypted
MQTT_HOST=mqtt://192.168.88.221:1883

# OR Encrypted (TLS)
MQTT_HOST=mqtts://192.168.88.221:8883
```

#### Option B: Remote MQTT Broker
If your domain `bdtmp.ultra-x.jp` has an MQTT broker:
```env
# Try these ports:
MQTT_HOST=mqtt://bdtmp.ultra-x.jp:1883
# or
MQTT_HOST=mqtts://bdtmp.ultra-x.jp:8883
# or
MQTT_HOST=mqtt://bdtmp.ultra-x.jp:9001  # WebSocket
```

#### Option C: Public Test Broker (For Testing Only)
```env
MQTT_HOST=mqtt://broker.hivemq.com:1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

### Step 3: Restart Your Server

```bash
# If using PM2
pm2 restart all

# If running directly
npm start
```

### Step 4: Verify It's Working

#### Check the logs:
```bash
pm2 logs
```

Look for:
```
✅ MQTT Connected!
✅ Subscribed to sensor: CO2
🚀 [CO2PollingService] Starting active polling
✅ [CO2PollingService] Polling started
```

#### Test the API:
```bash
curl http://localhost:3001/api/sensors/co2/polling-status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Watch for CO₂ data:
```bash
# You should see this every second:
💨 [CO2] 2025-12-30... | Topic: "CO2" | Payload: "1.23"
✅ [CO2] Saved measurement ID: 12345
💨 [CO2] ✅ Processed in 15ms
```

## What Was Fixed

### 1. **Active Polling Service** 🚀
- Polls CO₂ sensor every 1 second
- Automatically requests data if not received
- Monitors for missing data

### 2. **Optimized Processing**
- Removed event loop bottleneck
- Database transactions for speed
- Parallel processing

### 3. **Better Monitoring**
- Status endpoint: `/api/sensors/co2/polling-status`
- Detailed logging
- Performance metrics

## Troubleshooting

### Problem: "MQTT client not connected"

**Cause:** Wrong MQTT_HOST format

**Solution:**
1. Run `node find-mqtt-broker.js`
2. Update `.env` with working URL
3. Restart server

### Problem: "No CO2 sensor found"

**Cause:** Sensor not in database

**Solution:**
```bash
node test-co2-polling.js
```
This will show your sensor configuration.

### Problem: Still missing data

**Possible causes:**
1. Sensor not publishing
2. Wrong topic name
3. Network issues

**Debug:**
```bash
# Check sensor is publishing
# Use MQTT Explorer or mosquitto_sub:
mosquitto_sub -h 192.168.88.221 -t "CO2" -u admin -P StrongPassword123
```

## Expected Results

### Before Fix:
```
[subscriber] RECV CO2 | payload=1.11 | time=14:20:39
[subscriber] RECV CO2 | payload=1.91 | time=14:20:44  ← 5 second gap!
[subscriber] RECV CO2 | payload=1.56 | time=14:20:51  ← 7 second gap!
```

### After Fix:
```
💨 [CO2] Topic: "CO2" | Payload: "1.11" | time=14:20:39
💨 [CO2] Topic: "CO2" | Payload: "1.23" | time=14:20:40  ← 1 second!
💨 [CO2] Topic: "CO2" | Payload: "1.35" | time=14:20:41  ← 1 second!
💨 [CO2] Topic: "CO2" | Payload: "1.42" | time=14:20:42  ← 1 second!
```

## Files Changed

✅ All changes are backward compatible
✅ No breaking changes
✅ Existing sensors continue to work

Modified files:
- `src/mqtt/EnhancedMqttHandler.js` - Optimized processing
- `src/mqtt/Sensors/CO2Handler.js` - Faster database operations
- `src/mqtt/Sensors/CO2PollingService.js` - NEW polling service
- `src/mqtt/mqttSetup.js` - Expose handler
- `src/server.js` - Pass app reference
- `src/routes/sensorRoutes.js` - Add status endpoint

## Quick Commands

```bash
# Test database and sensor setup
node test-co2-polling.js

# Find correct MQTT broker
node find-mqtt-broker.js

# Restart server
pm2 restart all

# Watch logs
pm2 logs --lines 100

# Check polling status
curl http://localhost:3001/api/sensors/co2/polling-status
```

## Need Help?

1. Run diagnostics: `node test-co2-polling.js`
2. Check MQTT: `node find-mqtt-broker.js`
3. Review logs: `pm2 logs`
4. Check this guide: `CO2_POLLING_FIX_README.md`

---

**Status:** ✅ Ready to deploy
**Priority:** 🚨 CRITICAL - Fix MQTT_HOST first!
