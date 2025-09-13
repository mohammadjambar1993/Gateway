<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->

<a name="readme-top"></a>

<!--
*** Thanks for checking out the Best-README-Template. If you have a suggestion
*** that would make this better, please fork the repo and create a pull request
*** or simply open an issue with the tag "enhancement".
*** Don't forget to give the project a star!
*** Thanks again! Now go create something AMAZING! :D
-->

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/ahoura/pod-hub">
    <img src="src/logo.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">PodHub</h3>

  <p align="center">
    A BLE receiver for Skiin Pods.
    <br />
    <a href="https://github.com/ahoura/pod-hub"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/ahoura/pod-hub/issues">Report Bug</a>
    ·
    <a href="https://github.com/ahoura/pod-hub/issues">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->

## About The Project

[![Product Name Screen Shot][product-screenshot]](https://example.com)

PodHub is a BLE receiver for skiin pods. User can pair, record, monitor and save data recordings from their pods.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

- [![React][react.js]][react-url]
- [![Bootstrap][bootstrap.com]][bootstrap-url]
- [![Nodejs][nodejs-img]][nodejs-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->

## Getting Started

Podhub consists of a `reactjs` frontend app and a `fastify` backend server. Before getting started you need to have `yarn` installed. Yarn manages the project dependencies better. `npm` might result in errors.

### Prerequisites

Install the following dependencies
_(this is specific to an ubuntu server installation, other operating systems have different requirements)_

- Root privilage

  ```sh
  sudo su
  ```

- Install build essentials (on ubuntu/linux)

  ```sh
  sudo apt install build-essential libudev-dev
  ```

- nodejs (via nvm)

  ```sh
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
  source ~/.bashrc
  nvm install v16
  ```

- yarn (global)

  ```sh
  npm install --global yarn
  ```

- pm2 (global)

  ```sh
  yarn global add pm2
  ```

- Add github.com to known hosts

  ```sh
  ssh-keyscan github.com >> ~/.ssh/known_hosts
  ```

- Configure Github Authentication on local machine

- Follow os specific instructions from https://github.com/abandonware/noble#prerequisites, for ubuntu
  ```sh
  sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev
  ```
  make sure `node` is on your `PATH`
  If you are having trouble connecting to BLE devices on a Raspberry Pi, you should disable the pnat plugin. Add the following line at the bottom of `/etc/bluetooth/main.conf`:
  ```sh
  DisablePlugins=pnat
  ```
  Then restart the system.

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/mohammadjambar1993/research-gateway-podhub.git
   cd pod-hub/
   ```
2. Install NPM packages
   ```sh
   yarn install
   ```
3. Configure UI build variables
   env config variables can be found in `.env.[development|production]` files for their respective build mode.
   You need to set the final domain/ip and port the websocket will be hosted on so the frontend can be built with the appropriate values.
4. Build frontend react app

```sh
npm run build
```

5. Start up services through `pm2`
   ```sh
   pm2 start ecosystem.config.js
   ```

_To have the app persist on reboots you can use PM2 to create a startup script https://pm2.keymetrics.io/docs/usage/startup/_

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->

## Usage

Once PodHub is running in production mode, you can access the app through `http://MACHINE_IP_OR_LOCALHOST:8080`. Fastify server, in addition to serving the `backend` app, will serve `frontend` app from `./build/[appVersion]` folder in one process.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- Dev -->

## Development

This section will explain the general app structure and how to add new features following the same code pattern.

The app consists of 2 smaller apps, `frontend` and `backend`.
In production, `frontend` build folder (`./build`) is served through the `backend`.

To startup `backend` in dev mode run

```sh
npm run server:dev
```

runs on port 3001 by default

To startup `frontend` in dev mode run

```sh
npm run start
```

runs on port 3000 by default

_`REACT_APP_WS_PATH` can be used when running/building the frontend app to inject a custom websocket domain. example: 127.0.0.1, mywebsocket.com. this value can be adjusted in `.env.development` file_

### Debugging

`debugjs` is used on backend only atm.
To enable logging, you need to pass `DEBUG=[COMMA,SEPERATED,NAMESPACES]` as env param when running the app. Backend's primary namespace is `podhub:backend`, to enable all backend logs you can pass `podhub:backend*`. This will isolate logging to only backend components excluding `fastify` and `noble` that have their own namespaces.

_Todo: add debugjs to frontend_

### Raspberry Pi

1. Download Raspberry Pi Imager https://www.raspberrypi.com/software/
2. Choose `Ubuntu Server 22.04.1 LTS (64-bit)` from `Other general-purpose OS` -> `Ubuntu`
3. Choose storage
4. Click on `advanced options` button (cog icon below `write` button), set hostname, enable ssh and fill up user+pass/pubkey info, configure wifi. Raspberry Pi Imager uses `cloud-init` to set these values, if any values are set in this step you need to wait 3-5 mins once the server boots up to let `cloud-init` make its changes. (If pi is connected to a display output youll notice a password prompt on the screen when server boots up successfully, wait until you see `cloud-init` has finished successfully before SSHing)
5. Find pi's local IP address
6. SSH into ubuntu server
7. Follow <a href="#prerequisites">Prerequisites</a> to prepare the server
8. Follow podhub <a href="#installation">installation</a> steps

### App Structure

#### Backend

source for the `fastify` backend app is in folder `./server`.

`./server/routes/root.js` consists of all the logic related to websocket connetion. All the bindings between BleManager and websocket connections is defined here.
To add a new binding between socket and BleManager follow these steps

1. choose an appropriate namespace for the command. For example, 'ble:pod:COMMAND', with COMMAND being an operation like `connect`, `disconnect` etc
2. add a new attribute to `ws_code_map` with namespace being the key, pointing to a function(socket, code) which returns a function(payload, callback) (see example below).

```js
const bleSomeCommand = (socket, code) => (payload, callback) => {
  bleManager
    .somePromiseCommand(payload)
    .then(() => {
      // success
      callback({
        code,
        data: {
          success: true,
        },
      });
    })
    .catch((error) => {
      // error handling
      callback({
        code,
        data: {
          error,
        },
      });
    });
};
```

`code` is the function's namespace which is sent by client (frontend app), we return it in our response for frontend to map responses to requests appropriately.
`data.error` is responsible for reporting error to frontend

3. add the new BleManager function to handle the request.

There is also a way to passively pass data to clients AKA subscribe to ws updates (as oppose to just responding to a single request)

```js
bleManager.on("SOME_EVENT_NS", (payload) => {
  fastify.ws.clients.forEach((client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.SOME_EVENT_FLAG === true
    ) {
      client.send(
        JSON.stringify({
          code: "SOME_EVENT_NS",
          data: payload,
        })
      );
    }
  });
});
```

as the example above shows, we check `SOME_EVENT_FLAG` which is an arbitrarily named boolean flag we use to avoid sending updates without a user being subbed (this is to improve `frontend` performance and avoid unwanted updates). To properly deploy this, create 2 new ws bindings to start and stop receiving updates (by toggling `SOME_EVENT_FLAG` on `client` object which persists throughout the ws connection)

`./server/modules/BleManager` is the brain behind the app. It handles everything pod related. You always need to run `ini()` after creating an instance of `BleManager`.
Anytime an update is made to a pod, you need to run `bleManager._stateUpdated()` to notify frontend. If you need to show a notification to the client on the `frontend` you can use `bleManager._newPodNotification(peripheralId, {title, message, type})`.
The encryption/decryption function definitions can be found in `./server/modules/BleManager/utils.js`.
To add authentication, check `bleManager.authenticatePod(peripheralId)`. The flow has been explained in comments, make sure to comment out `return true` once auth is implemented.

- note: `bleManager._guessPodSerialNumber` is an experimental feature, it assumes the last 6 bytes of `serviceData` contains the pods' serial number. This is only used while a pod is not paired.

`./server/data` is used for storing app data (pod data + encryption db file)

#### Frontend

The `frontend` source code is in `./src` folder.
it follows the `create-react-app` structure.

Majority of the logic is inside `./src/contexts/BleContext`. WS communication is handled primarily by `processMsg()` function, you can add additional back and forth communication with the backend inside this function.

In production mode, backend server will serve the frontend app from `./build` folder. For every stable release, you need to run `npm run build` to appropriately update the app being served through `fastify`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- EXPERIMENTAL -->

### Experimental Features

#### Multiple BLE receivers

This feature has been added and can be found inside `./server/modules/BleManager/index.multi`. The only difference here is `NobleManager` which handles discovery of devices and routing requests. The only reason its not considered a stable feature is lack of testing and being asked to put a pause on finalizing this feature.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->

## Contact

Project Link: [https://github.com/RNDMyant/research-gateway-podhub.git](https://github.com/RNDMyant/research-gateway-podhub.git)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[product-screenshot]: src/podhub_screenshot.png
[next.js]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[next-url]: https://nextjs.org/
[react.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[react-url]: https://reactjs.org/
[vue.js]: https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vuedotjs&logoColor=4FC08D
[vue-url]: https://vuejs.org/
[angular.io]: https://img.shields.io/badge/Angular-DD0031?style=for-the-badge&logo=angular&logoColor=white
[angular-url]: https://angular.io/
[svelte.dev]: https://img.shields.io/badge/Svelte-4A4A55?style=for-the-badge&logo=svelte&logoColor=FF3E00
[svelte-url]: https://svelte.dev/
[laravel.com]: https://img.shields.io/badge/Laravel-FF2D20?style=for-the-badge&logo=laravel&logoColor=white
[laravel-url]: https://laravel.com
[bootstrap.com]: https://img.shields.io/badge/Bootstrap-563D7C?style=for-the-badge&logo=bootstrap&logoColor=white
[bootstrap-url]: https://getbootstrap.com
[nodejs-img]: https://img.shields.io/badge/node.js-0769AD?style=for-the-badge&logo=jquery&logoColor=white
[nodejs-url]: https://nodejs.org
