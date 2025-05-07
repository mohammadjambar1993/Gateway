const { makeUUID } = require('../misc')

const id = 'udw_FW430';

const chars = {
  SERVICEDATA: 'SERVICEDATA', // not a char per sa but rather a reference to use in parsing and byte decoding
  INVALID_VALUE: -1000,
  ECGPacketInterval: 75,
  ECGSampleCount: 24,
  ACCSampleCount: 12,
  ACCELEROMETER_SAVE: '26659',
  ECG_ONE_SAVE: '26656',
  ECG_TWO_SAVE: '26657',
  ECG_THREE_SAVE: '26658',
  TEMPERATURE_SAVE: '26690',
  INFORMATION: makeUUID('6801'),
  COMMAND: makeUUID('6802'),
  RESPONSE: makeUUID('6803'),
  LOG: makeUUID('6804'),
  ECG_ONE: makeUUID('6820'),
  ECG_TWO: makeUUID('6821'),
  ECG_THREE: makeUUID('6822'),
  STEPS: makeUUID('6840'),
  ACTIVITY_TYPE: makeUUID('6841'),
  TEMPERATURE: makeUUID('6842'),
  ACCELEROMETER: makeUUID('6830'),
  STORED_METRICS: makeUUID('6890'),
  OP_CODES: {
    STEP_THRESHOLD: [0x08, 0x00],
    RESET_STEPS: [0x09, 0x00],
    SET_REALTIME_CLOCK: [0x02, 0x00],
    READ_REALTIME_CLOCK: [0x03, 0x00],
    SET_SERIAL_NO: [0x01, 0x99],
    READ_STORED_DATA: [0x00, 0x90],
    SET_GARMENT_ID: [0x00, 0x50],
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
  [chars.RESPONSE]: {
    meta: {
      name: 'commandResponse',
      storageType: 'cache',
    },
    parser: {
      0: ['uint8', 'opcode', 2],
      1: ['uint8', 'status', 1],
      2: ['long', 'data', 17],
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
      4: ['uint8', 'garmentID', 1],
      5: ['uint8', 'ecgLeadState', 1],
      6: ['uint8', 'batteryLevel', 1],
      7: ['uint8', 'storedEcg', 1],
      8: ['uint8', 'movementFlag', 1],
      9: ['uint8', 'ecgQuality1', 1],
      10: ['uint8', 'ecgQuality2', 1],
      11: ['uint16', 'connectionInterval', 2],
      12: ['uint16', 'chargingTime', 2],
      13: ['uint16', 'temperature', 2],
      14: ['uint8', 'unused', 1],
    },
  },
  [chars.ECG_ONE]: {
    meta: {
      name: 'ecgListOne',
      storageType: 'realm',
    },
    parser: {
      0: ['uint24', 'sample0', 3],
      1: ['uint24', 'sample1', 3],
      2: ['uint24', 'sample2', 3],
      3: ['uint24', 'sample3', 3],
      4: ['uint24', 'sample4', 3],
      5: ['uint24', 'sample5', 3],
      6: ['uint24', 'sample6', 3],
      7: ['uint24', 'sample7', 3],
      8: ['uint24', 'sample8', 3],
      9: ['uint24', 'sample9', 3],
      10: ['uint24', 'sample10', 3],
      11: ['uint24', 'sample11', 3],
      12: ['uint24', 'sample12', 3],
      13: ['uint24', 'sample13', 3],
      14: ['uint24', 'sample14', 3],
      15: ['uint24', 'sample15', 3],
      16: ['uint24', 'sample16', 3],
      17: ['uint24', 'sample17', 3],
      18: ['uint24', 'sample18', 3],
      19: ['uint24', 'sample19', 3],
      20: ['uint24', 'sample20', 3],
      21: ['uint24', 'sample21', 3],
      22: ['uint24', 'sample22', 3],
      23: ['uint24', 'sample23', 3],
      24: ['uint24', 'timestamp', 3],
      25: ['uint8', 'ecgState', 1], // bit 0 = both N and P, bit 1 = N, bit 2= P, bits 3-7 = quality out of 25
    },
  },
  [chars.ECG_TWO]: {
    meta: {
      name: 'ecgListTwo',
      storageType: 'realm',
    },
    parser: {
      0: ['uint24', 'sample0', 3],
      1: ['uint24', 'sample1', 3],
      2: ['uint24', 'sample2', 3],
      3: ['uint24', 'sample3', 3],
      4: ['uint24', 'sample4', 3],
      5: ['uint24', 'sample5', 3],
      6: ['uint24', 'sample6', 3],
      7: ['uint24', 'sample7', 3],
      8: ['uint24', 'sample8', 3],
      9: ['uint24', 'sample9', 3],
      10: ['uint24', 'sample10', 3],
      11: ['uint24', 'sample11', 3],
      12: ['uint24', 'sample12', 3],
      13: ['uint24', 'sample13', 3],
      14: ['uint24', 'sample14', 3],
      15: ['uint24', 'sample15', 3],
      16: ['uint24', 'sample16', 3],
      17: ['uint24', 'sample17', 3],
      18: ['uint24', 'sample18', 3],
      19: ['uint24', 'sample19', 3],
      20: ['uint24', 'sample20', 3],
      21: ['uint24', 'sample21', 3],
      22: ['uint24', 'sample22', 3],
      23: ['uint24', 'sample23', 3],
      24: ['uint24', 'timestamp', 3],
      25: ['uint8', 'ecgState', 1], // bit 0 = both N and P, bit 1 = N, bit 2= P, bits 3-7 = quality out of 25
    },
  },
  [chars.ECG_THREE]: {
    meta: {
      name: 'ecgListThree',
      storageType: 'realm',
    },
    parser: {
      0: ['uint24', 'sample0', 3],
      1: ['uint24', 'sample1', 3],
      2: ['uint24', 'sample2', 3],
      3: ['uint24', 'sample3', 3],
      4: ['uint24', 'sample4', 3],
      5: ['uint24', 'sample5', 3],
      6: ['uint24', 'sample6', 3],
      7: ['uint24', 'sample7', 3],
      8: ['uint24', 'sample8', 3],
      9: ['uint24', 'sample9', 3],
      10: ['uint24', 'sample10', 3],
      11: ['uint24', 'sample11', 3],
      12: ['uint24', 'sample12', 3],
      13: ['uint24', 'sample13', 3],
      14: ['uint24', 'sample14', 3],
      15: ['uint24', 'sample15', 3],
      16: ['uint24', 'sample16', 3],
      17: ['uint24', 'sample17', 3],
      18: ['uint24', 'sample18', 3],
      19: ['uint24', 'sample19', 3],
      20: ['uint24', 'sample20', 3],
      21: ['uint24', 'sample21', 3],
      22: ['uint24', 'sample22', 3],
      23: ['uint24', 'sample23', 3],
      24: ['uint24', 'timestamp', 3],
      25: ['uint8', 'ecgState', 1], // bit 0 = both N and P, bit 1 = N, bit 2= P, bits 3-7 = quality out of 25
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
  [chars.TEMPERATURE]: {
    meta: {
      name: 'temperature',
      storageType: 'realm',
    },
    parser: {
      0: ['int16', 'heatFlux', 2],
      1: ['int16', 'temperature', 2],
      2: ['int16', 'coreBodyTemperature', 2],
      3: ['uint32', 'timestamp', 4],
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
      9: ['int16', 'sample4X', 2],
      10: ['int16', 'sample4Y', 2],
      11: ['int16', 'sample4Z', 2],
      12: ['int16', 'sample5X', 2],
      13: ['int16', 'sample5Y', 2],
      14: ['int16', 'sample5Z', 2],
      15: ['int16', 'sample6X', 2],
      16: ['int16', 'sample6Y', 2],
      17: ['int16', 'sample6Z', 2],
      18: ['int16', 'sample7X', 2],
      19: ['int16', 'sample7Y', 2],
      20: ['int16', 'sample7Z', 2],
      21: ['int16', 'sample8X', 2],
      22: ['int16', 'sample8Y', 2],
      23: ['int16', 'sample8Z', 2],
      24: ['int16', 'sample9X', 2],
      25: ['int16', 'sample9Y', 2],
      26: ['int16', 'sample9Z', 2],
      27: ['int16', 'sample10X', 2],
      28: ['int16', 'sample10Y', 2],
      29: ['int16', 'sample10Z', 2],
      30: ['int16', 'sample11X', 2],
      31: ['int16', 'sample11Y', 2],
      32: ['int16', 'sample11Z', 2],
      33: ['int16', 'sample12X', 2],
      34: ['int16', 'sample12Y', 2],
      35: ['int16', 'sample12Z', 2],
      36: ['uint16', 'timestamp', 2],
    },
  },
};

module.exports = {
  id,
  dataFormat,
  chars,
};
