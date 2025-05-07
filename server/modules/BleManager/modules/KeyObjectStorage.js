const fs = require('fs/promises');
const { EventEmitter } = require('events')

const DEFAULT_SETTINGS = {
  dbpath: './db/db.json',
  maxKeys: 200,
  // key: 'id',
  // logger: console.log,
}

/*
  class KeyObjectStorage
    abstract in memory json storage class with file storage for resumability,
    takes maxKeys as a param to implement first in first out storage limit.
*/

class KeyObjectStorage extends EventEmitter {
  constructor(_settings={}) {
    super()
    this._dbcache = []
    this._isinit = false
    if (_settings.logger) {
      _settings.loggerNS = _settings.loggerNS || 'keyObjectStorage'
      this._log = _settings.logger.extend(_settings.loggerNS)
      delete _settings.loggerNS
      delete _settings.logger
    } else {
      this._log = console.log
    }
    this._settings = Object.assign({}, DEFAULT_SETTINGS, _settings)
  }

  db() {
    return this._dbcache
  }

  async load() {
    return await this._loadCache()
  }

  // optional key with fallback to settings.key, value required
  async get(_key, _value) {
    const { key, value } = this._sanitizeParams(_key, _value)
    await this._loadCache();
    const encObj = this._dbcache.find(
      (ko) => ko[key] === value[key]
    );
    this._log(`get() called, key ${key}, value ${value}, found ${JSON.stringify(encObj)}`)
    if (encObj) {
      return encObj
    }
    return null;
  }

  async set(_key, _value) {
    const { key, value } = this._sanitizeParams(_key, _value)
    await this._loadCache();

    const pidx = this._dbcache.findIndex(
      (ko) => ko[key] === value[key]
    );
    this._log(`set() called, key ${key}, value ${value}`)
    if (pidx !== -1) {
      // for updates we remove the value and add it to the end of the array
      // to respect our cache rule in case of overflow
      this._dbcache.splice(pidx, 1);
    }
    this._dbcache.push({
      ...value,
      __writets: Date.now(),
    });
    // call cleanCache without waiting for the promise to resolve
    // if it causes any issues (race condition mostly), add await
    this._saveCache();
  }

  // a partial or full value can be used to lookup an item to remove
  // we remove the first match, so the more attributes provided to the
  // original item stored, the more accurate this is
  // a string can also be provided to lookup base on settings.key
  async remove(partialValue) {
    if (typeof partialValue === 'string') {
      if (typeof this._settings.key === 'undefined') {
        throw new Error('KeyObjectStorage - \'key\' param needs to be defined for the way you are using this class')
      }
      partialValue = {
        [this._settings.key]: partialValue,
      }
    }
    this._log(`remove() called, search param ${JSON.stringify(partialValue)}`)
    await this._loadCache();
    const keys = Object.keys(partialValue)
    const pidx = this._dbcache.findIndex(
      (ko) => {
        for(let i=0; i < keys.length; i++) {
          if (ko[keys[i]] !== partialValue[keys[i]]) return false
        }
        return true
    });

    if (pidx !== -1) {
      // for updates we remove the value and add it to the end of the array
      // to respect our cache rule in case of overflow
      this._log(`remove() found and removed record`)
      this._dbcache.splice(pidx, 1);
      await this._saveCache();
    } else {
      this._log(`remove() object not found!`)
    }
  }

  async _loadCache() {
    if (this._isinit) return;
    this._log(`_loadCache() loading cached db`)
    try {
      const data = await fs.readFile(this._settings.dbpath)
      this._dbcache = JSON.parse(data);
      this._log(`_loadCache() db successfully loaded from file`)
    } catch (e) {
      if (e.message.includes('ENOENT')) {
        this._log(`_loadCache() found no DB file. starting fresh.`)
      } else {
        this._log(`_loadCache() loading and parsing error.`, e)
      }
    }
    this._dbcache = this._dbcache || []
    this._isinit = true;
  }

  async _saveCache() {
    this._log(`_saveCache() called.`)
    const removalCount =
      this._dbcache.length - this._settings.maxKeys;
    if (removalCount > 0) {
      this._log(`_saveCache() removing ${removalCount} key(s) to open up space.`)
      this._dbcache.splice(0, removalCount);
    }
    try {
      const encObj = JSON.stringify(this._dbcache);
      await fs.writeFile(this._settings.dbpath, encObj)
      this._log(`_saveCache() DB cache updated`)
      this.emit('update')
    } catch (err) {
      this._log(`_saveCache() error while saving db file`, err)
    }
  }

  _sanitizeParams(key, value) {
    if (typeof value === 'undefined') {
      if (typeof this._settings.key === 'undefined') {
        throw new Error('KeyObjectStorage - \'key\' param needs to be defined for the way you are using this class')
      }
      value = key
      key = this._settings.key
    }
    return { key, value }
  }
}

module.exports = KeyObjectStorage;
