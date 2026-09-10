/**
 * Stopping an app this repo spawned. Shared by the runner and by the tests that
 * start an app themselves, since getting it wrong strands a process holding the
 * state directory open.
 */

const {spawnSync} = require('child_process');

/**
 * Waits for the app to be gone, not merely signalled: it holds the state
 * directory's sqlite files open, and Windows will not delete those under a live
 * process. Windows also has no process group to kill, so taskkill is told to
 * take the whole tree.
 */
function stopApp(app) {
  return new Promise((resolve) => {
    if (!app.pid || app.exitCode !== null || app.signalCode !== null) { return resolve(); }
    app.once('exit', resolve);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F']);
    } else {
      app.kill();
      setTimeout(() => app.kill('SIGKILL'), 5000).unref();
    }
    setTimeout(resolve, 10000).unref();
  });
}

exports.stopApp = stopApp;
