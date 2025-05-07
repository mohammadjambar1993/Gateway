const { EventEmitter } = require('events')
const os = require('os');
// const HCIBindings = require('@abandonware/noble/lib/hci-socket/bindings');
// const { HCIBindings, getDeviceList } = 


const Noble = require('@abandonware/noble/lib/noble');

/*
const params = {
  deviceId: 0,
  userChannel: false,
  extended: false
};
const noble = new Noble(new HCIBindings(params));
*/


class NobleManager extends EventEmitter {
  constructor() {
    super()

    this._bindingClass = null
    this._multi = false
    this._getDeviceListRef = () => ({ native: [], usb: [] })
    this._determineEnv()

    this._instances = {}
    this._metadata = {}
    this._currentDeviceId = undefined

    this._maxConnections = 7

    /* device {
        devId: 0,
        devUp: false,
        idVendor: null,
        idProduct: null,
        busNumber: null,
        deviceAddress: null
      }
    */

    if (this._multi) {
      const { native, usb } = this._getDeviceListRef()
      native.forEach(({ devId }) => {
        this._createInstance({
          isNative: true,
          deviceId: devId,
        })
      })

      usb.forEach(({ devId }) => {
        this._createInstance({
          isNative: false,
          deviceId: devId,
        })
      })
    } else {
      this._createInstance({
        isNative: true,
      })
    }

    if (Object.keys(this._instances).length === 0) throw new Error('found no ble receiver')

    this.setCurrentDevice()
  }

  _determineEnv() {
    const platform = os.platform();
    if (
      platform === 'linux' ||
      platform === 'freebsd' ||
      (process.env.BLUETOOTH_HCI_SOCKET_USB_VID &&
        process.env.BLUETOOTH_HCI_SOCKET_USB_PID)
    ) {
      this._multi = true
      const _b = require('./noble/HCIBindings')
      this._bindingClass = _b.HCIBindings
      this._getDeviceListRef = _b.getDeviceList
    } else if (platform === 'darwin') {
      this._bindingClass = require('@abandonware/noble/lib/mac/bindings');
    } else if (platform === 'win32') {
      const ver = os
      .release()
      .split('.')
      .map((str) => parseInt(str, 10));
      if (
        !(
          ver[0] > 10 ||
          (ver[0] === 10 && ver[1] > 0) ||
          (ver[0] === 10 && ver[1] === 0 && ver[2] >= 15063)
        )
      ) {
        const _b = require('./noble/HCIBindings')
        this._bindingClass = _b.HCIBindings
        this._getDeviceListRef = _b.getDeviceList
      } else {
        this._bindingClass = require('@abandonware/noble/lib/win/bindings');
      }
    } else {
      throw new Error('Unsupported platform');
    }
  }

  setCurrentDevice(deviceId) {
    deviceId = deviceId || this._currentDeviceId
    const ids = Object.keys(this._instances)
    if (typeof deviceId === 'undefined') {
      deviceId = ids[0]
    }

    if (this._maxConnections >= this._metadata[deviceId].activeConnections) {
      deviceId = ids.find((id) => {
        return this._metadata[id].activeConnections < this._maxConnections
      })
    }

    this._currentDeviceId = deviceId
  }

  startScanningAsync(...args) {
    return this._instances[this._currentDeviceId].startScanningAsync(...args)
  }

  stopScanningAsync() {
    return this._instances[this._currentDeviceId].stopScanningAsync()
  }

  resetAsync() {
    return this._instances[this._currentDeviceId].resetAsync()
  }

  _createInstance({ isNative=false, deviceId } = {}) {

    if (typeof this._instances[deviceId] !== 'undefined') throw new Error('found duplicate device id for ble receiver')

    console.log('NobleManager._createInstance called', {isNative, deviceId})
    const hciBindings = new this._bindingClass({ isNative, deviceId, extended: false })
    const nobleInstance = new Noble(hciBindings);

    nobleInstance._deviceId = deviceId
    // setup event listeners
    nobleInstance.on('stateChange', this._nobleStateChange.bind(this, deviceId));
    nobleInstance.on('scanStart', this._nobleScanStart.bind(this, deviceId))
    nobleInstance.on('scanStop', this._nobleScanStop.bind(this, deviceId))
    nobleInstance.on('discover', this._nobleDiscover.bind(this, deviceId))
    nobleInstance.on('warning', this._nobleWarning.bind(this, deviceId))

    this._metadata[deviceId] = {
      activeConnections: 0,
    }
    this._instances[deviceId] = nobleInstance

  }

  _nobleDiscover(deviceId, peripheral) {
    peripheral._deviceId = deviceId

    peripheral.on('connect', () => {
      this._metadata[deviceId].activeConnections += 1
      this.setCurrentDevice()
    })
    peripheral.on('disconnect', () => {
      this._metadata[deviceId].activeConnections -= 1
      if (this._metadata[deviceId].activeConnections < 0) {
        console.warn('NobleManager activeConnections count is off. This is a bug!')
      }
    })
    
    this.emit('discover', peripheral)
  }


  _nobleWarning(deviceId, ...args) {
    this.emit('warning', ...args)
  }

  _nobleScanStop(deviceId, ...ar){
    this.emit('scanStop', ...ar)
  }

  _nobleScanStart(deviceId){
    this.emit('scanStart')
  }

  _nobleStateChange(state) {
    this.emit('stateChange', state)
  }
}


// extend prototype
function inherits(target, source) {
  for (var k in source.prototype) {
    target.prototype[k] = source.prototype[k];
  }
}


module.exports = NobleManager
