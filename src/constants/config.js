const { version } = require('../../package.json')

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development'


export const APP_VERSION = version
export const BLE_WS_PORT = process.env.REACT_APP_WS_PORT || (isDev ? '3001' : '8080')
export const BLE_WS_PATH = process.env.REACT_APP_WS_PATH || '127.0.0.1'
export const BLE_WS = isDev ? `ws://${BLE_WS_PATH}:${BLE_WS_PORT}` : `ws://${BLE_WS_PATH}:${BLE_WS_PORT}`
