const OriginalBindings = require('@abandonware/noble/lib/hci-socket/bindings')
const OriginalGap = require('@abandonware/noble/lib/hci-socket/gap')

class Gap extends OriginalGap {
  constructor(hci) {
    super(hci)
  }

  onLeScanEnableSetCmd(enable, filterDuplicates) {
    // Check to see if the new settings differ from what we expect.
    // If we are scanning, then a change happens if the new command stops
    // scanning or if duplicate filtering changes.
    // If we are not scanning, then a change happens if scanning was enabled.
    if (this._scanState === 'starting' || this._scanState === 'started') {
      if (!enable) {
        this.emit('scanStop');
      } else if (this._scanFilterDuplicates !== filterDuplicates) {
        this._scanFilterDuplicates = filterDuplicates;

        this.emit('scanStart', this._scanFilterDuplicates);
      }
    } else if (
      (this._scanState === 'stopping' || this._scanState === 'stopped') &&
      enable
    ) {
      // Someone started scanning on us.
      this._scanState = 'started'
      this.emit('scanStart', this._scanFilterDuplicates);
    }
  }

}

class NobleBindings extends OriginalBindings {
  constructor(options) {
    super(options)
    delete this._gap
    this._gap = new Gap(this._hci);
  }
}

module.exports = NobleBindings
