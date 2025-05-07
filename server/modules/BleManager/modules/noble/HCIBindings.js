/*
  this is used only in Multi version of noble, look into ../NobleManager for more info
*/

const NobleBindings = require('@abandonware/noble/lib/hci-socket/bindings');
const OrigHci = require('@abandonware/noble/lib/hci-socket/hci');
// const BluetoothHciSocket = require('@abandonware/bluetooth-hci-socket');
const NativeBluetoothHciSocket = require('@abandonware/bluetooth-hci-socket/lib/native');
const UsbBluetoothHciSocket = require('@abandonware/bluetooth-hci-socket/lib/usb');

class Hci extends OrigHci {
  constructor(options={}) {
    super(options)

    if (options.isNative) {
      this._socket = new NativeBluetoothHciSocket()
    } else {
      this._socket = new UsbBluetoothHciSocket();
    }
  }
}


class HCIBindings extends NobleBindings {
  constructor(options) {
    super(options)
    this._hci = new Hci(options);
  }
}

const _hciBindings = new HCIBindings({ isNative: true })
const _USBhciBindings = new HCIBindings({ isNative: false })

const getDeviceList = () => ({
  native: _hciBindings._hci._socket.getDeviceList(),
  usb: _USBhciBindings._hci._socket.getDeviceList(),
})


module.exports = {
  HCIBindings,
  getDeviceList,
}