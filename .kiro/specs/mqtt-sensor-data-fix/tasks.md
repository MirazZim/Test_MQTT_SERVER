# Implementation Plan: MQTT Sensor Data Fix

## Overview

This plan implements dynamic topic pattern matching and auto-registration for MQTT sensor data, ensuring CO₂ and sonar sensor readings are properly saved to the database.

## Tasks

- [x] 1. Create TopicPatternMatcher utility class
  - [x] 1.1 Create `src/mqtt/utils/TopicPatternMatcher.js` with default patterns for CO2, level, sonar, temperature, humidity, sugar
    - Implement case-insensitive regex matching
    - Include specificity scoring for pattern priority
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ]* 1.2 Write property test for case-insensitive matching
    - **Property 4: Case-Insensitive Topic Matching**
    - **Validates: Requirements 4.2**
  - [ ]* 1.3 Write property test for pattern specificity
    - **Property 5: Pattern Specificity Ordering**
    - **Validates: Requirements 4.3**

- [x] 2. Enhance RealTimeSensorService with pattern matching fallback
  - [x] 2.1 Add TopicPatternMatcher integration to `src/mqtt/Sensors/RealTimeSensorService.js`
    - Import and instantiate TopicPatternMatcher
    - Add fallback logic when sensor not found in cache/DB
    - _Requirements: 1.2, 4.1_
  - [x] 2.2 Implement auto-registration method for unregistered sensors
    - Create sensor record with default user/room
    - Update sensor cache after registration
    - _Requirements: 1.3, 1.4_
  - [ ]* 2.3 Write property test for auto-registration idempotence
    - **Property 6: Auto-Registration Idempotence**
    - **Validates: Requirements 1.3**

- [ ] 3. Implement database retry logic
  - [ ] 3.1 Create retry utility function with exponential backoff
    - Add to `src/mqtt/utils/RetryUtils.js`
    - Support configurable max retries and base delay
    - _Requirements: 5.1, 5.2_
  - [ ] 3.2 Integrate retry logic into RealTimeSensorService database operations
    - Wrap saveToDatabase with retry logic
    - Wrap sensor lookup with retry logic
    - _Requirements: 5.1, 5.3_
  - [ ]* 3.3 Write property test for retry behavior
    - **Property 8: Database Retry Behavior**
    - **Validates: Requirements 5.1**

- [ ] 4. Improve logging throughout data flow
  - [ ] 4.1 Add comprehensive logging to handleSensorData method
    - Log topic, payload, timestamp on message receipt
    - Log cache/DB lookup results
    - Log pattern matching attempts and results
    - _Requirements: 6.1, 6.2_
  - [ ] 4.2 Add logging to measurement save operations
    - Log sensor_id, value, measurement_id on success
    - Log detailed error info on failure
    - _Requirements: 6.3, 6.4_

- [ ] 5. Checkpoint - Verify core functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement payload validation and error handling
  - [ ] 6.1 Enhance numeric payload parsing with detailed error messages
    - Handle empty strings, text, special characters
    - Log warning with payload details for invalid values
    - _Requirements: 2.1, 2.3, 3.1, 3.3_
  - [ ]* 6.2 Write property test for numeric parsing
    - **Property 1: Numeric Payload Parsing**
    - **Validates: Requirements 2.1, 3.1**
  - [ ]* 6.3 Write property test for invalid payload rejection
    - **Property 3: Invalid Payload Rejection**
    - **Validates: Requirements 2.3, 3.3**

- [ ] 7. Verify Socket.IO event emission
  - [ ] 7.1 Ensure sensorUpdate events are emitted for all saved measurements
    - Verify event payload includes sensor_id, value, timestamp
    - _Requirements: 2.4, 3.4_
  - [ ]* 7.2 Write property test for Socket.IO emission
    - **Property 7: Socket.IO Event Emission**
    - **Validates: Requirements 2.4, 3.4**

- [ ] 8. Integration testing and verification
  - [ ] 8.1 Create integration test for CO2 topic handling
    - Test "CO2" topic saves to database
    - Test case variations (co2, Co2, CO2)
    - _Requirements: 2.1, 2.2_
  - [ ] 8.2 Create integration test for level/sonar topic handling
    - Test "level" topic saves to database
    - Test "sonar" and "distance" variations
    - _Requirements: 3.1, 3.2_
  - [ ]* 8.3 Write property test for measurement persistence round-trip
    - **Property 2: Measurement Persistence Round-Trip**
    - **Validates: Requirements 2.2, 3.2**

- [ ] 9. Final checkpoint - Full system verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify CO2 and sonar data is being saved when running test scripts

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
