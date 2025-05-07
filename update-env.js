const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

const ipAddress = Object.values(os.networkInterfaces())
  .flat()
  .filter((iface) => iface.family === "IPv4" && !iface.internal)
  .map((iface) => iface.address)
  .shift();

if (!ipAddress) {
  console.error("Unable to retrieve IP address.");
  process.exit(1);
}

const fileData = fs.readFileSync(".env.production", "utf8");
const fileDataDev = fs.readFileSync(".env.development", "utf8");
let initialPath = fileData.match(/^REACT_APP_WS_PATH=(.*)$/m)?.[1];
initialPath = `REACT_APP_WS_PATH=${initialPath}`;
const newPath = `REACT_APP_WS_PATH=${ipAddress}`;

console.log(initialPath);
console.log(newPath);

if (initialPath !== newPath) {
  const newFileData = fileData.replace(/^REACT_APP_WS_PATH=(.*)$/m, newPath);
  const newFileDataDev = fileDataDev.replace(/^REACT_APP_WS_PATH=(.*)$/m, newPath);
  
  fs.writeFileSync(".env.production", newFileData);
  fs.writeFileSync(".env.development", newFileDataDev);

  console.log(`REACT_APP_WS_PATH has been updated to ${ipAddress}`);

  execSync("npm run build", { stdio: "inherit" });
} else {
  console.log(`REACT_APP_WS_PATH is already set to ${ipAddress}`);
}

//"Compiled Successfully" --> what we are looking for reading the terminal if it built successfully
// const fs = require("fs");
// const readline = require("readline");

// if (process.argv.length < 3) {
//   console.error(
//     "Please provide a new value for REACT_APP_WS_PATH as a command-line argument."
//   );
//   process.exit(1);
// }

// const newValue = process.argv[2];

// // Read the .env.development file into memory
// const fileData = fs.readFileSync(".env.production", "utf8");

// // Replace the old value of REACT_APP_WS_PATH with the new value
// const newFileData = fileData.replace(
//   /^REACT_APP_WS_PATH=(.*)$/m,
//   `REACT_APP_WS_PATH=${newValue}`
// );

// // Write the updated file data back to the .env.development file
// fs.writeFileSync(".env.production", newFileData);

// console.log("The value of REACT_APP_WS_PATH has been updated to " + newValue);

// const fs = require("fs");
// const os = require("os");

// const ipAddress = Object.values(os.networkInterfaces())
//   .flat()
//   .filter((iface) => iface.family === "IPv4" && !iface.internal)
//   .map((iface) => iface.address)
//   .shift();

// if (!ipAddress) {
//   console.error("Unable to retrieve IP address.");
//   process.exit(1);
// }

// const fileData = fs.readFileSync(".env.production", "utf8");
// const newFileData = fileData.replace(
//   /^REACT_APP_WS_PATH=(.*)$/m,
//   `REACT_APP_WS_PATH=${ipAddress}`
// );

// fs.writeFileSync(".env.production", newFileData);

// console.log(`REACT_APP_WS_PATH has been updated to ${ipAddress}`);
