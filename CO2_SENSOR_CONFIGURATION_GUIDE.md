# CO2 Sensor Configuration Guide

## Problem Identified ⚠️

Your CO2 sensor is **echoing back commands** instead of sending actual CO2 readings.

### What's Happening:
```
Backend sends: "GET"
Sensor responds: "GET"  ← Should be a number like "1.23"
Backend rejects: ❌ Invalid value: GET
```

### What Should Happen:
```
Sensor automatically publishes: "1.23"
Backend receives: "1.23"
Backend saves: ✅ 1.23 ppm
```

## Solution: Configure Your CO2 Sensor

### Step 1: Run Diagnostic Tool

First, let's confirm the issue:

```bash
node diagnose-co2-sensor.js
```

This will listen to your CO2 sensor for 60 seconds and show you:
- ✅ Valid numeric readings
- ❌ Invalid responses (like "GET")
- 📊 Statistics and recommendations

### Step 2: Fix Your Sensor Configuration

Your CO2 sensor needs to be configured to **auto-publish data** instead of waiting for commands.

#### Common Sensor Types and Fixes:

#### A. ESP32/ESP8266 with MQ-135 or Similar
If you're using Arduino/ESP code, modify your sensor code:

**❌ WRONG (Command-Response Mode):**
```cpp
void loop() {
  if (mqtt.available()) {
    String command = mqtt.readString();
    if (command == "GET") {
      mqtt.publish("CO2", command);  // Echoing back!
    }
  }
}
```

**✅ CORRECT (Auto-Publish Mode):**
```cpp
void loop() {
  // Read CO2 sensor
  float co2Value = readCO2Sensor();
  
  // Publish every 1 second
  if (millis() - lastPublish > 1000) {
    String payload = String(co2Value, 2);  // "1.23"
    mqtt.publish("CO2", payload.c_str());
    lastPublish = millis();
  }
  
  delay(100);
}
```

#### B. Commercial CO2 Sensor with Configuration
If using a commercial sensor (like Sensirion SCD30, MH-Z19, etc.):

1. **Check sensor documentation** for auto-publish settings
2. **Look for these settings:**
   - Auto-publish: ENABLED
   - Publish interval: 1000ms (1 second)
   - Echo mode: DISABLED
   - Command response: DISABLED

3. **Common configuration methods:**
   - Web interface (if sensor has WiFi)
   - Serial commands (via USB/UART)
   - Configuration file (config.json, settings.ini)
   - DIP switches or jumpers

#### C. Node-RED or Similar Flow
If using Node-RED:

**❌ WRONG:**
```
[MQTT In] → [Function: echo] → [MQTT Out]
```

**✅ CORRECT:**
```
[Inject: every 1s] → [CO2 Sensor] → [MQTT Out: "CO2"]
```

### Step 3: Verify Fix

After reconfiguring your sensor:

1. **Run diagnostic again:**
   ```bash
   node diagnose-co2-sensor.js
   ```

2. **Look for:**
   ```
   ✅ VALID: Numeric value = 1.23 ppm
   ✅ VALID: Numeric value = 1.45 ppm
   ✅ VALID: Numeric value = 1.67 ppm
   ```

3. **Restart your backend:**
   ```bash
   pm2 restart all
   ```

4. **Check logs:**
   ```bash
   pm2 logs | grep CO2
   ```

   Should see:
   ```
   ✅ [CO2] Valid CO2 reading: 1.23 ppm
   ✅ [CO2] Saved measurement ID: 12345
   ```

## Alternative: Disable Polling Requests

If you can't reconfigure your sensor right now, you can disable the polling requests (already done in the latest code):

The system will now:
- ✅ Accept valid numeric CO2 readings
- ⚠️ Warn about command echoes but not spam logs
- ❌ Not send "GET" requests that cause echoes

## Troubleshooting

### Issue: Still seeing "GET" responses

**Cause:** Sensor is still in command-response mode

**Solution:**
1. Check sensor code/configuration
2. Look for "echo" or "command mode" settings
3. Ensure sensor is in "auto-publish" or "periodic send" mode

### Issue: No data at all

**Cause:** Sensor not publishing

**Solution:**
1. Check sensor is powered on
2. Verify MQTT broker connection
3. Check topic name matches: "CO2"
4. Use MQTT Explorer to see all topics

### Issue: Data comes in bursts

**Cause:** Sensor buffering or network issues

**Solution:**
1. Check sensor publish interval (should be 1000ms)
2. Verify network stability
3. Check MQTT QoS settings (should be 1)

## Expected Behavior After Fix

### Before Fix:
```
📡 [CO2PollingService] Requesting data from: CO2
📦 Payload: "GET"
❌ [CO2] Invalid value: GET
⚠️ No recent data for CO2 Level (last: 45s ago)
```

### After Fix:
```
📦 Payload: "1.23"
✅ [CO2] Valid CO2 reading: 1.23 ppm
✅ [CO2] Saved measurement ID: 12345
💨 [CO2] ✅ Processed in 15ms
```

## Sensor Configuration Checklist

- [ ] Sensor publishes numeric values (not commands)
- [ ] Publish interval is 1 second (1000ms)
- [ ] Topic is "CO2"
- [ ] QoS is 1
- [ ] Echo mode is disabled
- [ ] Auto-publish is enabled
- [ ] Sensor is connected to correct MQTT broker
- [ ] MQTT credentials are correct

## Common Sensor Models

### MH-Z19 CO2 Sensor
```cpp
// Example Arduino code
#include <MHZ19.h>
MHZ19 myMHZ19;

void loop() {
  int co2 = myMHZ19.getCO2();
  String payload = String(co2);
  mqtt.publish("CO2", payload.c_str());
  delay(1000);
}
```

### Sensirion SCD30
```cpp
// Example Arduino code
#include <SparkFun_SCD30_Arduino_Library.h>
SCD30 airSensor;

void loop() {
  if (airSensor.dataAvailable()) {
    float co2 = airSensor.getCO2();
    String payload = String(co2, 2);
    mqtt.publish("CO2", payload.c_str());
  }
  delay(1000);
}
```

### Generic Analog CO2 Sensor (MQ-135)
```cpp
void loop() {
  int sensorValue = analogRead(A0);
  float co2 = map(sensorValue, 0, 1023, 400, 5000);  // Calibrate!
  String payload = String(co2, 2);
  mqtt.publish("CO2", payload.c_str());
  delay(1000);
}
```

## Need Help?

1. **Run diagnostic:** `node diagnose-co2-sensor.js`
2. **Check sensor documentation** for auto-publish settings
3. **Share diagnostic output** if you need help
4. **Check sensor code** if using custom firmware

## Files Modified

The backend has been updated to:
- ✅ Ignore command echoes gracefully
- ✅ Only process valid numeric CO2 readings
- ✅ Provide helpful warnings about sensor configuration
- ✅ Stop sending requests that cause echoes

---

**Status:** ⚠️ Sensor configuration needed
**Priority:** 🔴 HIGH - Fix sensor to send numeric values
**Next Step:** Run `node diagnose-co2-sensor.js` to verify sensor behavior
