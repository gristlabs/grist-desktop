const {ipcRenderer, remote} = require('electron');

process.once('loaded', () => {
  global.electronOpenDialog = () => ipcRenderer.send('show-open-dialog');
  global.electronSelectFiles = remote.getGlobal('electronSelectFiles').bind(null, remote.getCurrentWindow());
  global.isRunningUnderElectron = true;
});
