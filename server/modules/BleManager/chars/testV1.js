const { makeUUID } = require('../misc')

// console.log('cons', cons)


const id = 'testV1';

const chars = {
  MODULE_INFORMATION: makeUUID('3901'),
  ECG1: makeUUID('3933'),
  ECG2: makeUUID('3934'),
};
const dataFormat = {
  [chars.ECG1]: {
    meta: {
      name: 'ecgListOne',
      storageType: 'realm',
    },
    parser: {
      0: ['uint16', 'ecg0', 2],
      1: ['uint16', 'ecg1', 2],
      2: ['uint16', 'ecg2', 2],
      3: ['uint16', 'ecg3', 2],
      4: ['uint16', 'ecg4', 2],
      5: ['uint16', 'ecg5', 2],
      6: ['uint32', 'timestamp', 4],
    },
  },
  GARMENT_ENABLED: false,
  GARMENT_OPTIONS: [
    {
      code: 0xff,
      name: 'Default',
    },
    {
      code: 0x00,
      name: 'Underwear',
    },
    {
      code: 0x01,
      name: 'Bra/Tank',
    },
    {
      code: 0x02,
      name: 'Chest Band',
    },
    {
      code: 0x03,
      name: 'Bralette',
    },
  ],
};

module.exports = {
  id,
  chars,
  dataFormat,
};
