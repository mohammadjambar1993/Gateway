const testV1 = require('./chars/testV1')
const prodV1 = require('./chars/prodV1')
const udw_ads = require('./chars/udw_ads')
const udw_FW3 = require('./chars/udw_FW3')
const udw_FW301 = require('./chars/udw_FW301')
const udw_FW321 = require('./chars/udw_FW321')
const udw_FW400 = require('./chars/udw_FW400')
const udw_FW430 = require('./chars/udw_FW430')
const udw_FW435 = require('./chars/udw_FW435')
const udw_FW700 = require('./chars/udw_FW700')
const udw_FW730 = require('./chars/udw_FW730')

const { makeUUID } = require('./misc')


// This is the UUID that the device broadcasts with
const CONNECTION_UUID = '6800';
const CONNECTION_UUID_SET = '20046800-9630-4EA8-9D21-041484';
const CONNECTION_UUID_SET_ForScan ="20046800-9630-4ea8-9d21-04148452e81f";
const InformationUUID = '20046801-9630-4EA8-9D21-04148452E81F';
const Firmware2ndVersion = udw_ads.id;
const Firmware1stVersion = prodV1.id;
const Firmware3rdVersion = udw_FW3.id;
const Firmware301Version = udw_FW301.id
const Firmware321Version = udw_FW321.id
const Firmware400Version = udw_FW400.id
const Firmware430Version = udw_FW430.id
const Firmware435Version = udw_FW435.id
const Firmware700Version = udw_FW700.id
const Firmware730Version = udw_FW730.id



const SERVICES = {
    // Services
    SKIIN: makeUUID('6800'),
};

const CHARS = {
    testV1: testV1.chars,
    prodV1: prodV1.chars,
    udw_ads: udw_ads.chars,
    udw_FW3: udw_FW3.chars,
    udw_FW301: udw_FW301.chars,
    udw_FW321: udw_FW321.chars,
    udw_FW400: udw_FW400.chars,
    udw_FW430: udw_FW430.chars,
    udw_FW435: udw_FW435.chars,
    udw_FW700: udw_FW700.chars,
    udw_FW730: udw_FW730.chars,
};

// Format should be ['dataType', 'name', numBytes]
const DATA_FORMAT = {
    testV1: testV1.dataFormat,
    udw_FW730: udw_FW730.dataFormat,
    udw_FW700: udw_FW700.dataFormat,
    udw_FW435: udw_FW435.dataFormat,
    udw_FW430: udw_FW430.dataFormat,
    udw_FW400: udw_FW400.dataFormat,
    udw_FW321: udw_FW321.dataFormat,
    udw_FW301: udw_FW301.dataFormat,
    udw_FW3: udw_FW3.dataFormat,
    udw_ads: udw_ads.dataFormat,
    prodV1: prodV1.dataFormat,
};

// Used to display how much batter percent is left
// Represents ['0 bars', '1 bar', '2 bars', '3 bars'] or 4 bars of battery if more than the last value
const batteryThresholds = {
    prodV1: [5, 25, 50, 75],
};


module.exports = {
    // This is the UUID that the device broadcasts with
    CONNECTION_UUID,
    CONNECTION_UUID_SET,
    CONNECTION_UUID_SET_ForScan,
    InformationUUID,
    Firmware2ndVersion,
    Firmware1stVersion,
    Firmware3rdVersion,
    Firmware301Version,
    Firmware321Version,
    Firmware400Version,
    Firmware430Version,
    Firmware435Version,
    Firmware700Version,
    Firmware730Version,
    


    /**
     * Creates a ble unique id for service or charactertic using the fixed prefix and suffix.
     * @param  {String} uuid Variable uuid
     * @return {String}      Full identifier
     */
    makeUUID,

    SERVICES,

    CHARS,

    // Format should be ['dataType', 'name', numBytes]
    DATA_FORMAT,

    // Used to display how much batter percent is left
    // Represents ['0 bars', '1 bar', '2 bars', '3 bars'] or 4 bars of battery if more than the last value
    batteryThresholds,
}
