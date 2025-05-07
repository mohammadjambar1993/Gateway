const { makeUUID } = require('../misc')

const id = 'udw_ads';

const chars = {
  SERVICEDATA: 'SERVICEDATA', // not a char per sa but rather a reference to use in parsing and byte decoding
  INVALID_VALUE: -32768,
  ECGPacketInterval: 40,
  ECGSampleCount: 8,
  ACCSampleCount: 3,
  ACCELEROMETER_SAVE: '26659',
  ECG_ONE_SAVE: '26656',
  ECG_TWO_SAVE: '26657',
  ECG_THREE_SAVE: '26658',
  INFORMATION: makeUUID('6801'),
  COMMAND: makeUUID('6802'),
  LOG: makeUUID('6804'),
  HEART_RATE_ONE: makeUUID('6840'),
  HEART_RATE_TWO: makeUUID('6841'),
  ECG_ONE: makeUUID('6820'),
  ECG_TWO: makeUUID('6821'),
  ECG_THREE: makeUUID('6822'),
  STEPS: makeUUID('6842'),
  ACTIVITY_TYPE: makeUUID('6843'),
  ACCELEROMETER: makeUUID('6830'),
  OP_CODES: {
    HEART_RATE_THRESHOLD: [0x07, 0x00],
    STEP_THRESHOLD: [0x08, 0x00],
    RESET_STEPS: [0x09, 0x00],
    SET_REALTIME_CLOCK: [0x02, 0x00],
  },
  GARMENT_ENABLED: false,
  GARMENT_OPTIONS: [{
    code: 0xFF,
    name: 'Default'
  },{
    code: 0x00,
    name: 'Underwear'
  },{
    code: 0x01,
    name: 'Bra/Tank'
  },{
    code: 0x02,
    name: 'Chest Band'
  },{
    code: 0x03,
    name: 'Bralette'
  }],
};

const dataFormat = {
  [chars.SERVICEDATA]: {
    meta: {
      name: 'serviceData',
      storageType: 'cache', //an assumption, not verified/doesnt matter
    },
    parser: {
      // 0: ['uint8', 'garmentID', 1],
      // 1: ['uint8', 'statusByte', 1],
      0: ['long', 'serialNumber', 6],
    },
  },
  [chars.INFORMATION]: {
    meta: {
      name: 'moduleInformation',
      storageType: 'cache',
    },
    parser: {
      0: ['uint8', 'firmwareMajor', 1],
      1: ['uint8', 'firmwareMinor', 1],
      2: ['uint16', 'firmwarePatch', 2],
      3: ['uint16', 'hardwareVer', 2],
      4: ['uint8', 'operationMode', 1],
      5: ['uint8', 'ecgLeadState', 1],
      6: ['uint8', 'batteryLevel', 1],
      7: ['uint8', 'storedEcg', 1],
      8: ['uint8', 'movementFlag', 1],
      9: ['uint8', 'ecgQuality1', 1],
      10: ['uint8', 'ecgQuality2', 1],
      11: ['uint16', 'chargingCounter', 2],
      12: ['uint16', 'chargingTime', 2],
      13: ['uint16', 'temperature', 2],
      14: ['uint8', 'unused', 1],
    },
  },
  [chars.HEART_RATE_ONE]: {
    meta: {
      name: 'heartRateOne',
      storageType: 'realm',
    },
    parser: {
      0: ['uint8', 'sample0', 1],
      1: ['uint8', 'sample1', 1],
      2: ['uint8', 'sample2', 1],
      3: ['uint8', 'sample3', 1],
      4: ['uint8', 'sample4', 1],
      5: ['uint8', 'sample5', 1],
      6: ['uint8', 'sample6', 1],
      7: ['uint8', 'sample7', 1],
      8: ['uint8', 'sample8', 1],
      9: ['uint8', 'sample9', 1],
      10: ['uint8', 'sample10', 1],
      11: ['uint8', 'sample11', 1],
      12: ['uint8', 'sample12', 1],
      13: ['uint8', 'sample13', 1],
      14: ['uint8', 'sample14', 1],
      15: ['uint8', 'sample15', 1],
      16: ['uint8', 'sample16', 1],
      17: ['uint8', 'sample17', 1],
      18: ['uint8', 'sample18', 1],
      19: ['uint8', 'sample19', 1],
    },
  },
  [chars.HEART_RATE_TWO]: {
    meta: {
      name: 'heartRateTwo',
      storageType: 'realm',
    },
    parser: {
      0: ['uint8', 'sample0', 1],
      1: ['uint8', 'sample1', 1],
      2: ['uint8', 'sample2', 1],
      3: ['uint8', 'sample3', 1],
      4: ['uint8', 'sample4', 1],
      5: ['uint8', 'sample5', 1],
      6: ['uint8', 'sample6', 1],
      7: ['uint8', 'sample7', 1],
      8: ['uint8', 'sample8', 1],
      9: ['uint8', 'sample9', 1],
      10: ['uint8', 'sample10', 1],
      11: ['uint8', 'sample11', 1],
      12: ['uint8', 'sample12', 1],
      13: ['uint8', 'sample13', 1],
      14: ['uint8', 'sample14', 1],
      15: ['uint8', 'sample15', 1],
      16: ['uint8', 'sample16', 1],
      17: ['uint8', 'sample17', 1],
      18: ['uint8', 'sample18', 1],
      19: ['uint8', 'sample19', 1],
    },
  },
  [chars.ECG_ONE]: {
    meta: {
      name: 'ecgListOne',
      storageType: 'realm',
    },
    parser: {
      0: ['int16', 'sample0', 2],
      1: ['int16', 'sample1', 2],
      2: ['int16', 'sample2', 2],
      3: ['int16', 'sample3', 2],
      4: ['int16', 'sample4', 2],
      5: ['int16', 'sample5', 2],
      6: ['int16', 'sample6', 2],
      7: ['int16', 'sample7', 2],
      8: ['uint24', 'timestamp', 3],
      9: ['uint8', 'ecgState', 1], // bit 0 = ECG lead state, bits 1-7 = quality in %
    },
  },
  [chars.ECG_TWO]: {
    meta: {
      name: 'ecgListTwo',
      storageType: 'realm',
    },
    parser: {
      0: ['int16', 'sample0', 2],
      1: ['int16', 'sample1', 2],
      2: ['int16', 'sample2', 2],
      3: ['int16', 'sample3', 2],
      4: ['int16', 'sample4', 2],
      5: ['int16', 'sample5', 2],
      6: ['int16', 'sample6', 2],
      7: ['int16', 'sample7', 2],
      8: ['uint24', 'timestamp', 3],
      9: ['uint8', 'ecgState', 1], // bit 0 = ECG lead state, bits 1-7 = quality in %
    },
  },
  [chars.ECG_THREE]: {
    meta: {
      name: 'ecgListThree',
      storageType: 'realm',
    },
    parser: {
      0: ['int16', 'sample0', 2],
      1: ['int16', 'sample1', 2],
      2: ['int16', 'sample2', 2],
      3: ['int16', 'sample3', 2],
      4: ['int16', 'sample4', 2],
      5: ['int16', 'sample5', 2],
      6: ['int16', 'sample6', 2],
      7: ['int16', 'sample7', 2],
      8: ['uint24', 'timestamp', 3],
      9: ['uint8', 'ecgState', 1], // bit 0 = ECG lead state, bits 1-7 = quality in %
    },
  },
  [chars.STEPS]: {
    meta: {
      name: 'steps',
      storageType: 'realm',
    },
    parser: {
      0: ['uint32', 'stepCounter', 4],
      1: ['uint32', 'startTime', 4],
      2: ['uint32', 'endTime', 4],
    },
  },
  [chars.ACTIVITY_TYPE]: {
    meta: {
      name: 'activityType',
      storageType: 'realm',
    },
    parser: {
      0: ['uint8', 'activityType', 1],
      1: ['uint32', 'startTime', 4],
    },
  },
  [chars.ACCELEROMETER]: {
    meta: {
      name: 'accelerometer',
      storageType: 'realm',
    },
    parser: {
      0: ['int16', 'sample1X', 2],
      1: ['int16', 'sample1Y', 2],
      2: ['int16', 'sample1Z', 2],
      3: ['int16', 'sample2X', 2],
      4: ['int16', 'sample2Y', 2],
      5: ['int16', 'sample2Z', 2],
      6: ['int16', 'sample3X', 2],
      7: ['int16', 'sample3Y', 2],
      8: ['int16', 'sample3Z', 2],
      9: ['uint16', 'timestamp', 2],
    },
  },
};

module.exports = {
  id,
  chars,
  dataFormat,
};
