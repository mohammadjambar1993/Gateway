/*
  this is a custom bindings resolution, it uses our implementation of hci binding 
  that includes small adjustments and fixes to the original noble
*/

// const bindings = require('@abandonware/noble/lib/resolve-bindings')
const os = require('os');

function getWindowsBindings () {
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
    return require('./HCISocketBindings');
  } else {
    return require('@abandonware/noble/lib/win/bindings');
  }
}

module.exports = function (options) {
  const platform = os.platform();

  if (process.env.NOBLE_WEBSOCKET) {
    return new (require('@abandonware/noble/lib/websocket/bindings'))(options);
  } else if (process.env.NOBLE_DISTRIBUTED) {
    return new (require('@abandonware/noble/lib/distributed/bindings'))(options);
  } else if (
    platform === 'linux' ||
    platform === 'freebsd' ||
    (process.env.BLUETOOTH_HCI_SOCKET_USB_VID &&
      process.env.BLUETOOTH_HCI_SOCKET_USB_PID)
  ) {
    return new (require('./HCISocketBindings'))(options);
  } else if (platform === 'darwin') {
    return new (require('@abandonware/noble/lib/mac/bindings'))(options);
  } else if (platform === 'win32') {
    return new (getWindowsBindings())(options);
  } else {
    throw new Error('Unsupported platform');
  }
};