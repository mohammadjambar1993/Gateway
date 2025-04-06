// const fastifyIO = require("fastify-socket.io");
const fastifyIO = require("../modules/SocketIO")
const WebSocket = require('ws');
const log = require('debug')('podhub:backend');
const fastifyStatic = require('@fastify/static')
const path = require('path')



const inquirer = require('inquirer')

// const CircularReplacer = require("../utils/CircularReplacer")


const BleManager = require("../modules/BleManager")

const bleManager = new BleManager({
  logger: log,
})

const wait = (ms) => new Promise((resolve) => {
  log(`waiting for ${ms/1000}s`)
  setTimeout(() => resolve(), ms)
})

module.exports = async function (fastify, opts) {
  fastify.register(fastifyIO);

  const staticFolder = fastify.podHubStaticFolder || path.join(__dirname, '../../build')

  console.log('staticFolder', staticFolder)

  fastify.register(fastifyStatic, {
    root: staticFolder,
  })

  // fastify.get('/', async function (request, reply) {
  //   return { ws: true }
  // })


  fastify.ready()
  // .then(() => bleManager._state.noble.isReady)
  .then(() => bleManager.init())
  .then(() => {
    log('fastify and bleManager ready')

    const bleSnapshot = (socket, code) => (payload, callback) => callback({
      code,
      data: bleManager.getCurrentDataSnapshot()
    })

    const bleScanStart = (socket, code) => (payload, callback) => {
      bleManager.startScan(payload?.timeout)
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('bleScanStart err', error)
        callback({
          code,
          error,
        })
      })
    }

    const bleScanStop = (socket, code) => (payload, callback) => {
      bleManager.stopScan()
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('bleScanStop err', error)
        callback({
          code,
          error,
        })
      })
    }

    const bleConnect = (socket, code) => ({ peripheralId } = {}, callback) => {
      if (!peripheralId) {
        return callback({
          code,
          error: 'peripheralId is missing'
        })
      }
      bleManager.connect(peripheralId)
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('bleConnect error', error)
        callback({
          code,
          error,
        })
      })
    }

    const bleDisconnect = (socket, code) => ({ peripheralId } = {}, callback) => {
      if (!peripheralId) {
        return callback({
          code,
          error: 'peripheralId is missing'
        })
      }
      bleManager.disconnect(peripheralId)
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('bleDisconnect err', error)
        callback({
          code,
          error,
        })
      })
    }


    const bleStart = (socket, code) => ({ peripheralId, settings } = {}, callback) => {
      if (!peripheralId) {
        return callback({
          code,
          error: 'peripheralId is missing'
        })
      }
      bleManager.podStart(peripheralId, settings)
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('bleStart err', error)
        callback({
          code,
          data: {
            error,
          }
        })
      })
    }

    const bleStop = (socket, code) => ({ peripheralId } = {}, callback) => {
      if (!peripheralId) {
        return callback({
          code,
          error: 'peripheralId is missing'
        })
      }
      bleManager.podStop(peripheralId)
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('podStop err', error)
        callback({
          code,
          error,
        })
      })
    }

    const bleStreamDataStart = (socket, code) => ({ peripheralId } = {}, callback) => {
      if (!peripheralId) {
        return callback({
          code,
          error: 'peripheralId is missing'
        })
      }
      socket.streamingData = true

      callback({
        code,
        data: {
          success: true,
        }
      })
    };

    const bleStreamDataStop = (socket, code) => ({ peripheralId } = {}, callback) => {
      if (!peripheralId) {
        return callback({
          code,
          error: 'peripheralId is missing'
        })
      }
      socket.streamingData = false

      callback({
        code,
        data: {
          success: true,
        }
      })
    };

    const bleDebugStart = (socket, code) => (_, callback) => {
      socket.debugData = true
      callback({
        code,
        data: {
          success: true,
        }
      })
    };

    const bleDebugStop = (socket, code) => (_, callback) => {
      socket.debugData = true
      callback({
        code,
        data: {
          success: true,
        }
      })
    };

    const bleEncryptionSet = (socket, code) => ({ peripheralId, key, digit } = {}, callback) => {
      if (!peripheralId || !key || !digit) {
        return callback({
          code,
          error: 'One or more params are missing'
        })
      }
      bleManager.setEncryptionKey(peripheralId, { key, digit })
      .then(() => {
        callback({
          code,
          data: {
            success: true,
          }
        })
      })
      .catch((error) => {
        log('bleEncryptionSet err', error)
        callback({
          code,
          error,
        })
      })
    }

    bleManager.on('ble:pod:data', (updatesPerPod) => {
      fastify.ws.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN
          && client.streamingData === true) {
          client.send(JSON.stringify({
            code: 'ble:pod:stream:data',
            data: updatesPerPod,
          }))
        }
      })
    })

    // an event used to show notifications to frontend client
    // atm, all updates are sent to all connected pods
    bleManager.on('ble:pod:notification', ({ peripheralId, notification }) => {
      fastify.ws.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            code: 'ble:pod:notification',
            data: { peripheralId, notification },
          }))
        }
      })
    })

    bleManager.on('prompt:encryption:key', (payload) => {
      fastify.ws.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            code: 'prompt:encryption:key',
            data: payload,
          }))
        }
      })
    })

    bleManager.on('ble:state:update', (newState) => {
      // fastify.io.broadcast.emit("ble:state:update", {
      //   data: newState,
      // })
      fastify.ws.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            code: 'ble:state:update',
            data: newState,
          }))
        }
      })
    })

    bleManager.on('ble:encdb:update', (newState) => {
      fastify.ws.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            code: 'ble:encdb:update',
            data: newState,
          }))
        }
      })
    })

    bleManager.on('ble:debug', (data) => {
      fastify.ws.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN
          && client.debugData === true) {
          client.send(JSON.stringify({
            code: 'ble:debug:data',
            data,
          }))
        }
      })
    })


    const ws_code_map = {
      'ble:snapshot': bleSnapshot,
      'ble:scan:start': bleScanStart,
      'ble:scan:stop': bleScanStop,
      'ble:pod:connect': bleConnect,
      'ble:pod:disconnect': bleDisconnect,
      'ble:pod:start': bleStart,
      'ble:pod:stop': bleStop,
      'ble:pod:stream:start': bleStreamDataStart,
      'ble:pod:stream:stop': bleStreamDataStop,
      'ble:debug:start': bleDebugStart,
      'ble:debug:stop': bleDebugStop,
      'ble:encryption:set': bleEncryptionSet,
    }
    // we need to wait for the server to be ready, else `server.io` is undefined
    fastify.ws.on("connection", (socket) => {
      log('websocket: on connection called')

      socket.on('message', msg => {
        // msg = msg.toJSON()
        // msg = msg.data.toJSON()
        try {
          const { code, data } = JSON.parse(msg.toString())
          log('websocket: new message received from client', { data, code })
          const keys = Object.keys(ws_code_map)
          if (!keys.includes(code)) {
            throw new Error('Invalid Code Provided')
          }
          ws_code_map[code](socket, code)(data, (res) => socket.send(JSON.stringify(res))) //, CircularReplacer())))
          // return socket.send(msg)
        } catch(err) {
          log('websocket message err', err)
          return socket.send(JSON.stringify({
            error: err?.message || err,
          }))
        }
      }) // Creates an echo server

      socket.on('close', () => {
        log('Client disconnected. cleaning up...')
      })

      // socket.on("ble:snapshot", bleSnapshot(socket));
      // socket.on("ble:scan:start", bleScanStart(socket));
      // socket.on("ble:scan:stop", bleScanStop(socket));
      // socket.on("ble:pod:connect", bleConnect(socket));
      // socket.on("ble:pod:disconnect", bleDisconnect(socket));
      // socket.on("ble:pod:start", bleStart(socket));
      // socket.on("ble:pod:stop", bleStop(socket));
      


    });
  });


}
