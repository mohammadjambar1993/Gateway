const { EventEmitter } = require('events')
const checkDiskSpace = require('check-disk-space').default
const path = require('path')

const formatMemoryUsage = (data) => `${Math.round(data/1024/1024*100)/100} MB`;

const DEFAULT_SETTINGS = {
  interval: 10000,
  autoStart: false,
  storagePath: path.resolve(__dirname, '../db'), // this can be changed to watch other/parent folders instead
}

class ProcessMonitor extends EventEmitter {
  constructor(_settings = {}) {
    super()

    if (_settings.logger) {
      _settings.loggerNS = _settings.loggerNS || 'processMonitor'
      this._log = _settings.logger.extend(_settings.loggerNS)
      delete _settings.loggerNS
      delete _settings.logger
    } else {
      this._log = console.log
    }

    this.fs = _settings.fs	
    delete _settings.fs	

    this.settings = Object.assign({}, DEFAULT_SETTINGS, _settings)
    this._timeout = null
    this._running = false

    if (this.settings.autoStart) {
      this.start()
    }
  }

  start() {
    this._log('start() called')
    this._running = true
    this._run()
  }

  stop() {
    this._log('stop() called')
    this._running = false
  }

  async _run() {
    clearTimeout(this._timeout)
    if (!this._running) {
      this._log(`_run() called, monitor has been paused.`)
      return;
    }
    const {
      rss,     
      heapTotal,
      heapUsed, 
      external,
      arrayBuffers,
    } = process.memoryUsage()
    
    const diskspace = await checkDiskSpace(this.fs.getSavePath())
    //const diskspace = await checkDiskSpace(this.settings.storagePath)
    // free and size are in bytes
    // diskspace {
    //     diskPath: 'C:',
    //     free: 12345678,
    //     size: 98756432
    // }

    // console.log('diskspace', diskspace)
    
    this.emit('update', {
      rss,
      heapTotal,
      heapUsed,
      external,
      arrayBuffers,
      diskspace,
    })
    //this._log(`_run() info, rss: ${formatMemoryUsage(rss)}, heapTotal: ${formatMemoryUsage(heapTotal)}, heapUsed: ${formatMemoryUsage(heapUsed)}, external: ${formatMemoryUsage(external)}, arrayBuffers: ${arrayBuffers}, diskspace: ${diskspace}`)
    //this._log(`_run() info, rss: ${rss}, heapTotal: ${heapTotal}, heapUsed: ${heapUsed}, external: ${external}, arrayBuffers: ${arrayBuffers}, diskspace: ${diskspace}`)
    this._timeout = setTimeout(() => this._run(), this.settings.interval)
    // this._log(`_run() will recheck in ${this.settings.interval}ms.`)
  }
}


module.exports = ProcessMonitor