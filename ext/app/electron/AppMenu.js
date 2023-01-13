const electron   = require('electron');
const events     = require('events');
const path       = require('path');

const isMac      = process.platform === 'darwin';
// const isWin   = process.platform === 'win32';

const app        = electron.app;
const appName    = electron.app.getName();

class AppMenu extends events.EventEmitter {
  constructor(recentItems) {
    super();
    this.recentItems = recentItems;
    this._updateState = 'idle';
    this._menu = null;
    this.rebuildMenu();
  }

  getMenu() { return this._menu; }

  rebuildMenu() {
    this._menu = electron.Menu.buildFromTemplate(this.buildTemplate());
  }

  buildOpenRecentSubmenu() {
    let subMenu = [];
    this.recentItems.listItems().reverse().forEach(filePath => {
       subMenu.push({
          label: path.basename(filePath),
          click: event => app.emit('open-file', event, filePath)
       });
    });
    return subMenu;
  }

  buildTemplate() {
    let menuTemplate = [];

    if (isMac) {
      menuTemplate.push({
        label: appName,
        submenu: [
          { role: 'about' },
          // On Mac, the "Check for Updates" item goes into the leftmost "Grist" menu.
          ...this.buildUpdateItemsTemplate(),

          { type: 'separator' },
          { role: 'services', },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
      ]});
    }

    menuTemplate.push({
      label: 'File',
      submenu: [{
        label: 'New',
        accelerator: 'CmdOrCtrl+N',
        click: () => this.emit('menu-file-new')
      }, {
        label: 'Open...',
        accelerator: 'CmdOrCtrl+O',
        click: () => this.emit('menu-file-open')
      }, {
        label: 'Open Recent',
        submenu: this.buildOpenRecentSubmenu()
      }, {
        role: 'close'
      }]
      .concat(!isMac ? [
        { type: 'separator' },
        { role: 'quit' }
      ] : [])
    }, {
      label: 'Edit',
      submenu: [{
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        // Not setting role because we're firing a custom action in click
        click: (item, win) => win.webContents.executeJavaScript('gristApp.allCommands.undo.run()')
      }, {
        label: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        // Not setting role because we're firing a custom action in click
        click: (item, win) => win.webContents.executeJavaScript('gristApp.allCommands.redo.run()')
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectall' } ]
    }, {
      label: 'View',
      submenu: [{
        role: 'togglefullscreen'
      }, {
        label: 'Toggle Developer Tools',
        accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click: function (item, focusedWindow) {
          if (focusedWindow) {
            focusedWindow.toggleDevTools();
          }
        }
      }]
    }, {
      role: 'window',
      submenu: [{
        role: 'minimize'
      }]
      .concat(isMac ? [
        { type: 'separator' },
        { role: 'front' }
      ] : [])
    }, {
      label: 'Help',
      role: 'help',
      submenu: (
        // On Windows, the "Check for Updates" item goes in the rightmost Help menu.
        (isMac ? [] : [ ...this.buildUpdateItemsTemplate(), { type: 'separator' }])
        .concat({
          label: 'Grist User Help',
          click: (item, win) => win.webContents.executeJavaScript('gristApp.allCommands.help.run()')
        })
      )
    });

    return menuTemplate;
  }

  /**
   * Calls cb(item) for each menu item, including all submenus.
   */
  static forEachMenuItem(menu, cb) {
    for (let item of menu.items) {
      cb(item);
      if (item.submenu) {
        this.forEachMenuItem(item.submenu, cb);
      }
    }
  }

  /**
   * Given a build menu, and an auto-update state of 'idle', 'checking', 'downloading', or
   * 'restart', disables an appropriate item, and hides the rest. If optSuffix is set, it gets
   * appended to the label.
   */
  setUpdateState(state) {
    this._updateState = state;
    const labelToState = {
      'Check for Updates':          'idle',
      'Checking for Updates...':    'checking',
      'Downloading Update...':      'downloading',
      'Relaunch to Update':         'relaunch',
    };
    AppMenu.forEachMenuItem(this._menu, item => {
      let labelState = labelToState[item.label];
      if (labelState) {
        item.visible = (state === labelState);
      }
    });
  }

  buildUpdateItemsTemplate() {
    return [
      { visible: true,  label: 'Check for Updates', click: () => this.emit('check-for-updates') },
      { visible: false, label: 'Checking for Updates...', enabled: false },
      { visible: false, label: 'Downloading Update...', enabled: false },
      { visible: false, label: 'Relaunch to Update', click: () => this.emit('quit-and-install') },
    ];
  }
}

module.exports = AppMenu;
