// pm2 ecosystem file
// commands: 
// pm2 start ecosystem.config.js
// pm2 stop ecosystem.config.js
// pm2 restart ecosystem.config.js
// doc: https://pm2.keymetrics.io/docs/usage/application-declaration/


module.exports = {
  apps : [{
    name   : "podhub",
    script : "npm",
    args: "run server:start",
  }]
}
