var CryptoJS = require("crypto-js")
// const Noble = require('@abandonware/noble') // ({extended: false});
const { EventEmitter } = require('events')
const fs = require('node:fs/promises')
const path = require('path')
// const util = require('util')
// const CircularReplacer = require("../utils/CircularReplacer")

const Future = require('../../utils/Future')
const { InvalidEncryptionKeysError } = require('./misc')
const ProcessMonitor = require('./modules/ProcessMonitor')
const KeyObjectStorage = require('./modules/KeyObjectStorage')
const FileSystem = require('./modules/FileSystem')

const Config = require('./config')


const {
    parse,
    getECGLeadAndQuality,
    makeOpCode,
    determineFirmware,
    bleEncrypt,
    bleDecrypt,
    uniqueOnlyFilter,
    toHexString,
    hexStringToByteArray,
} = require('./utils')



const {
    SERVICES,
    CHARS,
    InformationUUID,
    CONNECTION_UUID_SET_ForScan,
    Firmware400Version,
    Firmware430Version,
    Firmware435Version,
    Firmware1stVersion,
    Firmware2ndVersion, 
    Firmware3rdVersion,
    Firmware301Version,
    Firmware321Version,
    Firmware700Version,
    Firmware730Version,
} = require('./constants');

const { flattenSample } = require('./ecgHelper')


//Update Encryption Object
const DEFAULT_ENCRYPTION_OBJ = {
  waiting: false,
  enabled: false,
  key: null,
  digit: null,

  //Attributes
  podLock: null,
  lockResponse: null,
  secretNum: null,
  iv: null,
  ivCounter: null,
  endSecretNumber: null,
}


const Noble = require('@abandonware/noble/lib/noble');
const NobleHCIStatuses = require('@abandonware/noble/lib/hci-socket/hci-status.json');
const { Console } = require('console')
const Peripheral = require("@abandonware/noble/lib/peripheral")
const bindings = require('./modules/noble/resolve-bindings')({extended: false});

// console.log('noble bindings', prototypeof(bindings))

// Noble.prototype.onRssiUpdate = function(peripheralUuid, rssi) {
//   var peripheral = this._peripherals[peripheralUuid];

//   if (peripheral) {
//     peripheral.rssi = rssi;

//     peripheral.emit('rssiUpdate', rssi);
//   } else {
//     this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' RSSI update!');
//   }
// };




class BleManager extends EventEmitter {
  constructor({ logger }) {
    super()
    this._log = logger.extend('ble')
    // this.noble = Noble({extended: false})
    this.noble = new Noble(bindings)

    // an in-memory state for ble devices and relative info
    this._state = {
      isScanning: false,
      lastScan: 0,
      podList: {},
      connectedPods: {}, // connected pod objects by ids
      

      // noble state vars
      noble: {
        isReady: new Future(), // this is base on noble.state === 'poweredOn'
        state: 'unknown', // unknown resetting unsupported unauthorized poweredOff poweredOn
        scanTimeout: null,
      },

      // 
      suspended: {
        is: false,
        reason: null,
      },

      debug: {},
    }



    // setup event listeners
    this.noble.on('stateChange', this._nobleStateChange.bind(this));
    this.noble.on('scanStart', this._nobleScanStart.bind(this))
    this.noble.on('scanStop', this._nobleScanStop.bind(this))
    this.noble.on('discover', this._nobleDiscover.bind(this))

    this.noble.on('warning', this._nobleWarning.bind(this))

    // key => promise for prompting users for encryption key
    this._podEncKeyPrompts = {}

    this._currentActiveNotifications = {}

    this._forceSaves = {}

    // passive data stored per pod
    this._podPassiveData = {}
    this._podRawData = []
    // this.clearPassiveData()

    this._podPacketLoss = {}

    // this._lostStreamData = []
    this._lostSaveData = {}

    this._podSettings = {}

    this._dataProcessorTimeout = null
    this._dataProcessorActive = false

    this.fs = new FileSystem({	
      localSavePath: Config.storagePath,	
    })

    // a little process monitoring to make sure memory doesnt leak
    this._processManager = new ProcessMonitor({
      logger: this._log,
      loggerNS: 'processManager',
      fs: this.fs,
    })
    
    this._processManager.on('update', this._onProcessManagerUpdate.bind(this))

    // encryption manager to store/retreive keys
    // SPFW7 - storage for encryption database --> concern because serial number for FW7 not guessed right or firmware had it incorrect?
    this._encryptionDB = new KeyObjectStorage({
      logger: this._log,
      loggerNS: 'ecryptiondb',
      dbpath: path.resolve(__dirname, '../../data/db/enc.json'),
      maxKeys: 200,
      key: 'serialNumber',
    })

    this._encryptionDB.on('update', this._onEncryptionDBUpdate.bind(this))

    this._rssiCheckTimeout = null

    this._writeAsyncPromises = {}

    this._settings = {
      minSpacePercent: 5, // if free space is less than this percent, we will stop saving files and suspend the app until space frees up.
    }

  }

  async init() {
    // this.startRSSIChecker()
    this._log(`init() called, loading encryption db and waiting for ble device to load`)

    await this.fs.init()	
      this.fs.on('usb-detach', (device) => {	
      this._log(`USB device detached`)	
      this._processManager.stop()	
      this.suspendApp('usb storage has been detached, app needs to be restarted to save data')	
    })

    await this._encryptionDB.load()
    this._processManager.start()
    return await this._state.noble.isReady
  }

  async suspendApp(reason) {
    this._log(`suspendApp() called, reason ${reason}`)
    this._state.suspended = {
      is: true,
      reason,
    }

    const peripheralIds = Object.keys(this._state.connectedPods) //.concat(Object.keys(this._state.podList)).filter(uniqueOnlyFilter)

    for (let i = 0; i < peripheralIds.length; i++) {
      const id = peripheralIds[i]
      await this.disconnect(id)
    }

    this._stateUpdated()
  }

  unsuspendApp() {
    if (!this._state.suspended.is) return;
    this._log(`unsuspendApp() called`)
    this._state.suspended = {
      is: false,
      reason: null,
    }

    this._stateUpdated()
  }

  // used by client to sync up to current state of the app
  getCurrentDataSnapshot() {
    return {
      encdb: this._encryptionDB.db(),
      state: this._getState(),
      // podSettings: this._podSettings,
      // podActiveNotifications: this._currentActiveNotifications,
    }
  }

  async startScan(timeout = 10000) {
    // should we reset the local list of pods before each scan?
    this._log(`startScan() called`)
    await this._state.noble.isReady
    this._state.podList = {}

    await this.noble.startScanningAsync([CONNECTION_UUID_SET_ForScan, this._sanitizeNobleIDs(CONNECTION_UUID_SET_ForScan)], false)
    this._state.lastScan = Date.now()
    if (timeout > 0) {
      this._state.noble.scanTimeout = setTimeout(async () => {
        this._log(`startScan(), scan has timed out, stopping scan`)
        await this.stopScan()
      }, timeout)
    }
  }

  async stopScan() {
    // should we reset the local list of pods before each scan?
    this._log(`stopScan() called`)
    if (this._state.noble.scanTimeout) clearTimeout(this._state.noble.scanTimeout)
    if (this._state.isScanning) {
      await this.noble.stopScanningAsync()
    } else {
      this._log(`stopScan(), called while scan is not running`)
    }
  
  }

  async connect(peripheralId) {
    const peripheral = this._state.podList[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not available! Scan again`)
    }
    this._log(`connect() called, connecting to peripheral id ${peripheralId}`)
    await this.stopScan()
    // Data Loss variable reset
    this._clearPacketLoss(peripheralId)
    return await peripheral.connectAsync()
  }

  async disconnect(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not connected! Connect first and then call podStart.`)
    }
    this._log(`disconnect() called, disconnecting from peripheral id ${peripheralId}`)
    const { firmwareType } = peripheral.metadata
    try {
      await this.podStop(peripheralId, true)
    } catch(err) {}
    try {
      if (typeof CHARS[firmwareType].RESPONSE !== 'undefined') {
        this._log(`disconnect(), response characteristic detected, stopping notification`)
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE, true);
      }
    } catch(err) {}
    delete this._podEncKeyPrompts[peripheralId]

    if (peripheral.encryption?.enabled){
      peripheral.encryption.enabled = false;
    }

    return await peripheral.disconnect()
  }

  // returns true if updated, false if value hasnt changed
  async updateRssi(peripheralId) {
    if (typeof this._state.podList[peripheralId] === 'undefined' && typeof this._state.connectedPods[peripheralId] === 'undefined') {
      this._log(`updateRssi() no peripheral id ${peripheralId} found, skipping rssi update`)

      return false
    }
    this._log(`updateRssi() called, peripheral id ${peripheralId}`)
    const peripheral = this._state.podList[peripheralId] || this._state.connectedPods[peripheralId]
    if (!['connected', 'disconnected'].includes(peripheral.state)) {
      this._log(`updateRssi() peripheral state is not in an acceptable state, skipping. state: ${peripheral.state}`)
      return false
    }
    const _prevRSSI = peripheral.rssi
    await peripheral.updateRssi()
    if (_prevRSSI == peripheral.rssi) {
      return false
    }

    return true
  }

  //SPFW7 - Added gyrometer
  clearPassiveData(peripheralId) {
    this._log(`clearPassiveData() called, peripheral id ${peripheralId}`)
    this._podPassiveData[peripheralId] = {
      ECGOne:[],
      ECGTwo:[],
      ECGThree:[],
      HROne:[],
      HRTwo:[],
      accelerometer:[],
      gyrometer: [],
      temperature:[],
      steps:[],
      activity:[],
      // userEvents: [],
      startTime: Date.now()
    }
  }

  // moved all non-sub chars reading to podInit,
  // this will allow us to move around the function to retreive pod info
  // like fw version, serial number etc and display it to users before
  // starting a recording session
  async podInit(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not connected! Connect first and then call podStart.`)
    }

    this._log(`podInit() called, peripheral id ${peripheralId}`)

    try {
      // const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync(); // discoverSomeServicesAndCharacteristics
      // no need to do anything with the response here, we hold
      // a ref to noble's peripheral object, so it will be available through ._state.connectedPods
      this._log(`podInit() discovering all services and chars for peripheral id ${peripheralId}`)
      await peripheral.discoverAllServicesAndCharacteristicsAsync();

      // SPFW7 - Step 1:
      // Retrieve Module info - Returns module info, if FW7> encryptionRequired flag will be set
      await this.retrieveModuleInfo(peripheralId)

      // setup response char handling
      const { firmwareType, encryptionRequired } = peripheral.metadata
      if (typeof CHARS[firmwareType].RESPONSE !== 'undefined') {
        this._log(`podInit() response characteristic detected, starting notification`)
        // await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE);
      } else {
        this._log(`podInit() no response characteristic found. app will not be able to verify write operations`)
      }

      // SPFW7 - Step 2: If encryptionRequired start authentication of pod
      if (encryptionRequired) {
        // enable encryption and authenticate
        await this.enableEncryptionAndAuthenticate(peripheralId)
      }

      // Set pod time
      await this.setPodTime(peripheralId)

      // await this.getPodTime(peripheralId)

    } catch(err) {
      this._log(`podInit() errored, disconnecting pod`, err)
      this._newPodNotification(peripheralId, {
        title: `Disconnecting Pod #${peripheral.metadata.serialNumber}`,
        message: `An error occured while pairing with pod. ('${err.message}')`,
        type: 'error',
      })
      await this.disconnect(peripheralId)
    }    
  }

  async podStart(peripheralId, settings) {
    // pod is connected now, need to start data gathering
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not connected! Connect first and then call podStart.`)
    }
    settings = this._validateSettings(settings)
    this._log(`podStart() called, peripheral id ${peripheralId}, settings ${JSON.stringify(settings)}`)
    this._podSettings[peripheralId] = settings

    // if (typeof this._podPassiveData[peripheralId] === 'undefined') {
    this.clearPassiveData(peripheralId)
    // }

    const { firmwareType } = peripheral.metadata
    // this._lostStreamData = new Array(CHARS[firmwareType].ECGSampleCount).fill(CHARS[firmwareType].INVALID_VALUE)
    this._lostSaveData[peripheralId] = this._lostSaveData[peripheralId] || {}
    for (let i = 0; i < CHARS[firmwareType].ECGSampleCount; i++) {
      const idx = 'sample'+ i
      this._lostSaveData[peripheralId] = {...this._lostSaveData[peripheralId], [idx]: CHARS[firmwareType].INVALID_VALUE}
    }

    this.startDataProcessor()
    await this.startNotifications(peripheralId)
    peripheral.saving = true

    this._stateUpdated()

  }

  async podStop(peripheralId, stopNotificationsPassively=false) {
    // pod is connected and gathering data, lets stop all the services
    // SPRFWS check if there is any passive data to save 
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not connected!`)
    }
    peripheral.saving = false
    this._log(`podStop() called, peripheral id ${peripheralId}, stopNotificationsPassively ${stopNotificationsPassively}`)
    await this.stopNotifications(peripheralId, stopNotificationsPassively)
    clearTimeout(peripheral._fwFailureTimeout)

    if (this._podSettings[peripheralId].saveNumber === false) {
      // once notifications have stopped, we will mark pod to be forced saved for leftover data that may not fullfil our save interval
      this._forceSaves[peripheralId] = true
    }

    const ks = Object.keys(this._state.connectedPods)
    const savingPeripherals = ks.find((pid) => this._state.connectedPods[pid].saving === true)
    if (savingPeripherals === undefined) {
      // no more saves being done. stop processing data
      this.stopDataProcessor()
    }

    this._stateUpdated()
  }

  startDataProcessor() {
    if (this._dataProcessorActive) return;
    this._dataProcessorActive = true
    this._log(`startDataProcessor() called, starting an interval data processor`)
    const processor = async () => {
      clearTimeout(this._dataProcessorTimeout)
      await this._processRawData()
      if (this._dataProcessorActive) {
        this._dataProcessorTimeout = setTimeout(processor, Config.dataProcessInterval)
      }
    }
    processor()
  }

  startRSSIChecker() {
    if (this._rssiCheckTimeout !== null) return;
    this._log(`startRSSIChecker() called, starting up rssi updater service`)
    const checker = async () => {
      clearTimeout(this._rssiCheckTimeout)
      const peripheralIds = Object.keys(this._state.connectedPods).concat(Object.keys(this._state.podList)).filter(uniqueOnlyFilter)
      let updated = false
      for (let i = 0; i < peripheralIds.length; i++) {
        const id = peripheralIds[i]
        let _u = await this.updateRssi(id)
        updated = updated || _u
      }
      if (updated) this._stateUpdated()
      this._rssiCheckTimeout = setTimeout(checker, Config.rssiUpdateInterval)
    }
    checker()
  }

  stopDataProcessor() {
    this._log(`stopDataProcessor() called`)
    this._dataProcessorActive = false
  }

  // SPFW7 - Step 4: Authenticate Pods
  async authenticatePod(peripheralId) {
    // in this function, any Error thrown will stop the
    // initialization of the pod. An exception is made for
    // InvalidEncryptionKeysError which will prompt the user
    // again for keys again
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error('cant enable encryption, peripheral not found')
    }

    this._log(`authenticatePod() called, peripheral id ${peripheralId}`)

    const { firmwareType } = peripheral.metadata
    const { key, digit } = peripheral.encryption

    // comment the line below and complete the function definition
    // return true

    // writeAsync() will create a promise which resolves once we get a
    // response from RESPONSE char
    // write() is passive and its response will be parsed and shown to users
    // with no actions taken
    try {
      const getSecretNumber = CHARS[firmwareType].OP_CODES.READ_POD_SECRET_NUMBER
      // console.log("Buffer Sent: " +  Buffer.from([0x04, 0x99]))
      const response = await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Buffer.from(getSecretNumber))
      // check if response is valid or not
      // console.log("Secret Number Retrieved beginning: " + digit.slice(0, 15))
      // console.log("Secret Number Retrieved ending: " + digit.slice(16))
      // console.log(response)
      // console.log(toHexString(response))
      peripheral.encryption.endSecretNumber = digit.slice(16)

      let metric = []
      for (let i=3; i<11; i+=1){
          metric.push(response[i])
      }
      peripheral.encryption.secretNum = Uint8Array.from(metric)

      // IV
      metric = []
      for (let i=11; i<23; i+=1){
          metric.push(response[i])
      }
      peripheral.encryption.iv = Uint8Array.from(metric)

      // IV Counter
      metric = []
      for (let i=23; i<27; i+=1){
          metric.push(response[i])
      }
      peripheral.encryption.ivCounter = Uint8Array.from(metric)

      // Secret Number
      // console.log("To Hex String secret: " + toHexString(peripheral.encryption.secretNum))
      // console.log("To Hex String iv: " + toHexString(peripheral.encryption.iv)+toHexString(peripheral.encryption.ivCounter))
      // console.log("Message: " + CryptoJS.enc.Hex.parse(toHexString(peripheral.encryption.secretNum)))
      // Decrypted Secret Number
      peripheral.encryption.secretNum = bleDecrypt(peripheral.encryption, peripheral.encryption.secretNum)
      // console.log("Decrypted Secret Number: " + peripheral.encryption.secretNum)
      
      // BLE encrypted last 8bytes of Secret Number
      peripheral.encryption.secretNum=bleEncrypt(peripheral.encryption, peripheral.encryption.endSecretNumber)
      // console.log("Encrypted Secret Number: " + toHexString(peripheral.encryption.secretNum))

      // Generating Command buffer 
      let temp_command = hexStringToByteArray(toHexString(CHARS[firmwareType].OP_CODES.UNLOCK_POD)+toHexString(peripheral.encryption.secretNum)+toHexString(peripheral.encryption.iv)+toHexString(peripheral.encryption.ivCounter)+"01");
      let unlockPodCommand = []
      for (var i=0; i<temp_command.length; i++) {
          unlockPodCommand.push(temp_command[i])
      }

      // console.log("Packet to be uint8array: " + unlockPodCommand)
      // console.log("Hex String: " + toHexString(CHARS[firmwareType].OP_CODES.UNLOCK_POD)+toHexString(peripheral.encryption.secretNum)+toHexString(peripheral.encryption.iv)+toHexString(peripheral.encryption.ivCounter)+"01")
      const hexStr = toHexString(CHARS[firmwareType].OP_CODES.UNLOCK_POD)+toHexString(peripheral.encryption.secretNum)+toHexString(peripheral.encryption.iv)+toHexString(peripheral.encryption.ivCounter)
      const buf = Buffer.from(hexStr, 'hex')
      const payload = Buffer.from(unlockPodCommand, 'hex')
      // console.log(buf)
      // console.log(payload)

      const unlock = await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, payload)
      const status = Uint8Array.from([unlock[2]])[0]
      if (status == 0){
        peripheral.encryption.podLock = false; 
        peripheral.encryption.enabled = true;

        //SPRFW7 --> Use Commannd
        //const detection = await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Buffer.from([0x13,0x00,0x07]))
        // let status = Uint8Array.from([detection[2]])[0]

      }

    } catch(err) {
      throw err
    }
  }

  async read(peripheralId, serviceId, charId) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    const peripheral = this._state.connectedPods[peripheralId]
    this._log(`read() called, peripheral id ${peripheralId}, service id ${serviceId}, characteristic id ${charId}`)

    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) {
      this._log('read() current services', peripheral.services)
      throw new Error('No service found to read from. ')
    }

    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to read from.')

    const data = await characteristic.readAsync()
    // technically don't need to check encryption here its seems to be only called for information module char but we can confirm. 
    return peripheral?.encryption?.enabled ? bleDecrypt(peripheral.encryption, data) : data
  }

  // SPFW7 - Question
  // this is a helper function that writes to pod and waits for RESPONSE char
  // to reply we subscribe to RESPONSE char per write request to simplify
  async writeAsync(peripheralId, serviceId, charId, data, withoutResponse=false, skipPromise=false) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)

    const peripheral = this._state.connectedPods[peripheralId]
    const {firmwareType} = peripheral.metadata

    this._log(`writeAsync() called, peripheral id ${peripheralId}, service id ${serviceId}, characteristic id ${charId}`)
    
    await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE, this.charResponseHandler)

    const sig = this.getCharSig(peripheralId, serviceId, this._sanitizeNobleIDs(CHARS[firmwareType].RESPONSE))
    
    this._writeAsyncPromises[sig] = new Future()	
    this._writeAsyncPromises[sig]._skipPromise = skipPromise
    //if (!skipPromise) this._writeAsyncPromises[sig] = new Future()
    await this.write(peripheralId, serviceId, charId, data, withoutResponse)
    const rawData = await this._writeAsyncPromises[sig]

    await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE)
    return rawData
  }

  charResponseHandler(peripheralId, serviceId, charId, data, isNotification) {
    const peripheral = this._state.connectedPods[peripheralId]
    const {firmwareType} = peripheral.metadata

    if (this._sanitizeNobleIDs(CHARS[firmwareType].RESPONSE) === charId) {
      this._log(`charResponseHandler() detected response char packet`)

      // if we have a pending promise, we resolve that, otherwise
      // we just show results to users
      const sig = this.getCharSig(peripheralId, serviceId, charId)
      // console.log(`Printing sig in charResponseHandler: ${sig}`)

      if (this._writeAsyncPromises[sig] instanceof Promise && !this._writeAsyncPromises[sig]._skipPromise){
        //we have a pending promise, resolve it with raw data for post processing
        this._writeAsyncPromises[sig].resolve(data)
        delete this._writeAsyncPromises[sig]
        // return;
      }

      const responseData = parse(Uint8Array.from(data), firmwareType, CHARS[firmwareType].RESPONSE)

      if (typeof responseData !== 'undefined') {
        const { opcode, status, data } = responseData
        const opKeys = Object.keys(CHARS[firmwareType].OP_CODES)
        const opKey = opKeys.find((k) => CHARS[firmwareType].OP_CODES[k][0] === opcode)
        const opText = opKey.toLowerCase().replaceAll('_', ' ')

        let isSuccess, msg
        switch (status) {
          case 0:
            isSuccess = true
            msg = `'${opText}' command was successful`
            break;
          case 1:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid opcode`
            break;
          case 2:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid arguments length`
            break;
          case 3:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid command`
            break;
          case 4:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid argument`
            break;
          case 5:
            isSuccess = false
            msg = `'${opText}' command failed, reason: command error`
            break;
          case 6:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid state`
            break;
          default:
            throw new Error('Parsing unexpected response status', status);
        }

        this._newPodNotification(peripheralId, {
          title: `Pod #${peripheral.metadata.serialNumber}`,
          message: msg,
          type: isSuccess ? 'success' : 'error'
        })

      }

      // release the promise regardless of success or failure	
      try {
        this._writeAsyncPromises[sig].resolve(data)	
        delete this._writeAsyncPromises[sig]
      } catch (err) {
        this._log(`charResponseHandler() Attempted to resolve a non existent promise`, err)
      }
      

    } else {
      console.warn('charResponseHandler() - received data not matching RESPONSE char')
    }
  }

  async write(peripheralId, serviceId, charId, data, withoutResponse=false) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    const peripheral = this._state.connectedPods[peripheralId]
    this._log(`write() called, peripheral id ${peripheralId}, service id ${serviceId}, characteristic id ${charId}`)
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to write to.')

    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to write to.')

    // data = peripheral?.encryption?.enabled ? bleEncrypt(peripheral.encryption, data) : data
    await characteristic.writeAsync(data, withoutResponse)	
    return true
    return await characteristic.writeAsync(data, withoutResponse)
  }

  async enableEncryptionAndAuthenticate(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant enable encryption, peripheral not found')
    if (peripheral?.encryption?.enabled) return; // already enabled

    // pID = pID || this.state.deviceID
    this._log(`enableEncryptionAndAuthenticate() called, peripheral id ${peripheralId}`)
    // const key = peripheral.encryption.key

    // SPFW7 - STEP 3: Retrieve secret key and Assignment of Encryption Object 
    const storedPair = await this._encryptionDB.get(peripheral.metadata.serialNumber)
    // If encryption object already created for peripheral else assign one using default object 
    peripheral.encryption = peripheral.encryption || {...DEFAULT_ENCRYPTION_OBJ}
    if (storedPair && storedPair.key && storedPair.digit) {
      this._log(`enableEncryptionAndAuthenticate() found a key for pod ${peripheralId} key: ${key}, digit: ${digit}}`)
      // we will wait for users confirmation to enable this flag
      peripheral.encryption.enabled = false
      peripheral.encryption.key = key
      peripheral.encryption.digit = digit
      // we have the key stored

      // this._stateUpdated()
      // return key
    }
    // 'waiting' is used in case client refreshes the browser page
    // initial sync will pick this up and try to resume
    // peripheral.encryption.waiting = true
    // this._stateUpdated()

    this._log(`enableEncryptionAndAuthenticate() prompting user for pod ${peripheralId}`)
    try {
      //added reconnection to bypass user prompt
      if (!peripheral.encryption?.key) await this.retrieveEncryptionKeyFromUser(peripheralId)
      this._log(`enableEncryptionAndAuthenticate() key has been received, encryption is now enabled for pod ${peripheralId}`)
      // return true;
    } catch (err) {
      this._log(`enableEncryptionAndAuthenticate() error`, err)
      throw new Error('failed to retrieve encryption key from user')
    }

    // once we have the key, we attempt to authenticate
    try {
      await this.authenticatePod(peripheralId)
      this._log(`enableEncryptionAndAuthenticate() auth has been successful for pod ${peripheralId}`)
      this._stateUpdated()
      // return true;
    } catch (err) {
      if (err instanceof InvalidEncryptionKeysError) {
        this._log(`enableEncryptionAndAuthenticate() InvalidEncryptionKeysError detected, will prompt user for fresh keys`)
        // reset encryption object and replay the function
        // to get fresh key pair
        peripheral.encryption = {...DEFAULT_ENCRYPTION_OBJ}
        return await this.enableEncryptionAndAuthenticate(peripheralId)
      } else {
        this._log(`enableEncryptionAndAuthenticate() error`, err)
        throw new Error('failed to retrieve encryption key from user')
      }
    }
    
  }

  async retrieveModuleInfo(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    let moduleInfo;

    /*
        V4 vs V7 pod FW detection
        we attempt a regular read to get info, if it fails we try encrypted communication
        if we get info, we check FW version to set isEncryptionEnabled key

        ** Sept 16 2022: info channel is always unlocked, so we can adjust this logic accordingly
    */

    this._log(`retrieveModuleInfo() called, peripheral Id: ${peripheralId}`)
    moduleInfo = await this.read(peripheralId, SERVICES.SKIIN, InformationUUID);

    
    if(!moduleInfo) {
      throw new Error('could not get module info')
    }

    // Determining the firmware type based on the moduleInfo
    // The module Info is being parsed based on an early version of the firmware as it has not changed
    // In case this changes in the future, the moduleInfo parse should be done independantly here.
    const moduleInfoRaw = moduleInfo
    moduleInfo = parse(moduleInfo, "prodV1", InformationUUID);    
    this._log(`retrieveModuleInfo() module info parsed, peripheral Id: ${peripheralId}`, moduleInfo)
    // Calculate firmware version
    const firmwareVersion = `${moduleInfo.firmwareMajor}.${moduleInfo.firmwareMinor}.${moduleInfo.firmwarePatch}`;
    const firmwareType = determineFirmware(moduleInfo.firmwareMajor,moduleInfo.firmwareMinor,moduleInfo.firmwarePatch)
    if(firmwareType === "non-compatibale"){
      throw new Error('The firmware version is not compatible')
    }
    //SPFW7 - FW7
    this._log(`retrieveModuleInfo() firmwareType determined: ${firmwareType}`)

    moduleInfo = parse(moduleInfoRaw, firmwareType, InformationUUID);
    this._log(`retrieveModuleInfo() reparsed module info with correct fwType: ${moduleInfo}`)

    let serviceData, serviceDataBytes
    try {
      // serviceDataBytes = Uint8Array.from( (peripheral.advertisement.serviceData.find((sd) => sd.uuid === '180a')).data )
      serviceDataBytes = Uint8Array.from( peripheral.advertisement.serviceData[0].data )
      serviceData = parse(serviceDataBytes, firmwareType, CHARS[firmwareType].SERVICEDATA)
    } catch(err) {
      this._log('retrieveModuleInfo() error', err)
    }
    const encryptionRequired = (moduleInfo.firmwareMajor >= 7) ? true : false;

    peripheral.metadata = {
      hardwareVersion: moduleInfo.hardwareVer,
      firmwareType,
      firmwareVersion,
      batteryLevel: moduleInfo.batteryLevel,
      temperature: moduleInfo.temperature,
      recordedTemperatureTime: (new Date()).toISOString(),
      ECGSampleCount: CHARS[firmwareType].ECGSampleCount,
      ECGPacketInterval: CHARS[firmwareType].ECGPacketInterval,
      serialNumber: serviceData.serialNumber,
      garmentId: moduleInfo.garmentID,
      garmentOptions: CHARS[firmwareType].GARMENT_OPTIONS,
      encryptionRequired,
      encryptionEnabled: peripheral?.metadata?.encryptionEnabled || false,
    }
    peripheral.metadata.signalOptions = this._getSignalOptions(peripheral.id)
    // console.log(peripheral.metadata)
    this._stateUpdated()

    this._log(`retrieveModuleInfo() completed for ${peripheralId}`)

    return {
        firmwareType
    }
  }

  retrieveEncryptionKeyFromUser(peripheralId) {
    if (this._podEncKeyPrompts[peripheralId] && this._podEncKeyPrompts[peripheralId].resolve) {
      this._log(`retrieveEncryptionKeyFromUser() detected a pending encryption key promise for pod ${peripheralId}`)
      // since encryption keys etc will be prompted before data recording happens
      // and right after connecting to a pod, the only time this should 
      // happen is when 2+ different "clients" try to connect to a pod at the same time
      throw new Error('duplicate enc request promise, this is a race condition so we will reject this call. ')
    }
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant prompt user for encryption, peripheral not found')

    this._log(`retrieveEncryptionKeyFromUser() called, retreiving keys for pod ${peripheralId}`)
    const promise = new Promise((resolve, reject) => {
      this._podEncKeyPrompts[peripheralId] = {
        resolve,
        reject,
      }
    })

    this.emit('prompt:encryption:key', {
      peripheralId,
      key: peripheral.encryption.key,
      digit: peripheral.encryption.digit,
    })


    // this promise will be resolved by the modal once key is retrieved
    return promise
  }

  // SPFW7 - Set Encryption key - Return on promise of getEncrytionKeyFromUser, error handling when pod disconnect before completion**
  async setEncryptionKey(peripheralId, { key, digit }) {
    const peripheral = this._state.connectedPods[peripheralId]
    key = this._sanitizeEncryption(key)
    digit = this._sanitizeEncryption(digit)

    // console.log(` Key Inputted ${key}`)
    // console.log(` Digit Inputted ${digit}`)
    // console.log(`Peripheral ID ${peripheralId}`)

    if (!peripheral) {
      reject('setEncryptionKey: peripheral not found', peripheralId)
      throw new Error('peripheral doesnt appear to be connected.')
    }

    let podPromise = this._podEncKeyPrompts[peripheralId]
    if (!podPromise || !podPromise.resolve || !podPromise.reject) {
      const nofn = () => undefined
      podPromise = podPromise || {}
      podPromise.resolve = podPromise.resolve || nofn
      podPromise.reject = podPromise.reject || nofn
    }

    this._log(`setEncryptionKey() called, for peripheralId ${peripheralId}, key: ${key}, digit: ${digit}`)

    // validate your encryption key here before going forward
    // I didnt add any hard validation as I am not sure what I'd check for
    // some basic checks
    if (!key
        || key.length <= 3
        || !digit
        || digit <= 3) {
        // error
      // we dont reject connection, expect user to correct input
      throw new Error('Encryption Key and Digit are incorrect. Check values and try again')
        // return;
    }
    // save the key and resolve the promise for pod connection to be completed
    // SPFW7 - Encyrption info Object and peripheral related updates 
    await this._encryptionDB.set({
      key,
      digit,
      peripheralId,
      serialNumber: peripheral.metadata.serialNumber,
    })
    peripheral.metadata.encryptionEnabled = true
    peripheral.encryption = peripheral.encryption || {...DEFAULT_ENCRYPTION_OBJ}
    // SPFW7 - Conncern: This flag should not be enabled until pod is unlocked or we don't get response when authenticating
    // peripheral.encryption.enabled = true
    peripheral.encryption.key = key
    peripheral.encryption.digit = digit

    this._stateUpdated()
    delete this._podEncKeyPrompts[peripheralId]

    return podPromise.resolve()
  }

  getCharSig(peripheralId, serviceId, charId) {
    return `${peripheralId}::${serviceId}::${charId}`
  }

  incrementNotificationCount(peripheralId, serviceId, charId) {
    const sig = this.getCharSig(peripheralId, serviceId, charId)
    this._currentActiveNotifications[peripheralId][sig].count++
  }

  notificationCurrentlyActive(peripheralId, serviceId, charId, set=false, active=null) {
    const sig = this.getCharSig(peripheralId, serviceId, charId)
    if (set) {
      this._currentActiveNotifications[peripheralId] = this._currentActiveNotifications[peripheralId] || {}
      this._currentActiveNotifications[peripheralId][sig] = { serviceId, charId, active, count: 0 }
      return active
    }
    return this._currentActiveNotifications?.[peripheralId]?.[sig]?.active || false
  }

  async startNotification(peripheralId, serviceId, charId, dataHandler = false) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    const isNotificationActive = this.notificationCurrentlyActive(peripheralId, serviceId, charId)	
    if (isNotificationActive)  {
      throw new Error(`There is currently an active notification with the same signature. Aborting as this can cause a memory leak, id: ${peripheralId}, serviceId: ${serviceId}, charId: ${charId}`)
    }
    const peripheral = this._state.connectedPods[peripheralId]
    this._log(`startNotification() called, for peripheralId ${peripheralId}, service id: ${serviceId}, characteristic id: ${charId}`)
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to subscribe to.')
    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to read from.')
    dataHandler = dataHandler || this._nobleCharacteristicsData
    //this.notificationCurrentlyActive(peripheralId, serviceId, charId, true, true)
    characteristic._readerfn = dataHandler.bind(this, peripheralId, serviceId, charId)
    characteristic.on('data', characteristic._readerfn)
    // characteristic.on('data', (data, isNotification) => this._nobleCharacteristicsData(peripheralId, serviceId, charId, data, isNotification))
    await characteristic.subscribeAsync()
    this.notificationCurrentlyActive(peripheralId, serviceId, charId, true, true)	
    return true
  }

  async stopNotification(peripheralId, serviceId, charId, passive=false) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    const isNotificationActive = this.notificationCurrentlyActive(peripheralId, serviceId, charId)	
    if (!isNotificationActive) {
      if (!passive) {
        throw new Error(`There is currently NO active notification with the same signature. Aborting as this can cause a memory leak, id: ${peripheralId}, serviceId: ${serviceId}, charId: ${charId}`)
      }

      return false
    }
    const peripheral = this._state.connectedPods[peripheralId]
    this._log(`stopNotification() called, for peripheralId ${peripheralId}, service id: ${serviceId}, characteristic id: ${charId}, passive: ${passive}`)
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to unsubscribe from.')

    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to unsub from.')

    //this.notificationCurrentlyActive(peripheralId, serviceId, charId, true, false)

    characteristic.removeListener('data', characteristic._readerfn)
    await characteristic.unsubscribeAsync()	
    this.notificationCurrentlyActive(peripheralId, serviceId, charId, true, false)	
    return true
  }

  async stopNotifications(peripheralId, passive=false) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant disable start notifications, peripheral not found ' + peripheralId)
    this._log(`stopNotifications() called, for peripheralId ${peripheralId}, passive: ${passive}`)
    const { firmwareType } = peripheral.metadata

    try {
      // stop information service
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].INFORMATION, passive);

      // Start heart rate service -- Version 3 Firmware doesn't support Hear rate
      if (CHARS[firmwareType].HEART_RATE_ONE){
        this._log(`stopNotifications() stopping heart rate`)
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_ONE, passive);
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_TWO, passive);

      }
      
      // Start ECG service
      if (CHARS[firmwareType].ECG_ONE){
        this._log(`stopNotifications() stopping EGC one`)
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_ONE, passive);
      }
      
      if (CHARS[firmwareType].ECG_THREE){
        this._log(`stopNotifications() stopping EGC two`)
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_TWO, passive);
      }

      if (CHARS[firmwareType].ECG_THREE){
          this._log(`stopNotifications() stopping EGC three`)
          await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_THREE, passive);
      }
      // Reset step counter on pod
      await this.resetStepCounter(peripheralId);

      // Start Activity Service
      this._log(`stopNotifications() stopping steps`)
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].STEPS, passive);
      
      if(CHARS[firmwareType].ACTIVITY_TYPE){
        this._log(`stopNotifications() stopping activity type`)
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACTIVITY_TYPE, passive);
      }
      
      // Start temperature service - test feature added in some FW versions
      if (CHARS[firmwareType].TEMPERATURE){
          this._log(`stopNotifications() stopping temperature`)
          await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].TEMPERATURE, passive);
      }

      // Start accelerometer service
      this._log(`stopNotifications() stopping accelerometer`)
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACCELEROMETER, passive);

      if(CHARS[firmwareType].GYROMETER){
        this._log(`stopNotifications() stopping gyrometer`)
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].GYROMETER, passive);
      }

    } catch (err) {
      this._log(`stopNotifications() Failed to stop notifications`, err)
      // await this.disconnect(peripheralId)
    }

  }

  async startNotifications(peripheralId){
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant enable start notifications, peripheral not found ' + peripheralId)
    const { firmwareType } = peripheral.metadata


    this._log(`startNotifications() called, peripheral id: ${peripheralId}`)

    try {
      // Start information service
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].INFORMATION);
      // Set Heart Rate sample rate to 1
      if(CHARS[firmwareType].OP_CODES.HEART_RATE_THRESHOLD){
          this._log(`startNotifications() heart rate threshold detected, starting notification`)
          const heartRateThresholdCommand = makeOpCode(CHARS[firmwareType].OP_CODES.HEART_RATE_THRESHOLD, [0x01]);
          await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, heartRateThresholdCommand, false, true);
      }

      // Start heart rate service -- Version 3 Firmware doesn't support Hear rate
      if (CHARS[firmwareType].HEART_RATE_ONE){
        this._log(`startNotifications() heart rate detected, starting notifications`)
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_ONE);
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_TWO);
      }
      
      // Start ECG service
      if (CHARS[firmwareType].ECG_ONE){
        this._log(`startNotifications() starting ECG one notification`)
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_ONE);
      }

      if (CHARS[firmwareType].ECG_TWO){
        this._log(`startNotifications() starting ECG two notification`)
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_TWO);
      }
      
      if (CHARS[firmwareType].ECG_THREE){
        this._log(`startNotifications() starting ECG three notification`)
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_THREE);
      }
      // Reset step counter on pod
      await this.resetStepCounter(peripheralId);

      // Set step notification frequency to occur every step
      this._log(`startNotifications() writing step notification frequency to occur every step`)
      const stepThresholdCommand = makeOpCode(CHARS[firmwareType].OP_CODES.STEP_THRESHOLD, [0x01]);
      await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Buffer.from(stepThresholdCommand), false, true);

      // Start Activity Service
      this._log(`startNotifications() starting steps notification`)
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].STEPS);

      if(CHARS[firmwareType].ACTIVITY_TYPE){
        this._log(`startNotifications() starting activity type notification`)
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACTIVITY_TYPE);
      }
      
      // Start temperature service - test feature added in some FW versions
      if (CHARS[firmwareType].TEMPERATURE){
          this._log(`startNotifications() starting temperature notification`)
          await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].TEMPERATURE);
      }

      // Start accelerometer service
      this._log(`startNotifications() starting accelerometer notification`)
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACCELEROMETER);
      // Start gyrometer service 
      if(CHARS[firmwareType].GYROMETER){
        this._log(`startNotifications() starting gyrometer notification`)
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].GYROMETER);
      }
      // update GUI with data? 
      // this.hrInterval = setInterval(() => {
      //     setSavedObjectData("deviceData",{ currentHeartRate: this.activeHR } )
      // }, 1000);

      // const dataLossRateUpdateUnit = Config.dataLossRateUnit / Config.dataLossRateUpdateRatio
      // this.LossRateInterval = setInterval(() => {
      //     setSavedObjectData("deviceData", {lossRate: this.packetLossRate} )
      // }, dataLossRateUpdateUnit);

    } catch (err) {    
      this._log(`startNotifications() nFailed to initialize the device, disconnecting from peripheral`, err)
      this._newPodNotification(peripheralId, {
        title: `Disconnecting Pod #${peripheral.metadata.serialNumber}`,
        message: `An error occured while starting a new recording session. ('${err.message}')`,
        type: 'error',
      })
      await this.disconnect(peripheralId)
    }
  }

  async getPodSavePath(peripheralId, prefix, shouldCreateFolder=true, timestamp=false) {
    const peripheral = this._state.connectedPods[peripheralId] || this._state.podList[peripheralId]
    if (!peripheral) throw new Error('cant get pod dir, peripheral not found ' + peripheralId)
    prefix = prefix ? prefix + '_' + this._podSettings[peripheralId].csvFileName : this._podSettings[peripheralId].csvFileName
    const myDate = timestamp ? new Date(timestamp) : new Date()
    let myYear = myDate.getFullYear()
    let myMonthCorrected = myDate.getMonth() + 1
    let myMonth = myMonthCorrected >= 10? myMonthCorrected : "0" + myMonthCorrected
    let myDay = myDate.getDate() >=10? myDate.getDate() : "0" + myDate.getDate()
    let myHours = myDate.getHours() >= 10? myDate.getHours() : "0" + myDate.getHours()
    let myMinutes = myDate.getMinutes() >= 10? myDate.getMinutes() : "0" + myDate.getMinutes()
    let mySeconds = myDate.getSeconds() >= 10? myDate.getSeconds() : "0" + myDate.getSeconds()
    const deviceIDStripped = peripheralId.replace(/:/g, "-")
    const deviceTimestamp = deviceIDStripped + myYear +"-" + myMonth +"-"+ myDay + "at" + myHours + "H" + myMinutes + "M" + mySeconds + "S"

    const fileName = `${prefix}-${deviceTimestamp}.csv`
    const folder = `${deviceIDStripped}/${myYear}-${myMonth}/${myDay}/`
    const pathToWrite = folder + fileName

    if (shouldCreateFolder) {
      try {
        await this.fs.mkdir(folder, { recursive: true })
      } catch(err) {
        if (!['EEXIST'].includes(err.code)) {
          // err not related to folder already existing
          this._log(`getPodSavePath() failed to create directory, error`, err)
        }
      }
    }

    return pathToWrite
  }

  async resetStepCounter(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant reset pod step counter, peripheral not found ' + peripheralId)
    this._log(`resetStepCounter() called, for peripheral id ${peripheralId}`)
    const { firmwareType } = peripheral.metadata;
    await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Buffer.from( CHARS[firmwareType].OP_CODES.RESET_STEPS ), false, true);	
    peripheral.metadata.lastStepCounter = 0;	
    // try-catch is no longer used, errors should be captured from the caller function	
    // try {	
    // } catch (err) {	
    //   // TODO: Handle step reset failure by tracking roll-over	
    // }
  }

  // TODO: this feature is not implemented on the pod firmware, it is only a placeholder for future implementations
  async getPodTime(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant get pod time, peripheral not found ' + peripheralId)
    this._log(`getPodTime() called, for peripheral id ${peripheralId}`)
    const { firmwareType } = peripheral.metadata;

    const readTimeCommand = makeOpCode(CHARS[firmwareType].OP_CODES.READ_REALTIME_CLOCK, []);
    let podTime = await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Uint8Array.from(readTimeCommand), false, true);
  }

  async setPodTime(peripheralId, currentTime=undefined) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant set pod time, peripheral not found ' + peripheralId)
    this._log(`setPodTime() called, for peripheral id ${peripheralId}, currentTime: ${currentTime}`)
    const { firmwareType } = peripheral.metadata;

    // Set the real time clock on the pod
    currentTime = currentTime || Date.now()
    var currHex = currentTime.toString(16)
    if(currHex.length % 2 !== 0){
        currHex = "0" + currHex
    }            
    var currTimeArray = Array(8 - (currHex.length/2)).fill(0);

    for (var i = 0; i < currHex.length; i += 2) {
        currTimeArray.unshift(parseInt(currHex.substr(i, 2),16));
    }

    const setRelTimeClockCommand = Buffer.from( Uint8Array.from(makeOpCode(CHARS[firmwareType].OP_CODES.SET_REALTIME_CLOCK, currTimeArray)) )
    return await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, setRelTimeClockCommand, false, true);
  }

  async resetBleDevice() {
    this._log(`resetBleDevice() called`)
    return await this.noble.resetAsync()
  }

  async _saveErrorToFile(peripheralId){
    this._log(`_saveErrorToFile() called, for peripheral id ${peripheralId}`)
    try {
      const pathToWrite = await this.getPodSavePath(peripheralId, 'ERR')
      await this.fs.writeFile(pathToWrite, `Haven't received data from FW for ${Config.dataNotReceivedLimit} minutes`)
      this._log(`_saveErrorToFile() file saved for peripheral id ${peripheralId}`)
    } catch(err) {
      this._log(`_saveErrorToFile() error`, err)
    }
  }

  async _saveToCSVFile(peripheralId, data, stopTime, timestamp) {

    // Creating the meta header
    const peripheral = this._state.connectedPods[peripheralId] || this._state.podList[peripheralId]
    if (!peripheral) throw new Error('cant saveToCSVFile, peripheral not found ' + peripheralId)
    if (this._podSettings[peripheralId].test) {
      this._log(`_saveToCSVFile() test mode detected. Will not save file.`)
      this._podSettings[peripheralId].filesSaved += 1
      // Data Loss variable reset
      this._clearPacketLoss(peripheralId, 'total')
      this._stateUpdated()
      return;
    }


    const saveStopTime = new Date(stopTime).toString()
    const saveDuration = timestamp - data.startTime
    const packetLoss = this._podPacketLoss[peripheralId]
    const { firmwareType, firmwareVersion, hardwareVersion } = peripheral.metadata
    const metaString = `${peripheralId}, ${firmwareVersion}, ${hardwareVersion},${saveDuration / 1000}, ${saveStopTime}, ${packetLoss.total.ecgListOne}, ${packetLoss.total.ecgListTwo}, ${packetLoss.total.ecgListThree}\n`

    this._log(`_saveToCSVFile() called, for peripheral id ${peripheralId}, stop time: ${saveStopTime}, duration: ${saveDuration}`)

    //Creating correct ECG String with lead states
    const createECGString = (key, includeEvents=false) => data[`ECG${key}`].map((item)=>{
      let myString = CHARS[firmwareType][`ECG_${key.toUpperCase()}_SAVE`]
      for (let i=0; i < CHARS[firmwareType].ECGSampleCount; i++){
          const myIndex = 'sample'+ i
          myString += `,${item[myIndex]}`
      }
      myString += (firmwareType === Firmware400Version || firmwareType === Firmware430Version || firmwareType === Firmware435Version) ? 
      `,${item['timestamp']},${item['leadState']},${item['NLeadState']},${item['PLeadState']},${item['ecgQuality']}`: 
      `,${item['timestamp']},${item['leadState']},${item['ecgQuality']}`

      if (includeEvents && typeof item.userEvent !== 'undefined') {
          myString += `${item['userEvent'].timestamp},${item['userEvent'].name}\n`
      } else {
        myString += '\n'
      }
      return myString
    }).join('')


    const ECGOneString = createECGString('One', true)

    // Creating the ECGTwo string using the firmware specific lengths.
    const ECGTwoString = createECGString('Two')
    // Creating the ECGThree string using the firmware specific lengths.
    // let ECGThreeString=''
    const ECGThreeString = createECGString('Three')

    //Creating other strings. 
    // ToDO: Change these to dynamic too..
    const HROneString = data.HROne.map((d)=>`26672,${d['sample0']},${d['sample1']},${d['sample2']},${d['sample3']},${d['sample4']},${d['sample5']},${d['sample6']},${d['sample7']},${d['sample8']},${d['sample9']},${d['sample10']}\n`).join('');
    const HRStwoString = data.HRTwo.map((d)=>`26673,${d['sample0']},${d['sample1']},${d['sample2']},${d['sample3']},${d['sample4']},${d['sample5']},${d['sample6']},${d['sample7']},${d['sample8']},${d['sample9']},${d['sample10']}\n`).join('');
    const StepsString = data.steps.map((d)=>`26674,${d['stepCounter']},${d['startTime']},${d['endTime']}\n`).join('');
    const TemperatureString = firmwareType === Firmware435Version ?
    data.temperature.map((d)=>`26690,${d['heatFlux']},${d['temperature']},${d['coreBodyTemperature']},${d['transformedHeatFlux']},${d['transformedTemperature']},${d['timestamp']}\n`).join('') 
    : (firmwareType === Firmware400Version || firmwareType === Firmware430Version)?
     data.temperature.map((d)=>`26690,${d['heatFlux']},${d['temperature']},${d['coreBodyTemperature']},${d['timestamp']}\n`).join('') :
     data.temperature.map((d)=>`26690,${d['heatFlux']},${d['temperature']},${d['timestamp']}\n`).join('');
    const ActivityString = data.activity.map((d)=>`26675,${d['activityType']},${d['startTime']}\n`).join('');
  
    const AccelerometerString = data.accelerometer.map((item)=>{
        let myString = CHARS[firmwareType].ACCELEROMETER_SAVE
        for (let i=1; i<CHARS[firmwareType].ACCSampleCount + 1 ; i++){
            let myIndex = 'sample'+ i +'X'
            myString += `,${item[myIndex]}`
            myIndex = 'sample'+ i +'Y'
            myString += `,${item[myIndex]}`
            myIndex = 'sample'+ i +'Z'
            myString += `,${item[myIndex]}`
        }
        myString += `,${item['timestamp']}\n`
        return myString
    }).join('')

    //Added Gyrometer if Available 
    var GyrometerString = ""
    if(CHARS[firmwareType].GYROMETER_SAVE){
        GyrometerString = data.gyrometer.map((item)=>{
        let myString = CHARS[firmwareType].GYROMETER_SAVE
        for (let i=1; i<CHARS[firmwareType].GYROSampleCount + 1 ; i++){
            let myIndex = 'sample'+ i +'X'
            myString += `,${item[myIndex]}`
            myIndex = 'sample'+ i +'Y'
            myString += `,${item[myIndex]}`
            myIndex = 'sample'+ i +'Z'
            myString += `,${item[myIndex]}`
        }
        myString += `,${item['timestamp']}\n`
        return myString
    }).join('')
  }

    const csvString = `${metaString}${ECGOneString}${ECGTwoString}${ECGThreeString}${HROneString}${HRStwoString}${AccelerometerString}${GyrometerString}${StepsString}${ActivityString}${TemperatureString}`
    const pathToWrite = await this.getPodSavePath(peripheralId, false, true, stopTime)

    this._log(`_saveToCSVFile() writing to file ${pathToWrite}`);
    try {
      await this.fs.writeFile(pathToWrite, csvString)
      this._log(`_saveToCSVFile() file written successfully`)
      this._podSettings[peripheralId].filesSaved += 1
      // Data Loss variable reset
      this._clearPacketLoss(peripheralId, 'total')
      this._stateUpdated()
    } catch(err) {
      this._log(`_saveToCSVFile() error`, err)
    }
  }

  _clearPacketLoss(peripheralId, keys=['total', 'rate', 'timestampReceived']) {
    if (!Array.isArray(keys)) keys = [keys]
    this._podPacketLoss[peripheralId] = this._podPacketLoss[peripheralId] || {}
    if (keys.includes('total')) {
      this._podPacketLoss[peripheralId].total = {ecgListOne: 0 , ecgListTwo: 0, ecgListThree: 0} 
    }
    if (keys.includes('rate')) {
      this._podPacketLoss[peripheralId].rate = {ecgListOne: [] , ecgListTwo: [], ecgListThree: []}
    }
    if (keys.includes('timestampReceived')) {
      this._podPacketLoss[peripheralId].timestampReceived = {ecgListOne: null, ecgListTwo: null, ecgListThree: null}
    }
  }

  _checkForDataLoss(peripheralId, data, identifier, firmwareType){
    // this._log(`_checkForDataLoss() called, peripheral id: ${peripheralId}`)
    const interval = CHARS[firmwareType].ECGPacketInterval
    if (!this._podPacketLoss[peripheralId]) {
      // should run the first time only
      this._clearPacketLoss(peripheralId)
    }
    const packetLoss = this._podPacketLoss[peripheralId]

    function calculateLossRate(lostPacketNum){
        // Updating the total data loss variable if there is loss
        packetLoss.total[identifier] += lostPacketNum
        const info = {time: lastTimestamp, num: lostPacketNum}
        packetLoss.rate[identifier].push(info)
    }

    if (packetLoss.rate[identifier].length > 0) {
      for (let i = 0; i < packetLoss.rate[identifier].length; i++) {
        if(data.timestamp - packetLoss.rate[identifier][0].time > Config.dataLossRateUnit){
          packetLoss.rate[identifier].shift()
        } else {
          break
        }
      }
    }

    if ( packetLoss.timestampReceived[identifier] === null){
      // Initialization of the lastTimestamps
      packetLoss.timestampReceived[identifier] = data.timestamp
      return { thereIsDataLoss: false, lostPacketNum: 0 }
    }
    const lastTimestamp = packetLoss.timestampReceived[identifier]
    // Renew the lastTimestampReceieved 
    packetLoss.timestampReceived[identifier] = data.timestamp
    // Check for packet loss based on last received timestamp
    const timeDiff = data.timestamp - lastTimestamp
    //Check if the packet timestamp is whitin the acceptable range
    if((timeDiff > (interval - 3)) && (timeDiff < (interval + 3))){
        // No Loss
        return { thereIsDataLoss: false, lostPacketNum: 0 }
    }
    if ( data.timestamp === lastTimestamp ){
        // Duplicate
        this._log(`_checkForDataLoss() duplicate detected`)
        return { thereIsDataLoss: false, lostPacketNum: 1 }
    }
    const lostPacketNum = Math.floor(timeDiff / interval)
    const mod = timeDiff % interval
    if (lostPacketNum > 0) {
      if (mod < 3 ) {
          // Missing lostPacketNum -1 packets
          this._log(`_checkForDataLoss() missing packets deducted, loss: ${lostPacketNum - 1}`)
          calculateLossRate(lostPacketNum - 1)
          return { thereIsDataLoss: true, lostPacketNum: lostPacketNum - 1 }
      } else if (mod > interval - 3) {
          // Missing lostPacketNum packets
          this._log(`_checkForDataLoss() missing packets deducted, loss: ${lostPacketNum}`)
          calculateLossRate(lostPacketNum)
          return { thereIsDataLoss: true, lostPacketNum }
      } else {
          // wrong timestamp
          this._log(`_checkForDataLoss() wrong timestamp detected`)
          return { thereIsDataLoss: false, lostPacketNum: 2 }
      }
    } else {
      // wrong timestamp
      this._log(`_checkForDataLoss() wrong timestamp detected **`)
      return { thereIsDataLoss: false, lostPacketNum: 2 }
    }
  }

  async _processRawData() {
    const podRawData = this._podRawData
    this._podRawData = []

    this._log(`_processRawData() processing ${podRawData.length} events`)

    let shouldEmitUpdate = false

    const updatesPerPod = {}

    for (let i = 0; i < podRawData.length; i++) {
      const {
        peripheralId,
        serviceId,
        charId,
        data,
        timestamp,
      } = podRawData[i]

      const peripheral = this._state.connectedPods[peripheralId]
      this._log(`_processRawData() peripheral processing ${peripheralId}, peripheral attributes of ${peripheral.metadata.serialNumber}: encryption ${peripheral.encryption.key} is ${peripheral?.encryption?.enabled}`)
      if (!peripheral) {
        this._log(`_processRawData() skipping... cant process raw data, peripheral not found ${peripheralId}`)
        continue;
      }

      if (!peripheral.saving && this._podSettings[peripheralId].saveNumber !== false) {
        this._log(`_processRawData() skipping... data detected past selected timeframe. peripheral ${peripheralId}`)
      }

      const { firmwareType } = peripheral.metadata

      this.incrementNotificationCount(peripheralId, serviceId, charId)

      let _data = Uint8Array.from(data)

      if (peripheral?.encryption?.enabled) {
        let metric = []
        for (let i = data.length-4; i <data.length; i+=1){
          metric.push(data[i])
        }
        peripheral.encryption.ivCounter = Uint8Array.from(metric)
        _data = bleDecrypt(peripheral.encryption, _data)
      }
      let parsedData;
      
      parsedData = parse(_data, firmwareType, this._unsanitizeNobleIDs(charId));
      const { name: dataIdentifier, storageType } = parsedData.meta;
      delete parsedData.meta;
      // const flat = flattenSample(parsedData);

      updatesPerPod[peripheralId] = updatesPerPod[peripheralId] || {
        ecg: [[],[],[]],
        hr: [[],[],[]],
        leadState: [],
        accl: [],
        gyro: [],
      }

      // Handle overwrite data that should be written to the gql cache
      if (storageType === 'cache') {
        peripheral.metadata.batteryLevel = parsedData.batteryLevel
        peripheral.metadata.temperature = parsedData.temperature // Need to research on how often this gets updated
        peripheral.metadata.recordedTemperatureTime = timestamp //(new Date()).toISOString()
        shouldEmitUpdate = true
      }

      const passiveData = this._podPassiveData[peripheralId]

      if (storageType === 'realm') {

        shouldEmitUpdate = true

        if (dataIdentifier === 'steps') {  
          passiveData.steps.push(parsedData);
          continue;
        }

        if (dataIdentifier === 'activityType') {
          passiveData.activity.push(parsedData);
          continue
        }

        if (dataIdentifier === 'temperature') {
          //SPRFW7 - Review if same applied to FW7
          var temp = parsedData
          temp.temperature = temp.temperature / 100
          if(firmwareType === Firmware400Version || firmwareType === Firmware430Version || firmwareType === Firmware435Version){
              temp.coreBodyTemperature = temp.coreBodyTemperature / 100
          } 
          passiveData.temperature.push(temp);
          continue
        }

        if (dataIdentifier === 'accelerometer') {
          passiveData.accelerometer.push(parsedData);
          updatesPerPod[peripheralId].accl.push(parsedData)
          //continue
        }

        if (dataIdentifier === 'gyrometer') {
          passiveData.gyrometer.push(parsedData);
          updatesPerPod[peripheralId].gyro.push(parsedData)
          //continue
        }

        if (dataIdentifier.startsWith('heartRate')) {
          if (dataIdentifier === 'heartRateOne') { 
            // updatesPerPod[peripheralId].hr[0] = updatesPerPod[peripheralId].hr[0].concat(flat[0])
            updatesPerPod[peripheralId].hr[0].push(parsedData)
            passiveData.HROne.push(parsedData)
          }else if (dataIdentifier === 'heartRateTwo') {
            // updatesPerPod[peripheralId].hr[1] = updatesPerPod[peripheralId].hr[1].concat(flat[0])
            updatesPerPod[peripheralId].hr[1].push(parsedData)
            passiveData.HRTwo.push(parsedData)
          }
          continue
        }

        // Process ECG Data
        // SPRFW7 - Data Quality for ECG Lead using BLE protocol FW7 
        if (dataIdentifier.startsWith('ecgList')) {
          const leadByte = getECGLeadAndQuality(parsedData.ecgState, firmwareType);
          const { quality, lead } = leadByte
          const shouldUpdate= peripheral.metadata.signalQuality !== quality
          if(shouldUpdate){
            peripheral.metadata.signalQuality = quality
          }
          //Adding the ecg lead and quality to the parsed data object
          delete parsedData.ecgState;
          var finalECG = { ...parsedData, leadState: lead, ecgQuality: quality }
          // SPRFW7 - Data Quality for ECG Lead using BLE protocol FW7 
          if(firmwareType === Firmware400Version || firmwareType === Firmware430Version || firmwareType === Firmware435Version || firmwareType === Firmware700Version || firmwareType === Firmware730Version ){
              finalECG = { ...finalECG, NLeadState: leadByte.leadN, PLeadState: leadByte.leadP}
          }
          // Check for Data Loss
          const { thereIsDataLoss, lostPacketNum } = this._checkForDataLoss(peripheralId, parsedData, dataIdentifier, firmwareType)
          
          // Adding the data to the global variable if streaming and to local variable if saving
          if (dataIdentifier === 'ecgListOne') {
            if(thereIsDataLoss){
                for(let i = 0; i < lostPacketNum; i++){
                  passiveData.ECGOne.push(this._lostSaveData[peripheralId]);

                  // updatesPerPod[peripheralId].ecg[0] = updatesPerPod[peripheralId].ecg[0].concat(this._lostSaveData[peripheralId])
                  updatesPerPod[peripheralId].ecg[0].push(this._lostSaveData[peripheralId])
                }
            }

            //Saving the ECG1 data for dumping into a file
            passiveData.ECGOne.push(finalECG);

            // updatesPerPod[peripheralId].leadState[0] = lead
            // updatesPerPod[peripheralId].ecg[0] = updatesPerPod[peripheralId].ecg[0].concat(flat)
            updatesPerPod[peripheralId].leadState[0] = lead
            updatesPerPod[peripheralId].ecg[0].push(finalECG)
          }else if (dataIdentifier === 'ecgListTwo') {
            if(thereIsDataLoss){

              for(let i = 0; i < lostPacketNum; i++){
                passiveData.ECGTwo.push(this._lostSaveData[peripheralId]);
                // updatesPerPod[peripheralId].ecg[1] = updatesPerPod[peripheralId].ecg[1].concat(this._lostSaveData[peripheralId])
                updatesPerPod[peripheralId].ecg[1].push(this._lostSaveData[peripheralId])
              }
            }

            //Saving the ECG2 data for dumping into a file
            passiveData.ECGTwo.push(finalECG);

            // updatesPerPod[peripheralId].leadState[1] = lead
            // updatesPerPod[peripheralId].ecg[1] = updatesPerPod[peripheralId].ecg[1].concat(flat)
            updatesPerPod[peripheralId].leadState[1] = lead
            updatesPerPod[peripheralId].ecg[1].push(finalECG)
          }else if (dataIdentifier === 'ecgListThree') {
            if(thereIsDataLoss){
              //Saving the ECG3 data for dumping into a file
              for(let i = 0; i < lostPacketNum; i++){
                passiveData.ECGThree.push(this._lostSaveData[peripheralId]);
                // updatesPerPod[peripheralId].ecg[2] = updatesPerPod[peripheralId].ecg[2].concat(this._lostSaveData[peripheralId])
                updatesPerPod[peripheralId].ecg[2].push(this._lostSaveData[peripheralId])
              }
            }

            //Saving the ECG3 data for dumping into a file
            passiveData.ECGThree.push(finalECG);

            // updatesPerPod[peripheralId].leadState[2] = lead
            // updatesPerPod[peripheralId].ecg[2] = updatesPerPod[peripheralId].ecg[2].concat(flat)
            updatesPerPod[peripheralId].leadState[2] = lead
            updatesPerPod[peripheralId].ecg[2].push(finalECG)
          }
        }

        if (this._podSettings[peripheralId].saveStopTime < timestamp
          && peripheral.saving) {
          this._log(`_processRawData() Global save number after +1 is : ${1+this._podSettings[peripheralId].filesSaved} / ${this._podSettings[peripheralId].saveNumber}`)
          const stopTime = this._podSettings[peripheralId].saveStopTime
          if (this._podSettings[peripheralId].saveNumber === false
            || this._podSettings[peripheralId].saveNumber > (1+this._podSettings[peripheralId].filesSaved)) {
            this._podSettings[peripheralId].saveStopTime = this._podSettings[peripheralId].saveStopTime + this._podSettings[peripheralId].saveInterval
          } else {
            this._log("_processRawData() Stopping save from BLE.js")
            // global.isSaving = false
            await this.podStop(peripheralId)
          }
          try {
            const transferData = this._podPassiveData[peripheralId]
            this.clearPassiveData(peripheralId)
            await this._saveToCSVFile(peripheralId, transferData, stopTime, timestamp)
          } catch (e) {
            this._log(`_processRawData() error`, e)
          }
        }
      }

    }

    this.emit('ble:pod:data', updatesPerPod)

    
    const _forceSaves = Object.keys(this._forceSaves).filter((id) => this._forceSaves[id])
    if (_forceSaves.length) {
      this._log(`_processRawData() _forceSaves detected`, _forceSaves)
      // const peripheralIds = [...new Set(podRawData.map(({peripheralId}) => peripheralId))]
      for (let j = 0; j < _forceSaves.length; j++) {
        const peripheralId = _forceSaves[j]
        const keys = ['ECGOne', 'ECGTwo', 'ECGThree', 'HROne', 'HRTwo', 'accelerometer', 'gyrometer','temperature', 'steps', 'activity']
        for (let i = 0; i < keys.length; i++) {
          if (this._podPassiveData[peripheralId] &&
            this._podPassiveData[peripheralId][keys[i]] &&
            this._podPassiveData[peripheralId][keys[i]].length > 0) {
            this._log(`_processRawData() _forceSaves found leftover data for peripheral ${peripheralId}`)
            const transferData = this._podPassiveData[peripheralId]
            this.clearPassiveData(peripheralId)
            const saveTime = Date.now()
            await this._saveToCSVFile(peripheralId, transferData, saveTime) //, timestamp)
            break;
          }
        }
        delete this._forceSaves[_forceSaves[j]]
      }
    }
    // if (shouldEmitUpdate) this._stateUpdated()
  }

  _nobleCharacteristicsData(peripheralId, serviceId, charId, data, isNotification) {
    if (!isNotification) {
      this._log('_nobleCharacteristicsData received a non-notification response, these responses are ignored and should be handled through async calls instead', { peripheralId, serviceId, charId, data, isNotification })
      return;
    }
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant start notifications, peripheral not found ' + peripheralId)
    // this._log(`_nobleCharacteristicsData() called for peripheral id ${peripheralId}, service id ${serviceId}, characteristic id ${charId}`)
    const { firmwareType } = peripheral.metadata

    // handle response char data and any other 
    // char that is not part of our data processing step
    if (this._sanitizeNobleIDs(CHARS[firmwareType].RESPONSE) === charId) {
      this._log(`_nobleCharacteristicsData() detected response char packet`)
      const responseData = parse(Uint8Array.from(data), firmwareType, CHARS[firmwareType].RESPONSE)

      // if we have a pending promise, we resolve that, otherwise
      // we just show results to users
      const sig = this.getCharSig(peripheralId, serviceId, charId)

      // cmd characteristic is used to create promise BUT response is received with response characteristic which is used to check for promise
      if (this._writeAsyncPromises[sig] instanceof Promise) {
        this._writeAsyncPromises[sig].resolve(responseData)
        delete this._writeAsyncPromises[sig]
        //return;
      }

      if (typeof responseData !== 'undefined') {
        const { opcode, status, data } = responseData
        const opKeys = Object.keys(CHARS[firmwareType].OP_CODES)
        const opKey = opKeys.find((k) => CHARS[firmwareType].OP_CODES[k][0] === opcode)
        const opText = opKey.toLowerCase().replaceAll('_', ' ')

        let isSuccess, msg
        switch (status) {
          case 0:
            isSuccess = true
            msg = `'${opText}' command was successful`
            break;
          case 1:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid opcode`
            break;
          case 2:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid arguments length`
            break;
          case 3:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid command`
            break;
          case 4:
            isSuccess = false
            msg = `'${opText}' command failed, reason: invalid argument`
            break;
          case 5:
            isSuccess = false
            msg = `'${opText}' command failed, reason: command error`
            break;
          default:
            throw new Error('Parsing unexpected response status', status);
        }

        this._newPodNotification(peripheralId, {
          title: `Pod #${peripheral.metadata.serialNumber}`,
          message: msg,
          type: isSuccess ? 'success' : 'error'
        })

      }

      return
    }


    // handle data packets coming in from all other chars
    try {

      if (!peripheral.saving) {
        this._log(`_nobleCharacteristicsData() skipping storing data, peripheral ${peripheral.id} is not saving atm ${peripheral.saving}`)
        return
      }
      const timestamp = Date.now()
      clearTimeout(peripheral._fwFailureTimeout)
      peripheral._fwFailureTimeout = setTimeout(() => {
        this._log(`_fwFailureTimeout() called for peripheral ${peripheral.id}, have not received data in ${Config.dataNotReceivedLimit}s`)
        const keys = ['ECGOne', 'ECGTwo', 'ECGThree', 'HROne', 'HRTwo', 'accelerometer', 'gyrometer','temperature', 'steps', 'activity']
        for (let i = 0; i < keys.length; i++) {
          if (this._podPassiveData[peripheralId][keys[i]].length > 0) {
            const transferData = this._podPassiveData[peripheralId]
            this.clearPassiveData(peripheralId)
            const saveTime = Date.now()
            this._saveToCSVFile(peripheralId, transferData, saveTime, timestamp)
            this._saveErrorToFile(peripheralId)
            break;
          }
        }
      }, Config.dataNotReceivedLimit * 60000)

      // delay data processing
      this._podRawData.push({
        peripheralId,
        serviceId,
        charId,
        data,
        timestamp,
      })

    } catch (err) {
      this._log(`_nobleCharacteristicsData() error processing characteristic`, err)
    }
  }

  _nobleDiscover(peripheral) {
    /*
    peripheral = {
      id: '<id>',
      address: '<BT address'>, // Bluetooth Address of device, or 'unknown' if not known
      addressType: '<BT address type>', // Bluetooth Address type (public, random), or 'unknown' if not known
      connectable: trueOrFalseOrUndefined, // true or false, or undefined if not known
      advertisement: {
        localName: '<name>',
        txPowerLevel: someInteger,
        serviceUuids: ['<service UUID>', ...],
        serviceSolicitationUuid: ['<service solicitation UUID>', ...],
        manufacturerData: someBuffer, // a Buffer
        serviceData: [
            {
                uuid: '<service UUID>',
                data: someBuffer // a Buffer
            },
            // ...
        ]
      },
      rssi: integerValue,
      mtu: integerValue // MTU will be null, until device is connected and hci-socket is used
    };
    */
    // if (peripheral)
    this._log(`_nobleDiscover() found peripheral id ${peripheral.id}`)

    const id = peripheral.id

    if (this._state.podList[id]) {
      this._log(`_nobleDiscover() duplicate peripheral found, id ${peripheral.id}`)
      // maybe emit an update here for our ws
      return;
    }

    peripheral.on('connect', this._noblePeripheralConnect.bind(this, id))
    peripheral.on('disconnect', this._noblePeripheralDisconnect.bind(this, id))
    peripheral.once('rssiUpdate', this._noblePeripheralRssiUpdate.bind(this, id));

    // const originalToString = peripheral.toString
    // peripheral.toString = function toStringExtended() {
    //   const r = JSON.parse(originalToString())
    //   r.metadata = this.metadata
    //   r.isSaving = this.saving
    //   // r.encryptionEnabled = peripheral?.encryption?.enabled || false
    //   return r
    // }

    peripheral.saving = false
    const self = this
    peripheral.toJSON = function toStringExtended() {
      const r = JSON.parse(this.toString())
      r.metadata = this.metadata
      r.isSaving = this.saving
      r.settings = self._podSettings[peripheral.id] || {}
      r.activeNotifications = self._currentActiveNotifications[peripheral.id] || {}
      //SPFW7 - Enable Encryption - comment out?
      r.encryptionEnabled = peripheral?.encryption?.enabled || false
      return r
    }
    //SPFW7 - Guess Pod Serial Number
    peripheral.metadata = peripheral.metadata || {}
    peripheral.metadata.serialNumber = this._guessPodSerialNumber(peripheral)

    this._state.podList[id] = peripheral

    this._stateUpdated()
  }

  async _noblePeripheralConnect(peripheralId) {
    this._log(`_noblePeripheralConnect() called, peripheral id ${peripheralId}`)
    try {
      if (typeof this._state.connectedPods[peripheralId] === 'undefined') {
        this._state.connectedPods[peripheralId] = this._state.podList[peripheralId]
        await this.podInit(peripheralId)
        this._stateUpdated()
      } else {
        this._log(`_noblePeripheralConnect() called for an id we already have, peripheral id ${peripheralId}`)
      }
    } catch (err) {
      this._log(`_noblePeripheralConnect() error`, err)
    }
  }

  _noblePeripheralDisconnect(peripheralId, reason) {
    this._log(`_noblePeripheralDisconnect() called, peripheral id ${peripheralId}${reason ? `, reason: ${NobleHCIStatuses[reason]}` : '' }`)
    if (typeof this._state.connectedPods[peripheralId] !== 'undefined') {
      delete this._state.connectedPods[peripheralId]
    }
    this._stateUpdated()
  }

  _noblePeripheralRssiUpdate(id, rssi) {
    this._log(`_noblePeripheralRssiUpdate() called, peripheral id ${id}, rssi ${rssi}`)
    this._stateUpdated()
  }

  _nobleWarning(msg) {
    if (false) {
      // handled exceptions block
    } else {
      this._log(`_nobleWarning() fired`, msg)
    }
  }

  _nobleScanStart(){
    this._log(`_nobleScanStart() called`)
    this._state.isScanning = true
    this._stateUpdated()
  }

  _nobleScanStop(){
    this._log(`_nobleScanStop() called`)
    this._state.isScanning = false
    // 
    setTimeout(() => {
      this._stateUpdated()
    }, 50)
  }

  _nobleStateChange(state) {
    this._log(`_nobleStateChange() called`)
    if (state !== this._state.noble.state) {
      this._state.noble.state = state
      this._stateUpdated()
    } else {
      // duplicate state change
    }

    // resolve 
    if (state === 'poweredOn') {
      this._state.noble.isReady.resolve()
    }

    if (state === 'poweredOff') {
      this._state.noble.isReady = new Future()
      // handle BLE receiver going off... not sure if this is needed as the server should remain online
      // at all time. Depending on the causes of failure, we can handle app resumption here
    }
  }

  _sanitizeEncryption(id) {
    return id.toUpperCase().replaceAll(',', '')
  }

  _sanitizeNobleIDs(id) {
    return id.toLowerCase().replaceAll('-', '')
  }

  _unsanitizeNobleIDs(id) {
    id = id.toUpperCase()
    id = `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`
    return id
  }

  _validateSettings(settings={}) {
    settings = Object.assign({
      saveInterval: 30000,
      saveNumber: false,
      csvFileName: 'podLog',
      taskName: 'activity',
      partId: 'unknown',
      test: false,
    }, settings)

    settings.filesSaved = 0
    settings.saveStopTime = Date.now()+ settings.saveInterval;
    return settings
  }

  _getState() {
    const state = this._state
    const podListKeys = Object.keys(state.podList)
    const podList = {}

    podListKeys.forEach((id) => {
      
      podList[id] = state.podList[id].toJSON()
      // delete podList[id].advertisement.serviceData
    })

    const connectedPodsKeys = Object.keys(state.connectedPods)
    const connectedPods = {}
    connectedPodsKeys.forEach((id) => {
      connectedPods[id] = state.connectedPods[id].toJSON()
      // expose encryption object
      // connectedPods[id].encryption = state.connectedPods[id].encryption
    })

    return {
      suspended: state.suspended,
      debug: state.debug,
      isScanning: state.isScanning,
      lastScan: state.lastScan,
      podList,
      connectedPods, // connected pod objects by ids
    }
  }

  _stateUpdated() {
    this.emit('ble:state:update', this._getState())
  }

  //Used for Live Viewing of Signals
  _getSignalOptions(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId] || this._state.podList[peripheralId]
    if (!peripheral) throw new Error('cant get signal options, peripheral not found ' + peripheralId)
    if (!peripheral.metadata || !peripheral.metadata.firmwareType) return []
    const { firmwareType } = peripheral.metadata
    switch (firmwareType) {
      case Firmware1stVersion:
      return [
          {id: 1, value: "ECG1"},
          {id: 2, value: "ECG2"},
      ]
      case Firmware2ndVersion: 
      case Firmware3rdVersion:
      case Firmware301Version:
      case Firmware321Version:
      case Firmware400Version:
      case Firmware430Version:
      case Firmware435Version:
          return [
          {id: 1, value: "ECG1"},
          {id: 2, value: "ECG2"},
          {id: 3, value: "ECG3"},
      ]
      //SPFW7
      case Firmware700Version:
          return [
          {id: 1, value: "ECG1"},
          {id: 2, value: "ECG2"},
          {id: 3, value: "ECG3"},
      ]

      case Firmware730Version:
          return [
          {id: 1, value: "ECG1"},
          {id: 2, value: "ECG2"},
          {id: 3, value: "ECG3"},
      ]
    }
  }

  _onProcessManagerUpdate(payload) {
    // check for disk space here 
    const { diskspace } = payload

    this._state.debug = payload
    const diskPercentFree = diskspace.free * 100 / diskspace.size
    if ( diskPercentFree <=  this._settings.minSpacePercent) {
      this.suspendApp(`There is less than ${this._settings.minSpacePercent}% disk space remaining.`)
    } else {
      this.unsuspendApp()
    }

    // moved debug to this._state to easier display it to client
    // this.emit('ble:debug', payload)
  }

  _onEncryptionDBUpdate() {
    this.emit('ble:encdb:update', this._encryptionDB.db())
  }

  // this function just assumes the last 6 bytes of 
  // serviceData to be the serial number
  // and use prodV1 parser to get the val
  // SPFW7 Fix Implementation
  _guessPodSerialNumber(peripheral) {
    try {
      // const serviceDataBytes = Uint8Array.from( (peripheral.advertisement.serviceData.find((sd) => sd.uuid === '180a')).data.slice(-6) )
      const serviceDataBytes = Uint8Array.from( peripheral.advertisement.serviceData[0].data.slice(-6) )
      // const serviceData = parse(serviceDataBytes, 'prodV1', CHARS['prodV1'].SERVICEDATA)
      var serviceData


      const { firmwareType } = peripheral.metadata
      // serviceData = parse(serviceDataBytes, 'prodV1', CHARS['prodV1'].SERVICEDATA)
      switch (firmwareType) {
        //SPFW7 FIX
        case Firmware700Version:
          serviceData = parse(serviceDataBytes, 'udw_FW700', CHARS['udw_FW700'].SERVICEDATA)
        case Firmware730Version:
          serviceData = parse(serviceDataBytes, 'udw_FW730', CHARS['udw_FW730'].SERVICEDATA)
        default:
          serviceData = parse(serviceDataBytes, 'prodV1', CHARS['prodV1'].SERVICEDATA)
      }

      return serviceData.serialNumber
    } catch(err) {
      this._log(`_guessPodSerialNumber() error`, err)
      return undefined
    }
  }

  _newPodNotification(peripheralId, notification) {
    if (!notification ||
      typeof notification.title === 'undefined' ||
      typeof notification.message === 'undefined' ||
      typeof notification.type === 'undefined' ) {
      this._log(`_newPodNotification() error, is being used incorrectly, a notification requires title, message and type attributes`)
      return;
    }
    this.emit('ble:pod:notification', {
      peripheralId,
      notification
    })
  }

  _wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

}




module.exports = BleManager
