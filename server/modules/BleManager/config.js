const path = require('path')

const scanDuration = 10000;
const dataLossRateUnit = 2000; // 5 second
const dataLossRateUpdateRatio = 5; //  ratio of loss rate and update loss rate
const dataNotReceivedLimit = 1 // Minutes

const bleEncryptionKeysLimit = 50 // this variable is used to limit the number of pod encryption keys we store locally

const storagePath = path.join(__dirname, '../../data')

const dataProcessInterval = 500

const rssiUpdateInterval = 5000

module.exports = {
  scanDuration,
  dataLossRateUnit,
  dataLossRateUpdateRatio,
  dataNotReceivedLimit,
  bleEncryptionKeysLimit,
  storagePath,
  dataProcessInterval,
  rssiUpdateInterval,
};
