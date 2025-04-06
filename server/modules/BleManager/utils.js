//Same as BleHelpers.js in Devtool
var CryptoJS = require("crypto-js")

const { minVersion } = require('semver');
const {
    makeUUID,
    DATA_FORMAT,
    Firmware1stVersion,
    Firmware2ndVersion,
    Firmware3rdVersion,
    Firmware301Version,
    Firmware321Version,
    Firmware400Version,
    Firmware430Version,
    Firmware435Version,
    Firmware700Version,
    Firmware730Version,
} = require('./constants')

const changeEndianness = (string) => {
    const result = [];
    let len = string.length - 2;
    while (len >= 0) {
      result.push(string.substr(len, 2));
      len -= 2;
    }
    return result.join('');
}

function toHexString(byteArray) {
    return Array.from(byteArray, function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('')
}

function hexStringToByteArray(hexString) {
    if (hexString.length % 2 !== 0) {
        throw "Must have an even number of hex digits to convert to bytes";
    }
    var numBytes = hexString.length / 2;
    var byteArray = [];
    for (var i=0; i<numBytes; i++) {
        byteArray.push(parseInt(hexString.substr(i*2, 2), 16));
    }
    return byteArray;
}

/*
    BLE Encryption/Decryption functions
*/

function bleDecrypt(encryption, data) {
    
    var key = CryptoJS.enc.Hex.parse(encryption.key)
    var crypto_iv = CryptoJS.enc.Hex.parse(toHexString(encryption.iv)+toHexString(encryption.ivCounter))

    var decrypt = CryptoJS.AES.decrypt(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(toHexString(data))),
    key, {
    iv: crypto_iv,
    mode: CryptoJS.mode.CTR,
    padding: CryptoJS.pad.NoPadding
    });

    iv_ctr_temp = changeEndianness(toHexString(encryption.ivCounter))
    iv_ctr_temp = (parseInt(("0x"+iv_ctr_temp), 16) + 0x00000001).toString(16).padStart(8, '0');
    iv_ctr_temp = changeEndianness(iv_ctr_temp);
    encryption.ivCounter = hexStringToByteArray(iv_ctr_temp);
    //    console.log("IncrementIV: "+toHexString(encryption.ivCounter))


    decrypt=hexStringToByteArray(decrypt.toString(CryptoJS.enc.Hex))

    return decrypt
}

function bleEncrypt(encryption, data) {

    var key = CryptoJS.enc.Hex.parse(encryption.key);
    var crypto_iv = CryptoJS.enc.Hex.parse(toHexString(encryption.iv)+toHexString(encryption.ivCounter));
    
    var encrypt = CryptoJS.AES.encrypt(
        CryptoJS.enc.Hex.parse(data),
        key, {
        iv: crypto_iv,
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding
    });
    
    encrypt=hexStringToByteArray(encrypt.ciphertext.toString())
    
    return encrypt
}



function verifyUUID(uuid = '') {
    const uniqueIdentifier = uuid.substring(4, 8);
    const createdUUID = makeUUID(uniqueIdentifier.toUpperCase());
    return createdUUID === uuid.toUpperCase();
}

function makeOpCode(command, data) {
    return command.concat(data);
}

// This function should include all the possible names. 
// There must be a better way to determine the firmware version from advertisement data
function determineFirmware(MajorVersion, MinorVersion, PatchVersion){
    // console.log(MajorVersion)
    // console.log(MinorVersion)
    // console.log(PatchVersion)
    switch(MajorVersion){
        case 1: return Firmware1stVersion
        case 2: return Firmware2ndVersion
        case 3: 
            switch(MinorVersion){
                case 0:
                    switch(PatchVersion) {
                        case 5: return "non-compatibale"
                        default: return Firmware301Version
                    } 
                case 2: 
                    switch(PatchVersion) {
                        case 0: return Firmware301Version
                        default: return Firmware321Version
                } 
                default: return "non-compatibale"
            }
        case 4:
            switch(MinorVersion){
                case 0:
                case 1:
                case 2:
                    return Firmware400Version
                case 3: 
                switch(PatchVersion){
                    case 5:
                        return Firmware435Version
                    default:
                        return Firmware430Version
                }
                default: return "non-compatibale"
            }

        case 7:
            switch(MinorVersion){
                case 0:
                    console.log("Firmware 7")
                    return "non-compatibale"
                    return Firmware700Version
                case 1:
                    console.log("Firmware 7")
                    // return "non-compatibale"
                    return Firmware700Version
                case 3: 
                    console.log("Firmware 7")
                    // return "non-compatibale"
                    return Firmware730Version
                // switch(PatchVersion){
                //     default:
                //         return "non-compatibale"
                // }
                default: return "non-compatibale"
            }

        default: return "non-compatibale"
    }
}

function parse(data, version, char) {
    const info = new Uint8Array(data);
    const type = char.toUpperCase();
    const dataFormat = DATA_FORMAT[version][type].parser;
    const newData = {
        meta: DATA_FORMAT[version][type].meta,
    };
    // console.log(newData)

    let start = 0;
    let t = 0;

    for (let i = 0; i < Object.keys(dataFormat).length; i += 1) {
        const metric = [];
        for (let j = start; j < start + dataFormat[i][2]; j += 1) {
            metric.push(info[j]);
            t = j;
        }

        start = t + 1;

        let result;
        let byteArray;
        let dataView;

        switch (dataFormat[i][0]) {
        case 'uint64':
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getBigUint64(0, true)
            break;
        case 'uint32':
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getUint32(0, true);
            break;
        case 'uint32Time':
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getUint32(0, true);
            let highBytes = Math.floor(Date.now() / (2 ** 32))
            result = result + (highBytes * (2 ** 32))
            break;
        case 'uint24':
            // Pad to 32 bits by adding 0 to end
            metric.push(0);
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getUint32(0, true);
            break;
        case 'uint16':
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getUint16(0, true);
            break;
        case 'uint8':
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getUint8(0, true);
            break;
        case 'int32':
            byteArray = Int8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getInt32(0, true);
            break;
        case 'int24':
            // Pad to 32 bits by adding 0 OR 0XFF to end based on whether it's pos or neg
            //array of bits from the most valuable byte
            const bits = metric[2].toString(2);
            if(bits.length === 8 && bits[0] === '1'){
                metric.push(0XFF);
                byteArray = Int8Array.from(metric);
                dataView = new DataView(byteArray.buffer);
                result = dataView.getInt32(0, true);
                break;
            }else{
                metric.push(0);
                byteArray = Int8Array.from(metric);
                dataView = new DataView(byteArray.buffer);
                result = dataView.getInt32(0, true);
                break;
            }
            
        case 'int16':
            byteArray = Int8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getInt16(0, true);
            break;
        case 'int12':
            const temp = metric[1] << 4
            metric[1] = temp >> 4
            byteArray = Int8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getInt16(0, true);
            break;
        case 'int8':
            byteArray = Int8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getInt8(0, true);
            break;
        case 'long':
            byteArray = Uint8Array.from(metric);
            result = 0
            for ( let i = byteArray.length - 1; i >= 0; i--) {
                result = (result * 256) + byteArray[i];
            }
            break;
        case 'float':
            byteArray = Uint8Array.from(metric);
            dataView = new DataView(byteArray.buffer);
            result = dataView.getFloat32(0, true);
            break;
        default:
            throw new Error('Parsing unexpected format', dataFormat[i][0]);
        }

        if (dataFormat[i][0] === 'uint32') {
            result = dataView.getUint32(0, true);
        } else if (dataFormat[i][0] === 'float') {
            result = dataView.getFloat32(0, true);
        } else if (dataFormat[i][0] === 'uint16') {
            result = dataView.getUint16(0, true);
        } else if (dataFormat[i][0] === 'uint8') {
            result = dataView.getUint8(0, true);
        }else if (dataFormat[i][0] === 'uint64') {
            result = dataView.getBigUint64(0, true);
        }

        newData[dataFormat[i][1]] = result;
    }
    return newData;
}


// Given the lead/quality byte, split the first bit for the lead state and the remaining 7
// for the quality of the ecg.
// SPFW - ECG Lead Quality for FW7 
function getECGLeadAndQuality(byte, firmwareType) {
    if(firmwareType == Firmware321Version || firmwareType == Firmware301Version || firmwareType == Firmware3rdVersion){
        const bits = byte.toString(2);
        return {
            lead: parseInt(bits[7], 2),
            quality: parseInt(bits.slice(0,7), 2),
        };

    }else if(firmwareType == Firmware400Version || firmwareType == Firmware430Version || firmwareType == Firmware435Version){
        const bits = byte.toString(2);
        return {
            lead: parseInt(bits[7], 2),
            leadN: parseInt(bits[6], 2),
            leadP: parseInt(bits[5], 2),
            quality: parseInt(bits.slice(0,5), 2),
        };
    }else{
        // console.log(`WHATS UP BYTE: ${byte}`);
        const bits = byte.toString(2);
        // console.log(`THIS IS WHAT I NEED RIGHT HERE ${bits}`);
        return {
            lead: parseInt(bits[0], 2),
            leadN: parseInt(bits[1], 2),
            leadP: parseInt(bits[2], 2),
            quality: parseInt(bits[3], 2),
        };
    }
}

function uniqueOnlyFilter(value, index, self) {
  return self.indexOf(value) === index;
}


module.exports = {
  bleDecrypt,
  bleEncrypt,
  verifyUUID,
  makeOpCode,
  determineFirmware,
  parse,
  getECGLeadAndQuality,
  uniqueOnlyFilter,
  toHexString,
  hexStringToByteArray,
};

