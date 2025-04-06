// const Noble = require('@abandonware/noble') // ({extended: false});
// console.log('noble', Noble)
const { EventEmitter } = require('events')
const fs = require('node:fs/promises')
const path = require('path')
// const util = require('util')
// const CircularReplacer = require("../utils/CircularReplacer")

const Future = require('../../utils/Future')
const { InvalidEncryptionKeysError } = require('./utils')
const ProcessMonitor = require('./modules/ProcessMonitor')
const KeyObjectStorage = require('./modules/KeyObjectStorage')
const NobleManager = require('./modules/NobleManager')
const Config = require('./config')


const {
    parse,
    getECGLeadAndQuality,
    makeOpCode,
    determineFirmware,
    bleEncrypt,
    bleDecrypt,
    uniqueOnlyFilter,
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
} = require('./constants');

const { flattenSample } = require('./ecgHelper')



const DEFAULT_ENCRYPTION_OBJ = {
  waiting: false,
  enabled: false,
  key: null,
  digit: null,
}


class BleManager extends EventEmitter {
  constructor({ logger }) {
    super()
    
    this._log = logger.extend('ble')
    this._log(`THIS IS A TEST: in multi`)
    
    // this.noble = Noble({extended: false})

    this.noble = new NobleManager()

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

    // a little process monitoring to make sure memory doesnt leak
    this._processManager = new ProcessMonitor()
    
    this._processManager.on('update', this._onProcessManagerUpdate.bind(this))

    // encryption manager to store/retreive keys
    this._encryptionDB = new KeyObjectStorage({
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
    this.startRSSIChecker()

    await this._encryptionDB.load()
    return await this._state.noble.isReady
  }

  async suspendApp(reason) {
    this._state.suspended = {
      is: true,
      reason,
    }

    const peripheralIds = Object.keys(this._state.connectedPods) //.concat(Object.keys(this._state.podList)).filter(uniqueOnlyFilter)

    for (let i = 0; i < peripheralIds.length; i++) {
      const id = peripheralIds[id]
      await this.disconnect(id)
    }

    this._stateUpdated()
  }

  unsuspendApp() {
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
    await this._state.noble.isReady
    this._state.podList = {}

    await this.noble.startScanningAsync([CONNECTION_UUID_SET_ForScan], false)
    this._state.lastScan = Date.now()
    if (timeout > 0) {
      this._state.noble.scanTimeout = setTimeout(async () => {
        console.log('scan has timed out, stopping scan')
        await this.stopScan()
      }, timeout)
    }
  }

  async stopScan() {
    // should we reset the local list of pods before each scan?
    if (this._state.noble.scanTimeout) clearTimeout(this._state.noble.scanTimeout)
    await this.noble.stopScanningAsync()
  }

  async connect(peripheralId) {
    await this.stopScan()
    // console.log('settings', settings)
    // Data Loss variable reset
    this._clearPacketLoss(peripheralId)
    return await this._state.podList[peripheralId].connectAsync()
  }

  async disconnect(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not connected! Connect first and then call podStart.`)
    }
    const { firmwareType } = peripheral.metadata
    try {
      await this.podStop(peripheralId, true)
    } catch(err) {}
    try {
      if (typeof CHARS[firmwareType].RESPONSE !== 'undefined') {
        console.log('response characteristic detected, stopping notification')
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE, true);
      }
    } catch(err) {}
    delete this._podEncKeyPrompts[peripheralId]
    return await this._state.podList[peripheralId].disconnect()
  }

  // returns true if updated, false if value hasnt changed
  async updateRssi(peripheralId) {
    // console.log('updateRssi', peripheralId)
    if (typeof this._state.podList[peripheralId] === 'undefined' && typeof this._state.connectedPods[peripheralId] === 'undefined') {
      console.warn(`no peripheral found, skipping rssi update`, peripheralId)
      return false
    }
    const peripheral = this._state.podList[peripheralId] || this._state.connectedPods[peripheralId]
    if (!['connected', 'disconnected'].includes(peripheral.state)) {
      return false
    }
    const _prevRSSI = peripheral.rssi
    await peripheral.updateRssi()
    if (_prevRSSI == peripheral.rssi) {
      return false
    }

    return true
  }

  clearPassiveData(peripheralId) {
    this._podPassiveData[peripheralId] = {
      ECGOne:[],
      ECGTwo:[],
      ECGThree:[],
      HROne:[],
      HRTwo:[],
      accelerometer:[],
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

    try {
      // const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync(); // discoverSomeServicesAndCharacteristics
      // no need to do anything with the response here, we hold
      // a ref to noble's peripheral object, so it will be available through ._state.connectedPods
      await peripheral.discoverAllServicesAndCharacteristicsAsync();

      // Retrieve Module info
      await this.retrieveModuleInfo(peripheralId)

      // setup response char handling
      const { firmwareType, encryptionRequired } = peripheral.metadata
      if (typeof CHARS[firmwareType].RESPONSE !== 'undefined') {
        console.log('response characteristic detected, starting notification')
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE);
      } else {
        console.warn('no response characteristic found. app will not be able to verify write operations')
      }

      if (encryptionRequired) {
        // enable encryption and authenticate
        await this.enableEncryptionAndAuthenticate(peripheralId)
      }

      // Set pod time
      await this.setPodTime(peripheralId)

      // await this.getPodTime(peripheralId)

    } catch(err) {
      console.error('podInit error, disconnecting pod', err)
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
    this._podSettings[peripheralId] = settings

    if (typeof this._podPassiveData[peripheralId] === 'undefined') {
      this.clearPassiveData(peripheralId)
    }

    // console.log(`podInit ${peripheralId}`, peripheral)

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
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error(`Pod id ${peripheralId} not connected!`)
    }
    await this.stopNotifications(peripheralId, stopNotificationsPassively)

    // once notifications have stopped, we will mark pod to be forced saved for leftover data that may not fullfil our save interval
    this._forceSaves[peripheralId] = true

    peripheral.saving = false
    const ks = Object.keys(this._state.connectedPods)
    console.log('ks', ks)
    const savingPeripherals = ks.find((pid) => this._state.connectedPods[pid].saving === true)
    console.log('savingPeripherals', savingPeripherals)
    if (savingPeripherals === undefined) {
      // no more saves being done. stop processing data
      this.stopDataProcessor()
    }

    this._stateUpdated()
  }

  startDataProcessor() {
    if (this._dataProcessorActive) return;
    this._dataProcessorActive = true
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
    const checker = async () => {
      clearTimeout(this._rssiCheckTimeout)
      const peripheralIds = Object.keys(this._state.connectedPods).concat(Object.keys(this._state.podList)).filter(uniqueOnlyFilter)

      // console.log('unique peripheralIds', peripheralIds)
      let updated = false
      for (let i = 0; i < peripheralIds.length; i++) {
        const id = peripheralIds[id]
        let _u = await this.updateRssi(id)
        updated = updated || _u
      }
      if (updated) this._stateUpdated()
      this._rssiCheckTimeout = setTimeout(checker, Config.rssiUpdateInterval)
    }
    checker()
  }

  stopDataProcessor() {
    this._dataProcessorActive = false
  }

  async authenticatePod(peripheralId) {
    // in this function, any Error thrown will stop the
    // initialization of the pod. An exception is made for
    // InvalidEncryptionKeysError which will prompt the user
    // again for keys again

    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      throw new Error('cant enable encryption, peripheral not found')
    }

    const { firmwareType } = peripheral.metadata
    const { key, digit } = peripheral.encryption

    // comment the line below and complete the function definition
    return true

    // writeAsync() will create a promise which resolves once we get a
    // response from RESPONSE char
    // write() is passive and its response will be parsed and shown to users
    // with no actions taken
    try {
      const response = await this.writeAsync(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, payload)
      // check if response is valid or not
      if (!response || response.status !== 0) {
        const { opcode, status, data } = response
        // invalid response, probably should check for reason
        // then throw new InvalidEncryptionKeysError('invalid keys')
        // otherwise throw new Error() to disconnect the pod
      }
    } catch(err) {
      throw err
    }
  }

  async read(peripheralId, serviceId, charId) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    const peripheral = this._state.connectedPods[peripheralId]
    // console.log('peripheral', peripheral)
    // console.log('peripheral services', peripheral.services, serviceId)
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to read from.')
    console.log('read service', service.uuid)
    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to read from.')
    console.log('read char', characteristic.uuid)
    const data = await characteristic.readAsync()
    return peripheral?.encryption?.enabled ? bleDecrypt(peripheral.encryption, data) : data
  }

  // this is a helper function that writes to pod and waits for RESPONSE char
  // to reply
  async writeAsync(peripheralId, serviceId, charId, data, withoutResponse=false) {
    const sig = this.getCharSig(peripheralId, serviceId, charId)
    this._writeAsyncPromises[sig] = new Future()
    await this.write(peripheralId, serviceId, charId, data, withoutResponse)
    return await this._writeAsyncPromises[sig]
  }

  async write(peripheralId, serviceId, charId, data, withoutResponse=false) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    const peripheral = this._state.connectedPods[peripheralId]
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to write to.')
    console.log('write service', service.uuid)
    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to write to.')
    console.log('write char', characteristic.uuid)

    data = peripheral?.encryption?.enabled ? bleEncrypt(peripheral.encryption, data) : data
    return await characteristic.writeAsync(data, withoutResponse)
  }

  async enableEncryptionAndAuthenticate(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant enable encryption, peripheral not found')
    if (peripheral?.encryption?.enabled) return; // already enabled
    // pID = pID || this.state.deviceID

    // const key = peripheral.encryption.key
    const storedPair = await this._encryptionDB.get(peripheral.metadata.serialNumber)
    peripheral.encryption = peripheral.encryption || DEFAULT_ENCRYPTION_OBJ
    if (storedPair && storedPair.key && storedPair.digit) {
      console.log(`enableEncryptionAndAuthenticate found a key for pod ${peripheralId}`, { key, digit })
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

    console.log(`enableEncryptionAndAuthenticate prompting user for pod ${peripheralId}`)
    try {
      await this.retrieveEncryptionKeyFromUser(peripheralId)
      console.log('enableEncryptionAndAuthenticate key has been received, encryption is now enabled')
      // return true;
    } catch (err) {
      console.error('-- enableEncryptionAndAuthenticate', err)
      throw new Error('failed to retrieve encryption key from user')
    }

    // once we have the key, we attemp to authenticate
    try {
      await this.authenticatePod(peripheralId)
      console.log('enableEncryptionAndAuthenticate auth has been successful')
      this._stateUpdated()
      // return true;
    } catch (err) {
      if (err instanceof InvalidEncryptionKeysError) {
        // reset encryption object and replay the function
        // to get fresh key pair
        peripheral.encryption = DEFAULT_ENCRYPTION_OBJ
        return await this.enableEncryptionAndAuthenticate(peripheralId)
      } else {
        console.error('-- enableEncryptionAndAuthenticate', err)
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
    moduleInfo = await this.read(peripheralId, SERVICES.SKIIN, InformationUUID);

    
    if(!moduleInfo) {
      throw new Error('could not get module info')
    }

    // Determining the firmware type based on the moduleInfo
    // The module Info is being parsed based on an early version of the firmware as it has not changed
    // In case this changes in the future, the moduleInfo parse should be done independantly here.
    // console.log('moduleInfo raw', moduleInfo)
    const moduleInfoRaw = moduleInfo
    moduleInfo = parse(moduleInfo, "prodV1", InformationUUID);    
    console.log('moduleInfo parsed', moduleInfo)
    // Calculate firmware version
    const firmwareVersion = `${moduleInfo.firmwareMajor}.${moduleInfo.firmwareMinor}.${moduleInfo.firmwarePatch}`;
    const firmwareType = determineFirmware(moduleInfo.firmwareMajor,moduleInfo.firmwareMinor,moduleInfo.firmwarePatch)
    if(firmwareType === "non-compatibale"){
      throw new Error('The firmware version is not compatible')
    }

    console.log('firmwareType determined', firmwareType)

    moduleInfo = parse(moduleInfoRaw, firmwareType, InformationUUID);
    console.log('reparsed module info with correct fwType', moduleInfo)

    let serviceData, serviceDataBytes
    try {
      // serviceDataBytes = Uint8Array.from( (peripheral.advertisement.serviceData.find((sd) => sd.uuid === '180a')).data )
      serviceDataBytes = Uint8Array.from( peripheral.advertisement.serviceData[0].data )
      // console.log('serviceDataBytes', serviceDataBytes)
      serviceData = parse(serviceDataBytes, firmwareType, CHARS[firmwareType].SERVICEDATA)
    } catch(err) {
        console.error(err)
    }
    // console.log('++ serviceData parsed', { serviceData, serviceDataBytes })
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

    this._stateUpdated()

    console.log('retrieveModuleInfo completed')

    return {
        firmwareType
    }
  }

  retrieveEncryptionKeyFromUser(peripheralId) {
    if (this._podEncKeyPrompts[peripheralId] && this._podEncKeyPrompts[peripheralId].resolve) {
      console.warn('detected a pending encryption key promise for pod', peripheralId)
      // since encryption keys etc will be prompted before data recording happens
      // and right after connecting to a pod, the only time this should 
      // happen is when 2+ different "clients" try to connect to a pod at the same time
      throw new Error('duplicate enc request promise, this is a race condition so we will reject this call. ')
    }
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant prompt user for encryption, peripheral not found')

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

  async setEncryptionKey(peripheralId, { key, digit }) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) {
      reject('setEncryptionKey: peripheral not found', peripheralId)
      throw new Error('peripheral doesnt appear to be connected.')
    }

    let podPromise = this._podEncKeyPrompts[peripheralId]
    if (!podPromise || !podPromise.resolve || !podPromise.reject) {
      console.log('no pending encryption key promise found for pod, will treat this as user updating key', peripheralId)
      const nofn = () => undefined
      podPromise = podPromise || {}
      podPromise.resolve = podPromise.resolve || nofn
      podPromise.reject = podPromise.reject || nofn
    }

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
    await this._encryptionDB.set({
      key,
      digit,
      peripheralId,
      serialNumber: peripheral.metadata.serialNumber,
    })
    peripheral.metadata.encryptionEnabled = true
    peripheral.encryption = peripheral.encryption || DEFAULT_ENCRYPTION_OBJ
    peripheral.encryption.enabled = true
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

  async startNotification(peripheralId, serviceId, charId) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    if (this.notificationCurrentlyActive(peripheralId, serviceId, charId)) {
      throw new Error(`There is currently an active notification with the same signature. Aborting as this can cause a memory leak, id: ${peripheralId}, serviceId: ${serviceId}, charId: ${charId}`)
    }
    const peripheral = this._state.connectedPods[peripheralId]
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to subscribe to.')
    console.log('notification service', service.uuid)
    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to read from.')
    console.log('notification char', characteristic.uuid)
    this.notificationCurrentlyActive(peripheralId, serviceId, charId, true, true)
    characteristic._readerfn = this._nobleCharacteristicsData.bind(this, peripheralId, serviceId, charId)
    characteristic.on('data', characteristic._readerfn)
    // characteristic.on('data', (data, isNotification) => this._nobleCharacteristicsData(peripheralId, serviceId, charId, data, isNotification))
    return await characteristic.subscribeAsync()
  }

  async stopNotification(peripheralId, serviceId, charId, passive=false) {
    serviceId = this._sanitizeNobleIDs(serviceId)
    charId = this._sanitizeNobleIDs(charId)
    if (!this.notificationCurrentlyActive(peripheralId, serviceId, charId)) {
      if (!passive) {
        throw new Error(`There is currently NO active notification with the same signature. Aborting as this can cause a memory leak, id: ${peripheralId}, serviceId: ${serviceId}, charId: ${charId}`)
      }
      console.warn(`There is currently NO active notification with the same signature. Passive flag detected, not throwing an error, id: ${peripheralId}, serviceId: ${serviceId}, charId: ${charId}`, this._currentActiveNotifications[peripheralId])
      return false
    }
    const peripheral = this._state.connectedPods[peripheralId]
    const service = peripheral.services.find((s) => s.uuid === serviceId)
    if (!service) throw new Error('No service found to unsubscribe from.')
    console.log('notification service', service.uuid)
    const characteristic = service.characteristics.find(char => char.uuid === charId)
    if (!characteristic) throw new Error('No characteristic found to unsub from.')
    console.log('notification char', characteristic.uuid)
    this.notificationCurrentlyActive(peripheralId, serviceId, charId, true, false)
    // characteristic._readerfn = this._nobleCharacteristicsData.bind(this, peripheralId, serviceId, charId)
    // characteristic.on('data', characteristic._readerfn)
    characteristic.removeListener('data', characteristic._readerfn)
    return await characteristic.unsubscribeAsync()
  }

  async stopNotifications(peripheralId, passive=false) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant disable start notifications, peripheral not found ' + peripheralId)

    const { firmwareType } = peripheral.metadata

    try {
      // stop information service
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].INFORMATION, passive);

      // Start heart rate service -- Version 3 Firmware doesn't support Hear rate
      console.log("Checking if there is heart rate")
      if (CHARS[firmwareType].HEART_RATE_ONE){
        console.log("There IS heart rate")
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_ONE, passive);
        await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_TWO, passive);

      }
      
      // Start ECG service
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_ONE, passive);
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_TWO, passive);
      if (CHARS[firmwareType].ECG_THREE){
          console.log("There is ECG three")

          await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_THREE, passive);
      }
      // Reset step counter on pod
      await this.resetStepCounter(peripheralId);

      // Start Activity Service
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].STEPS, passive);
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACTIVITY_TYPE, passive);

      // Start temperature service - test feature added in some FW versions
      // console.log("Checking if there is temperature")
      if (CHARS[firmwareType].TEMPERATURE){
          // console.log("There IS temperature")
          await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].TEMPERATURE, passive);
      }

      // Start accelerometer service
      await this.stopNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACCELEROMETER, passive);

    } catch (err) {
      console.error("Failed to stop notifications....", err)
      // await this.disconnect(peripheralId)
    }

  }

  async startNotifications(peripheralId){
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant enable start notifications, peripheral not found ' + peripheralId)
    const { firmwareType } = peripheral.metadata


    // TODO: Set time on device using correct op code
    try {
      // Start information service
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].INFORMATION);
      // Set Heart Rate sample rate to 1
      console.log("Checking if there is heart rate threshold command")
      if(CHARS[firmwareType].OP_CODES.HEART_RATE_THRESHOLD){
          console.log("There is heart rate threshold")
          const heartRateThresholdCommand = makeOpCode(CHARS[firmwareType].OP_CODES.HEART_RATE_THRESHOLD, [0x01]);
          await this.write(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, heartRateThresholdCommand);
      }

      // Start heart rate service -- Version 3 Firmware doesn't support Hear rate
      console.log("Checking if there is heart rate")
      if (CHARS[firmwareType].HEART_RATE_ONE){
        console.log("There IS heart rate")
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_ONE);
        await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].HEART_RATE_TWO);
      }
      
      // Start ECG service
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_ONE);
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_TWO);
      if (CHARS[firmwareType].ECG_THREE){
          console.log("There is ECG three")

          await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ECG_THREE);
      }
      // Reset step counter on pod
      await this.resetStepCounter(peripheralId);

      // Set step notification frequency to occur every step
      const stepThresholdCommand = makeOpCode(CHARS[firmwareType].OP_CODES.STEP_THRESHOLD, [0x01]);

      // console.log('stepThresholdCommand', stepThresholdCommand)

      await this.write(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Uint8Array.from(stepThresholdCommand));

      // Start Activity Service
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].STEPS);
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACTIVITY_TYPE);

      // Start temperature service - test feature added in some FW versions
      // console.log("Checking if there is temperature")
      if (CHARS[firmwareType].TEMPERATURE){
          // console.log("There IS temperature")
          await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].TEMPERATURE);
      }

      // Start accelerometer service
      await this.startNotification(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].ACCELEROMETER);

      // update GUI with data? 
      // this.hrInterval = setInterval(() => {
      //     setSavedObjectData("deviceData",{ currentHeartRate: this.activeHR } )
      // }, 1000);

      // const dataLossRateUpdateUnit = Config.dataLossRateUnit / Config.dataLossRateUpdateRatio
      // this.LossRateInterval = setInterval(() => {
      //     setSavedObjectData("deviceData", {lossRate: this.packetLossRate} )
      // }, dataLossRateUpdateUnit);

    } catch (err) {    
      console.error("\n\n\n\nFailed to initialize the device....\n\n\n", err)
      // this.setState({ connected: false, deviceID:'', firmwareVersion: ''});
      // setSavedObjectData("deviceData", { deviceConnected: false });
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
    const deviceTimestamp = deviceIDStripped + myYear +"-" + myMonth +"-"+ myDay + "at" + myHours + "H" + myMinutes + "M" + mySeconds

    const fileName = `${prefix}-${deviceTimestamp}.csv`
    const folder = path.join(Config.storagePath, `${deviceIDStripped}/${myYear}-${myMonth}/${myDay}/`)
    const pathToWrite = folder + fileName

    if (shouldCreateFolder) {
      try {
        await fs.mkdir(folder, { recursive: true })
      } catch(err) {
        if (!['EEXIST'].includes(err.code)) {
          // err not related to folder already existing
          console.error(err)
        }
      }
    }

    return pathToWrite
  }

  async resetStepCounter(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant reset pod step counter, peripheral not found ' + peripheralId)

    const { firmwareType } = peripheral.metadata;
    try {
      await this.write(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, CHARS[firmwareType].OP_CODES.RESET_STEPS);
      peripheral.metadata.lastStepCounter = 0;
    } catch (err) {
      // TODO: Handle step reset failure by tracking roll-over
    }
  }

  async getPodTime(peripheralId) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant get pod time, peripheral not found ' + peripheralId)

    const { firmwareType } = peripheral.metadata;

    const readTimeCommand = makeOpCode(CHARS[firmwareType].OP_CODES.READ_REALTIME_CLOCK, []);
    let podTime = await this.write(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, Uint8Array.from(readTimeCommand));

    console.log('podTime', podTime)

    // podTime = await this.read(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].RESPONSE)

    // let _data = Uint8Array.from(podTime)
    // console.log('++ podTime', {_data, podTime})

    // return podTime

  }

  async setPodTime(peripheralId, currentTime=undefined) {
    const peripheral = this._state.connectedPods[peripheralId]
    if (!peripheral) throw new Error('cant set pod time, peripheral not found ' + peripheralId)

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

    const setRelTimeClockCommand = Uint8Array.from(makeOpCode(CHARS[firmwareType].OP_CODES.SET_REALTIME_CLOCK, currTimeArray));
    return await this.write(peripheralId, SERVICES.SKIIN, CHARS[firmwareType].COMMAND, setRelTimeClockCommand);
  }

  async resetBleDevice() {
    return await this.noble.resetAsync()
  }

  async _saveErrorToFile(peripheralId){
    try {
      const pathToWrite = await this.getPodSavePath(peripheralId, 'ERR')
      await fs.writeFile(pathToWrite, `Haven't received data from FW for ${Config.dataNotReceivedLimit} minutes`)
      console.log(`wrote file ${pathToWrite}`);
    } catch(err) {
      console.error(err)
    }
  }

  async _saveToCSVFile(peripheralId, data, stopTime, timestamp) {

    // Creating the meta header
    const peripheral = this._state.connectedPods[peripheralId] || this._state.podList[peripheralId]
    if (!peripheral) throw new Error('cant saveToCSVFile, peripheral not found ' + peripheralId)

    if (this._podSettings[peripheralId].test) {
      console.log('Test mode detected. Will not save file.')
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
    const csvString = `${metaString}${ECGOneString}${ECGTwoString}${ECGThreeString}${HROneString}${HRStwoString}${AccelerometerString}${StepsString}${ActivityString}${TemperatureString}`
    const pathToWrite = await this.getPodSavePath(peripheralId, false, true, stopTime)

    console.log('pathToWrite', pathToWrite);
    try {
      await fs.writeFile(pathToWrite, csvString)
      console.log(`wrote file ${pathToWrite}`);
      console.log("The files saved before this one : ", this._podSettings[peripheralId].filesSaved)
      this._podSettings[peripheralId].filesSaved += 1
      console.log("The files saved after this one : ", this._podSettings[peripheralId].filesSaved)
      // Data Loss variable reset
      this._clearPacketLoss(peripheralId, 'total')
      this._stateUpdated()
    } catch(err) {
      console.error(err)
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
    // console.log("In the check for loss function.....")
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
        // console.log("No Loss")
        return { thereIsDataLoss: false, lostPacketNum: 0 }
    }
    if ( data.timestamp === lastTimestamp ){
        // Duplicate
        console.log("Duplicate")
        return { thereIsDataLoss: false, lostPacketNum: 1 }
    }
    const lostPacketNum = Math.floor(timeDiff / interval)
    const mod = timeDiff % interval
    if (lostPacketNum > 0) {
      if (mod < 3 ) {
          // Missing lostPacketNum -1 packets
          console.log("Missing packets deducted ", lostPacketNum - 1)
          calculateLossRate(lostPacketNum - 1)
          return { thereIsDataLoss: true, lostPacketNum: lostPacketNum - 1 }
      } else if (mod > interval - 3) {
          // Missing lostPacketNum packets
          console.log("Missing packets", lostPacketNum)
          calculateLossRate(lostPacketNum)
          return { thereIsDataLoss: true, lostPacketNum }
      } else {
          // wrong timestamp
          console.log("Wrong timestamp")
          return { thereIsDataLoss: false, lostPacketNum: 2 }
      }
    } else {
      // wrong timestamp
      console.log("Wrong timestamp ** ")
      return { thereIsDataLoss: false, lostPacketNum: 2 }
    }
  }

  async _processRawData() {
    const podRawData = this._podRawData
    this._podRawData = []

    console.log(`_processRawData processing ${podRawData.length} events`)

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
      if (!peripheral) {
        console.warn('skipping... cant process raw data, peripheral not found ' + peripheralId)
        continue;
      }
      const { firmwareType } = peripheral.metadata

      // console.log('_processRawData incrementNotificationCount')
      this.incrementNotificationCount(peripheralId, serviceId, charId)

      let _data = Uint8Array.from(data)

      // console.log('_processRawData', { _data, data })

      if (peripheral?.encryption?.enabled) {
        _data = bleDecrypt(peripheral.encryption, _data)
      }
      let parsedData;
      
      parsedData = parse(_data, firmwareType, this._unsanitizeNobleIDs(charId));
      // console.log('parsedData', parsedData)
      const { name: dataIdentifier, storageType } = parsedData.meta;
      delete parsedData.meta;

      // console.log('_processRawData parsedData')
       
      // const flat = flattenSample(parsedData);

      // console.log('_processRawData flattenSample')
      updatesPerPod[peripheralId] = updatesPerPod[peripheralId] || {
        ecg: [[],[],[]],
        hr: [[],[],[]],
        leadState: [],
      }

      // Handle overwrite data that should be written to the gql cache
      if (storageType === 'cache') {
        peripheral.metadata.batteryLevel = parsedData.batteryLevel
        peripheral.metadata.temperature = parsedData.temperature // Need to research on how often this gets updated
        peripheral.metadata.recordedTemperatureTime = timestamp //(new Date()).toISOString()
        shouldEmitUpdate = true
      }

      const passiveData = this._podPassiveData[peripheralId]
      // console.log('passiveData', passiveData)
      if (storageType === 'realm') {
        // console.log('_processRawData storageType', storageType)
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
          var temp = parsedData
          // console.log("The temperature characteristic before division is : ", temp)
          temp.temperature = temp.temperature / 100
          if(firmwareType === Firmware400Version || firmwareType === Firmware430Version || firmwareType === Firmware435Version){
              temp.coreBodyTemperature = temp.coreBodyTemperature / 100
          } 
          // console.log("The temperature after division is : ", temp.temperature)
          passiveData.temperature.push(temp);
          continue
        }

        if (dataIdentifier === 'accelerometer') {
          passiveData.accelerometer.push(parsedData);
          continue
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
          if(firmwareType === Firmware400Version || firmwareType === Firmware430Version || firmwareType === Firmware435Version){
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

        if (this._podSettings[peripheralId].saveStopTime < timestamp) {
          console.log("Global save number after -1 is : ", this._podSettings[peripheralId].saveNumber)
          const stopTime = this._podSettings[peripheralId].saveStopTime
          if (this._podSettings[peripheralId].saveNumber === false || this._podSettings[peripheralId].saveNumber > this._podSettings[peripheralId].filesSaved) {
            this._podSettings[peripheralId].saveStopTime = this._podSettings[peripheralId].saveStopTime + this._podSettings[peripheralId].saveInterval
          } else {
            console.log("Stopping save from BLE.js")
            // global.isSaving = false
            await this.podStop(peripheralId)
          }
          try {
            const transferData = this._podPassiveData[peripheralId]
            this.clearPassiveData(peripheralId)
            await this._saveToCSVFile(peripheralId, transferData, stopTime, timestamp)
          } catch (e) {
            console.log(e);
          }
        }
      }

    }

    this.emit('ble:pod:data', updatesPerPod)

    
    const _forceSaves = Object.keys(this._forceSaves).filter((id) => this._forceSaves[id])
    // console.log('_processRawData _forceSave', _forceSaves)
    if (_forceSaves.length) {
      // const peripheralIds = [...new Set(podRawData.map(({peripheralId}) => peripheralId))]
      for (let j = 0; j < _forceSaves.length; j++) {
        const peripheralId = _forceSaves[j]
        const keys = ['ECGOne', 'ECGTwo', 'ECGThree', 'HROne', 'HRTwo', 'accelerometer', 'temperature', 'steps', 'activity']
        for (let i = 0; i < keys.length; i++) {
          if (this._podPassiveData[peripheralId] &&
            this._podPassiveData[peripheralId][keys[i]] &&
            this._podPassiveData[peripheralId][keys[i]].length > 0) {
            const transferData = this._podPassiveData[peripheralId]
            this.clearPassiveData(peripheralId)
            const saveTime = Date.now()
            this._saveToCSVFile(peripheralId, transferData, saveTime) //, timestamp)
            break;
          }
        }
        delete this._forceSaves[_forceSaves[j]]
      }
    }
    // console.log('_processRawData shouldEmitUpdate', shouldEmitUpdate)
    // if (shouldEmitUpdate) this._stateUpdated()
  }

  _nobleCharacteristicsData(peripheralId, serviceId, charId, data, isNotification) {
    // console.log('_nobleCharacteristicsData', {
    //   peripheralId,
    //   serviceId, charId, data, isNotification
    // })
    if (!isNotification) {
      console.warn('_nobleCharacteristicsData received a non-notification response, these responses are ignored and should be handled through async calls instead', { peripheralId, serviceId, charId, data, isNotification })
      return;
    }

    const peripheral = this._state.connectedPods[peripheralId]
      if (!peripheral) throw new Error('cant start notifications, peripheral not found ' + peripheralId)

    const { firmwareType } = peripheral.metadata

    // handle response char data and any other 
    // char that is not part of our data processing step
    if (this._sanitizeNobleIDs(CHARS[firmwareType].RESPONSE) === charId) {
      console.log('- detected response char packet', Uint8Array.from(data))
      const responseData = parse(Uint8Array.from(data), firmwareType, CHARS[firmwareType].RESPONSE)
      // console.log('responseData', responseData)

      // if we have a pending promise, we resolve that, otherwise
      // we just show results to users
      const sig = this.getCharSig(peripheralId, serviceId, charId)
      if (this._writeAsyncPromises[sig] instanceof Future) {
        this._writeAsyncPromises[sig].resolve(responseData)
        delete this._writeAsyncPromises[sig]
        return;
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
      // console.log('_nobleCharacteristicsData called, params', { peripheralId, serviceId, charId}, data)

      const timestamp = Date.now()
      clearTimeout(peripheral._fwFailureTimeout)
      peripheral._fwFailureTimeout = setTimeout(() => {
        const keys = ['ECGOne', 'ECGTwo', 'ECGThree', 'HROne', 'HRTwo', 'accelerometer', 'temperature', 'steps', 'activity']
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
        console.warn('Error processing characteristic', err);
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
    console.log('_nobleDiscover id', peripheral.id)

    const id = peripheral.id

    if (this._state.podList[id]) {
      console.warn('-- duplicate id found')
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
    //   console.log('toString', r)
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
      // r.encryptionEnabled = peripheral?.encryption?.enabled || false
      return r
    }

    peripheral.metadata = peripheral.metadata || {}
    peripheral.metadata.serialNumber = this._guessPodSerialNumber(peripheral)

    this._state.podList[id] = peripheral

    this._stateUpdated()
  }

  async _noblePeripheralConnect(peripheralId) {
    console.log('_noblePeripheralConnect', peripheralId)
    try {
      if (typeof this._state.connectedPods[peripheralId] === 'undefined') {
        this._state.connectedPods[peripheralId] = this._state.podList[peripheralId]
        await this.podInit(peripheralId)
        this._stateUpdated()
      } else {
        console.warn('_noblePeripheralConnect called for an ID we already have', peripheralId)
      }
    } catch (err) {
      console.error('-- _noblePeripheralConnect err ', err)
    }
  }

  _noblePeripheralDisconnect(peripheralId) {
    console.log('_noblePeripheralDisconnect', peripheralId)
    if (typeof this._state.connectedPods[peripheralId] !== 'undefined') {
      delete this._state.connectedPods[peripheralId]
    }
    this._stateUpdated()
  }

  _noblePeripheralRssiUpdate(id, rssi) {
    this._stateUpdated()
    console.log('_noblePeripheralRssiUpdate', { id, rssi })
  }

  _nobleWarning(msg) {
    console.warn('_nobleWarning fired: ', msg)
  }

  _nobleScanStart(){
    console.log('_nobleScanStart')
    this._state.isScanning = true
    this._stateUpdated()
  }

  _nobleScanStop(ar){
    console.log('_nobleScanStop', ar)
    this._state.isScanning = false
    // 
    setTimeout(() => {
      try {
        this._stateUpdated()
      } catch(err) {
        console.warn('culprit', err)
      }
    }, 50)
  }

  _nobleStateChange(state) {
    if (state !== this._state.noble.state) {
      this._state.noble.state = state
      console.log('+ state change', state)
      this._stateUpdated()
    } else {
      console.log('- duplicate state change', state)
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
      // console.log('state.connectedPods[id]', [state.connectedPods[id].toJSON(), id])
      connectedPods[id] = state.connectedPods[id].toJSON()
      // expose encryption object
      // connectedPods[id].encryption = state.connectedPods[id].encryption
      // console.log('state.connectedPods[id]', state.connectedPods[id])
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
  _guessPodSerialNumber(peripheral) {
    // console.log('peripheral', peripheral)
    try {
      // const serviceDataBytes = Uint8Array.from( (peripheral.advertisement.serviceData.find((sd) => sd.uuid === '180a')).data.slice(-6) )
      const serviceDataBytes = Uint8Array.from( peripheral.advertisement.serviceData[0].data.slice(-6) )
      const serviceData = parse(serviceDataBytes, 'prodV1', CHARS['prodV1'].SERVICEDATA)
      // console.log('_guessPodSerialNumber', serviceData)
      return serviceData.serialNumber
    } catch(err) {
      console.warn('_guessPodSerialNumber', err)
      return undefined
    }
  }

  _newPodNotification(peripheralId, notification) {
    if (!notification ||
      typeof notification.title === 'undefined' ||
      typeof notification.message === 'undefined' ||
      typeof notification.type === 'undefined' ) {
      console.error('_newPodNotification is being used incorrectly, a notification requires title, message and type attributes')
      return;
    }
    this.emit('ble:pod:notification', {
      peripheralId,
      notification
    })
  }

}




module.exports = BleManager
