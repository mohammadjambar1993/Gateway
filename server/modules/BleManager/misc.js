// mostly used to avoid circular require for these functions that are required by different 
// parents and children


/**
 * Creates a ble unique id for service or charactertic using the fixed prefix and suffix.
 * @param  {String} uuid Variable uuid
 * @return {String}      Full identifier
 */
const makeUUID = (uuid) => {
    const PREFIX = '2004';
    const SUFFIX = '-9630-4EA8-9D21-04148452E81F';
    return PREFIX + uuid + SUFFIX;
}

class InvalidEncryptionKeysError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'InvalidEncryptionKeysError';
  }
}

module.exports = {
  makeUUID,
  InvalidEncryptionKeysError,
}
