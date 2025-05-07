// use of webusb is to modernize usb protocol communication even though our devices are mostly legacy usb devices
const { usb } = require('usb');
const drivelist = require('drivelist');
const fs = require('node:fs/promises')
const path = require('path')
const { EventEmitter } = require('events')


module.exports = class FileSystem extends EventEmitter {
  constructor({
    localSavePath,
  }) {
    super()
    this._type = 'local'
    this._localSavePath = localSavePath
    this._savePath = '.' // default to current working directory
  }

  async init() {
    console.log('FileSystem:init')
    usb.on('attach', (device) => {
      // nothing to do here, its possible to dynamically switching between local and usb save paths
      this.emit('usb-attach', device)
    });
    usb.on('detach', async (device) => {
      // check if we are using usb drive
      if (this._type === 'usb') {
        await this._setupSavePath()
        // check if we are still using usb drive
        if (this._type === 'local') {
          this.emit('usb-detach', device)
        }
      }
    });
    // const devices = getDeviceList();
    await this._setupSavePath()
  }

  async writeFile(filePath, data) {
    const pathToWrite = `${this._savePath}/${filePath}`
    return await fs.writeFile(pathToWrite, data)
  }

  async mkdir(folder) {
    const pathToCreate = path.join(`${this._savePath}/${folder}`)
    return await fs.mkdir(pathToCreate, { recursive: true })
  }

  getSavePath() {
    return this._savePath
  }

  async _setupSavePath() {
    const usbDrive = await this._getUSBDrive()
    if (usbDrive !== undefined) {
      this._type = 'usb'
      this._savePath = usbDrive.mountpoints[0].path
    } else {
      this._type = 'local'
      this._savePath = this._localSavePath
    }
  }

  async _getUSBDrive() {
    const drives = await drivelist.list();
    // console.log('devices', JSON.stringify(drives))
    return drives.find((drive) => drive.isUSB)
  }

  destroy() {
    console.log('FileSystem:destroy')
    usb.unrefHotplugEvents()
  }
}