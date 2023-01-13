/* globals window */

const ipc = require('electron').ipcRenderer;

window.isRunningUnderElectron = true;

window.sendToHost = data => ipc.sendToHost('grist', data);

window.onGristMessage = listener => ipc.on('grist', (_, data) => listener(data));
