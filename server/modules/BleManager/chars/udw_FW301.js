const { makeUUID } = require('../misc')

const id = 'udw_FW301';

const chars = {
  SERVICEDATA: 'SERVICEDATA', // not a char per sa but rather a reference to use in parsing and byte decoding
  INVALID_VALUE: -1000,
  ECGPacketInterval: 124,
  ECGSampleCount: 40,
  ACCSampleCount: 18,
  ACCELEROMETER_SAVE: '26659',
  ECG_ONE_SAVE: '26656',
  ECG_TWO_SAVE: '26657',
  ECG_THREE_SAVE: '26658',
  INFORMATION: makeUUID('6801'),
  COMMAND: makeUUID('6802'),
  LOG: makeUUID('6804'),
  ECG_ONE: makeUUID('6820'),
  ECG_TWO: makeUUID('6821'),
  ECG_THREE: makeUUID('6822'),
  STEPS: makeUUID('6840'),
  ACTIVITY_TYPE: makeUUID('6841'),
  ACCELEROMETER: makeUUID('6830'),
  STORED_METRICS: makeUUID('6890'),
  OP_CODES: {
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
      24: ['uint24', 'sample24', 3],
      25: ['uint24', 'sample25', 3],
      26: ['uint24', 'sample26', 3],
      27: ['uint24', 'sample27', 3],
      28: ['uint24', 'sample28', 3],
      29: ['uint24', 'sample29', 3],
      30: ['uint24', 'sample30', 3],
      31: ['uint24', 'sample31', 3],
      32: ['uint24', 'sample32', 3],
      33: ['uint24', 'sample33', 3],
      34: ['uint24', 'sample34', 3],
      35: ['uint24', 'sample35', 3],
      36: ['uint24', 'sample36', 3],
      37: ['uint24', 'sample37', 3],
      38: ['uint24', 'sample38', 3],
      39: ['uint24', 'sample39', 3],
      40: ['uint24', 'timestamp', 3],
      41: ['uint8', 'ecgState', 1], // bit 0 = ECG lead state, bits 1-7 = quality in %
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
      24: ['uint24', 'sample24', 3],
      25: ['uint24', 'sample25', 3],
      26: ['uint24', 'sample26', 3],
      27: ['uint24', 'sample27', 3],
      28: ['uint24', 'sample28', 3],
      29: ['uint24', 'sample29', 3],
      30: ['uint24', 'sample30', 3],
      31: ['uint24', 'sample31', 3],
      32: ['uint24', 'sample32', 3],
      33: ['uint24', 'sample33', 3],
      34: ['uint24', 'sample34', 3],
      35: ['uint24', 'sample35', 3],
      36: ['uint24', 'sample36', 3],
      37: ['uint24', 'sample37', 3],
      38: ['uint24', 'sample38', 3],
      39: ['uint24', 'sample39', 3],
      40: ['uint24', 'timestamp', 3],
      41: ['uint8', 'ecgState', 1], // bit 0 = ECG lead state, bits 1-7 = quality in %
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
      24: ['uint24', 'sample24', 3],
      25: ['uint24', 'sample25', 3],
      26: ['uint24', 'sample26', 3],
      27: ['uint24', 'sample27', 3],
      28: ['uint24', 'sample28', 3],
      29: ['uint24', 'sample29', 3],
      30: ['uint24', 'sample30', 3],
      31: ['uint24', 'sample31', 3],
      32: ['uint24', 'sample32', 3],
      33: ['uint24', 'sample33', 3],
      34: ['uint24', 'sample34', 3],
      35: ['uint24', 'sample35', 3],
      36: ['uint24', 'sample36', 3],
      37: ['uint24', 'sample37', 3],
      38: ['uint24', 'sample38', 3],
      39: ['uint24', 'sample39', 3],
      40: ['uint24', 'timestamp', 3],
      41: ['uint8', 'ecgState', 1], // bit 0 = ECG lead state, bits 1-7 = quality in %
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
      36: ['int16', 'sample13X', 2],
      37: ['int16', 'sample13Y', 2],
      38: ['int16', 'sample13Z', 2],
      39: ['int16', 'sample14X', 2],
      40: ['int16', 'sample14Y', 2],
      41: ['int16', 'sample14Z', 2],
      42: ['int16', 'sample15X', 2],
      43: ['int16', 'sample15Y', 2],
      44: ['int16', 'sample15Z', 2],
      45: ['int16', 'sample16X', 2],
      46: ['int16', 'sample16Y', 2],
      47: ['int16', 'sample16Z', 2],
      48: ['int16', 'sample17X', 2],
      49: ['int16', 'sample17Y', 2],
      50: ['int16', 'sample17Z', 2],
      51: ['int16', 'sample18X', 2],
      52: ['int16', 'sample18Y', 2],
      53: ['int16', 'sample18Z', 2],
      54: ['uint16', 'timestamp', 2],
    },
  },
};

module.exports = {
  id,
  chars,
  dataFormat,
};
