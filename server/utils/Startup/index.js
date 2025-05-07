const _fs = require('fs');
const fs = _fs.promises
const path = require('path')
const parser = require('csv-parser');
const { exec } = require('child_process');
const semver = require('semver');


// console.log('fs', fs)

const exists = (path) => new Promise((resolve, reject) => {
  fs.access(path, _fs.constants.F_OK)
  .then(() => {
    resolve(true)
  })
  .catch(() => {
    resolve(false)
  })
})

const EXEC_DEFAULT_OPTS = {
  cwd: path.resolve(__dirname, '../../../'),
  stdio: 'inherit',
}

const execAsync = (cmd, opts={}) => new Promise((resolve, reject) => {
  exec(cmd, Object.assign({}, EXEC_DEFAULT_OPTS, opts), (err) => {
    if (err) {
      return reject(err)
    }
    return resolve()
  })
})

const getDirectories = async source =>
  (await fs.readdir(source, { withFileTypes: true }))
    .filter(dirent => dirent.isDirectory())
    // .map(dirent => dirent.name)

const parseCSV = (filePath) => new Promise((resolve, reject) => {
  const escape = str => {
    return str
      .replace(/[\\]/g, '\\\\')
      .replace(/["]/g, '\\"')
      .replace(/[/]/g, '\\/')
      .replace(/[\b]/g, '\\b')
      .replace(/[\f]/g, '\\f')
      .replace(/[\n]/g, '\\n')
      .replace(/[\r]/g, '\\r')
      .replace(/[\t]/g, '\\t');
  };

  const hexResults = {};
  const decResults = {};

  _fs.createReadStream(filePath)
  .on('error', error => {
    // console.error(error);
    reject(error)
  })
  .pipe(parser())
  .on('data', data => {
    hexResults[data.Hexadecimal] = escape(data.Company);
    decResults[data.Decimal] = escape(data.Company);
  })
  .on('end', () => {
    resolve({ hexResults, decResults })
  });
})


module.exports = async function(fastify) {
  // check for UI build folder
  const buildDirPath = path.resolve(__dirname, '../../../build/')
  // const buildAssetManifestPath = path.resolve(buildDirPath, './asset-manifest.json')
  const buildDirExists = await exists(buildDirPath)

  if (!buildDirExists) {
    // no build folder found, lets do a fresh build
    console.log('build folder not found, building frontend UI')
    await execAsync('npm run build')
    // console.log('startup: created data dir')
  }

  let buildDirectories = await getDirectories(buildDirPath)
  if (!buildDirectories.length) {
    console.log('build folder is empty, building frontend UI')
    await execAsync('npm run build')
    buildDirectories = await getDirectories(buildDirPath)
  }
  let appVersion = false
  buildDirectories.forEach((dir) => {
    if (!appVersion) {
      appVersion = dir.name
    } else if (semver.gt(dir.name, appVersion)) {
      appVersion = dir.name
    }
  })
  console.log('found version ', appVersion)


  const podHubStaticFolder = path.resolve(buildDirPath, `./${appVersion}`)
  fastify.decorate('podHubStaticFolder', podHubStaticFolder)
  console.log('set podhub static folder', fastify.podHubStaticFolder)

  // console.log('startup:init')
  const dataDirPath = path.resolve(__dirname, '../../data/')
  const dataDirExists = await exists(dataDirPath)
  if (!dataDirExists) {
    await fs.mkdir(dataDirPath)
    // console.log('startup: created data dir')
  }

  const dbDirPath = path.resolve(dataDirPath, './db')
  const dbDirExists = await exists(dbDirPath)
  if (!dbDirExists) {
    await fs.mkdir(dbDirPath)
    // console.log('startup: created db dir')
  }

  // noble manu file
  const nobleModulePath = path.resolve(__dirname, '../../../node_modules/@abandonware/noble/')
  const csvPath = path.resolve(__dirname, './manufactures-data.csv')
  const hexPath = path.resolve(nobleModulePath, './lib/manufactures-hex.json')
  const decPath = path.resolve(nobleModulePath, './lib/manufactures-dec.json')


  const nobleModuleExists = await exists(nobleModulePath)
  const hexPathExists = await exists(hexPath)
  const decPathExists = await exists(decPath)
  if (nobleModuleExists && (!hexPathExists || !decPathExists)) {
    // console.log('startup: creating noble files')
    // create scripts dir
    try {
      const { hexResults, decResults } = await parseCSV(csvPath)
      await fs.writeFile(hexPath, JSON.stringify(hexResults, null, '\t'), { encoding: 'utf-8' });
      // console.log('startup: manufactures hex data saved')
      await fs.writeFile(decPath, JSON.stringify(decResults, null, '\t'), { encoding: 'utf-8' });
      // console.log('startup: manufactures dec data saved')
    } catch (e) {
      console.warn('Error occured while setting up manufactures data, ignored ...', e);
    }
  } else {
    // console.log('startup: noble files already exist')
  }

  
}

