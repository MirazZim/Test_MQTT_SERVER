# Frontend Real-Time CO₂ Update Issue - Fix Prompt

## Problem Description

My backend is receiving CO₂ sensor data every second and processing it correctly (confirmed by backend logs), but my frontend is NOT updating in real-time. The CO₂ value on the dashboard only updates occasionally (every 5-10 seconds or more), not every second like it should.

## Backend Status ✅

The backend is working correctly:
- CO₂ data is received every second from MQTT broker
- Data is processed in < 50ms
- Data is saved to database successfully
- Socket.IO events are being emitted every second

Backend logs show:
```
💨 [CO2] 2026-01-05T03:36:45.000Z | Topic: "CO2" | Payload: "1.46"
✅ [CO2] Valid CO2 reading: 1.46 ppm
   📡 [CO2] Emitting to rooms:
      • sensorRoomName: "sensor_X"
      • userRoom: "user_Y_sensor-room"
      • locationRoom: "location_sensor-room"
      • Value: 1.46 ppm
   ✅ [CO2] All Socket.IO events emitted
💨 [CO2] ✅ Processed in 35ms
```

## Socket.IO Events Being Emitted

The backend emits these events every second:

1. **Event: `sensorData`** (to room: `sensor_{sensorId}`)
   ```javascript
   {
     sensorId: number,
     value: number,
     timestamp: string,
     quality: 'good'
   }
   ```

2. **Event: `sensorUpdate`** (to room: `user_{userId}_{roomCode}`)
   ```javascript
   {
     sensorId: number,
     sensorType: 'co2_level',
     sensorName: string,
     value: number,
     unit: 'ppm',
     timestamp: string,
     roomCode: string,
     roomName: string,
     source: string
   }
   ```

3. **Event: `chartData`** (to room: `location_{roomCode}`)
   ```javascript
   {
     sensorId: number,
     sensorType: 'co2_level',
     value: number,
     timestamp: string,
     unit: 'ppm'
   }
   ```

4. **Event: `environmentUpdate`** (to room: `user_{userId}_{roomCode}`)
   ```javascript
   {
     co2_level: number,
     timestamp: string
   }
   ```

## What I Need You to Fix

Please analyze my frontend code and fix the following issues:

### 1. Socket.IO Connection
- Verify the frontend is connecting to the Socket.IO server correctly
- Check if the connection is stable and not disconnecting/reconnecting

### 2. Room Subscription
The frontend needs to join the correct Socket.IO rooms. Based on the backend logs, check:
- Is the frontend joining the room `user_{userId}_{roomCode}`?
- Is the frontend joining the room `location_{roomCode}`?
- Is the frontend joining the room `sensor_{sensorId}`?

### 3. Event Listeners
Check if the frontend is listening for these events:
- `sensorUpdate` - Main event for sensor data updates
- `environmentUpdate` - Event for environment data updates
- `chartData` - Event for chart updates
- `sensorData` - Event for raw sensor data

### 4. State Updates
- Verify that when events are received, the frontend state is being updated
- Check if there's any throttling, debouncing, or rate limiting preventing updates
- Ensure the UI re-renders when state changes

### 5. Common Issues to Check

**Issue A: Not joining rooms**
```javascript
// BAD - Not joining any room
socket.on('connect', () => {
  console.log('Connected');
});

// GOOD - Joining the correct room
socket.on('connect', () => {
  socket.emit('joinRoom', `user_${userId}_${roomCode}`);
  socket.emit('joinRoom', `location_${roomCode}`);
});
```

**Issue B: Not listening for events**
```javascript
// BAD - No event listeners
// ...

// GOOD - Listening for events
socket.on('sensorUpdate', (data) => {
  if (data.sensorType === 'co2_level') {
    setCO2Value(data.value);
  }
});

socket.on('environmentUpdate', (data) => {
  if (data.co2_level !== undefined) {
    setCO2Value(data.co2_level);
  }
});
```

**Issue C: Throttling/Debouncing**
```javascript
// BAD - Throttling updates (causes delays)
const debouncedUpdate = debounce((value) => {
  setCO2Value(value);
}, 5000); // 5 second delay!

// GOOD - Immediate updates
socket.on('sensorUpdate', (data) => {
  setCO2Value(data.value); // Update immediately
});
```

**Issue D: Stale closure / not updating state**
```javascript
// BAD - Event listener set up once, doesn't update state
useEffect(() => {
  socket.on('sensorUpdate', (data) => {
    // This might not update if dependencies are wrong
  });
}, []); // Empty dependency array might cause issues

// GOOD - Proper state updates
useEffect(() => {
  const handleSensorUpdate = (data) => {
    if (data.sensorType === 'co2_level') {
      setCO2Value(data.value);
      setLastUpdate(data.timestamp);
    }
  };

  socket.on('sensorUpdate', handleSensorUpdate);

  return () => {
    socket.off('sensorUpdate', handleSensorUpdate);
  };
}, [socket]); // Proper dependencies
```

**Issue E: Wrong room names**
```javascript
// BAD - Hardcoded or wrong room name
socket.emit('joinRoom', 'sensor-room'); // Too generic

// GOOD - Correct room name format
socket.emit('joinRoom', `user_${userId}_${roomCode}`);
socket.emit('joinRoom', `location_${roomCode}`);
```

### 6. Debug Steps

Add console logs to verify:

```javascript
// 1. Connection status
socket.on('connect', () => {
  console.log('✅ Socket.IO connected:', socket.id);
});

socket.on('disconnect', () => {
  console.log('❌ Socket.IO disconnected');
});

// 2. Room joining
socket.emit('joinRoom', roomName);
console.log('📍 Joined room:', roomName);

// 3. Event reception
socket.on('sensorUpdate', (data) => {
  console.log('📨 Received sensorUpdate:', data);
  // Update state here
});

socket.on('environmentUpdate', (data) => {
  console.log('📨 Received environmentUpdate:', data);
  // Update state here
});

// 4. State updates
useEffect(() => {
  console.log('🔄 CO2 value updated:', co2Value);
}, [co2Value]);
```

## Expected Behavior After Fix

After fixing the frontend:
1. CO₂ value should update every second (or at sensor frequency)
2. The "Last updated" timestamp should show updates every second
3. Console should show `📨 Received sensorUpdate:` logs every second
4. No delays or gaps in updates

## Current Behavior (Wrong)

- CO₂ value updates every 5-10 seconds or more
- "Last updated" timestamp shows old times
- Frontend appears to be missing most updates

## Additional Context

- Backend server URL: (provide your backend URL)
- Socket.IO version: (check your package.json)
- Frontend framework: (React/Vue/Angular/etc.)
- User ID: (from your authentication)
- Room code: (from backend logs, e.g., "sensor-room")

## What to Provide in Your Fix

1. **Identify the issue** - What's preventing real-time updates?
2. **Show the problematic code** - The current implementation
3. **Provide the fix** - Corrected code with explanations
4. **Add debugging** - Console logs to verify it's working
5. **Test instructions** - How to verify the fix works

## Success Criteria

✅ CO₂ value updates every second
✅ Console shows event reception every second
✅ No throttling or debouncing delays
✅ Correct room subscriptions
✅ Proper event listeners
✅ State updates trigger UI re-renders

---

**Please analyze my frontend code and provide a complete fix for real-time CO₂ updates.**
