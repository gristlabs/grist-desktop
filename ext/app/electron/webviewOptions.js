/**
 *
 * This module is responsible for safely enabling electron's webview tag. It listens to the creation
 * of webviews and overrides their webPreferences and params settings or sometimes prevents their
 * creation.
 *
 * Why webview ? Grist's plugin system includes running safely untrusted code in the client and
 * webviews are the electron's recommended way to do that. In particular, webviews run in a separate
 * process. For more detail about electron's security recommandation in embedding untrusted content
 * see: https://github.com/electron/electron/blob/master/docs/tutorial/security.md
 *
 * However, some webview's features make it possible to access node (cf: with the nodeIntegration or
 * preload attributes). And because, we cannot trust some third party library that we run on the
 * client (google lib), we need to make sure to limit access to these features.
 *
 * To sum up the goals of this module are:
 * 1) Enable running untrusted code safely within a webview.
 * 2) Prevent any fraudulous use of the webview api.
 *
 * Specifications: it needs to be possible to do the following:
 *
 * 1) It should not be able to set webviews preload scripts. This is achieved by setting the
 *    `preloadURL` option which causes to override the corresponding option in webPreferences.
 * 2) It should not be able to set webviews nodeIntegration to true. This is ahieved by setting
 *    the `nodeIntegration` options which causes to override the corresponding option in webPreferences.
 * 3) It should not be possible to instanciate a webview from within a webview (a subwebview).
 *
 * USAGE:
 * To meet all the above mentioned specifications options should be set as follows:
 *
 * const webview = require('app/electron/webviewOptions.js');
 *
 * webview.setOptions({
 *   preloadURL: `file://${pathToWebviewPreloadSript}`,
 *   nodeIntegration: false,
 *   enableWhiteListOnly: true,
 * });
 *
 * NOTE:
 * - `preloadURL` adds an extra protection to electron's default limitations: the preload attribute
 *    only support `file:` or `asar:` protocol, ensuring at least that the file is from the local
 *    system (see: https://electronjs.org/docs/api/webview-tag#preload)
 *
 * TESTS:
 * Each specs are unit tested in `test/electron/createWindowTest.js`.
 *
 */


const electron = require('electron');

/**
 * The list of properties white listed in the `params` object passed to the listener to
 * `will-attach-webview`. It should be kept to the minimum to allow safebrowser plugins to
 * work. Attributes are listed here https://electronjs.org/docs/api/webview-tag#tag-attributes. Note
 * that some of them are not documented, but cause plugins to fail if removed from this list (ie: `instanceId`).
 */
const paramsWhiteList = [
  'src',
  'allowpopups',
  'maxheight',
  'maxwidth',
  'minheight',
  'minwidth',
  'elementHeight',
  'elementWidth',
  'instanceId',
  'partition',
];

/**
 * The list of properties white listed in the `webPreferences` object passed to
 * `will-attach-webview` listener. It shuold be kept to the minimum to allow safebrowser plugins to
 * work. Properties are the optinos listed here
 * https://electronjs.org/docs/api/browser-window#new-browserwindowoptions
 */
const webPreferencesWhiteList = [];

/**
 * Following are the electron recommended webPreferences options
 * https://github.com/electron/electron/blob/master/docs/tutorial/security.md
 */
const webPreferencesDefaults = {
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  blinkFeatures: "",
  nodeIntegrationInWorker: false,
  autosize: false,
};

const options = {};

/**
 * Set webview options.
 *
 * @param{Object} opts: the options to set
 * @param{String} opts.preloadURL: Optional, set the webview's preload script, defined here:
 *   https://electronjs.org/docs/api/webview-tag#preload. If ommited, webview's provided preload
 *   script is used.
 * @param{Boolean} opts.nodeIntegration: Optional, wether or not to allow access to node api (more
 *   details: https://electronjs.org/docs/api/webview-tag#nodeintegration). If ommited, webview's
 *   provided is used.
 * @param{Boolean} opts.enableWhiteListOnly: If true, set to `undefined` all properties that are not
 *   part of white lists.
 */
exports.setOptions = function(opts) {
  Object.assign(options, opts);
};


electron.app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (_, webPreferences, params) => {
    applyOptions(webPreferences, params);
  });
});

/**
 * Apply options to `webPreferences` and `params` which are used to create the webview. First, if
 * enabled, white lists are applied. Then we apply the default set of parameters. Finally we apply
 * module options.
 *
 * Some useful links:
 * - the `will-attach-webview` documentation:
 * https://github.com/electron/electron/blob/master/docs/api/web-contents.md#event-will-attach-webview
 * - the webview's supported attribute list:
 * https://electronjs.org/docs/api/webview-tag#tag-attributes
 * - the list of webPreferences:
 * https://electronjs.org/docs/api/browser-window#new-browserwindowoptions
 *
 */
function applyOptions(webPreferences, params) {
  if (options.enableWhiteListOnly) {
    applyWhiteList(params, paramsWhiteList);
    applyWhiteList(webPreferences, webPreferencesWhiteList);
  }
  Object.assign(webPreferences, webPreferencesDefaults);

  if (typeof options.preloadURL !== 'undefined') {
    webPreferences.preloadURL = options.preloadURL;
  }
  if (typeof options.nodeIntegration !== 'undefined') {
    webPreferences.nodeIntegration = options.nodeIntegration;
  }
}
exports.applyOptions = applyOptions;

/**
 * Assigns `undefined` to all properties of obj that are not listed in allowedKeys array.
 */
function applyWhiteList(obj, allowedKeys) {
  for (const key in obj) {
    if (!allowedKeys.includes(key)) {
      obj[key] = undefined;
    }
  }
}
