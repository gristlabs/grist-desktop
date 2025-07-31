import * as electron from "electron";
import * as fse from "fs-extra";
import log from "app/server/lib/log";
import * as path from "path";
import * as winston from "winston";

/**
 * Generally, our debug log output is discarded when running on Mac as a standalone application.
 * For debug output, we will append log to ~/grist_debug.log, but only if it exists.
 *
 * So, to enable logging: `touch ~/grist_debug.log`
 * To disable logging:    `rm ~/grist_debug.log`
 * To clear the log:      `rm ~/grist_debug.log; touch ~/grist_debug.log`
 *
 * In summary:
 * - When running app from finder or "open" command, no debug output.
 * - When running from terminal as "Grist.app/Contents/MacOS/Grist, debug output goes to console.
 * - When ~/grist_debug.log exists, log also to that file.
 */
export function setupLogging() {
  const debugLogPath = (process.env.GRIST_LOG_PATH ||
    path.join(electron.app.getPath("home"), "grist_debug.log"));

  if (process.env.GRIST_LOG_PATH || fse.existsSync(debugLogPath)) {
    const output = fse.createWriteStream(debugLogPath, { flags: "a" });
    output.on("error", (err) => log.error("Failed to open %s: %s", debugLogPath, err));
    output.on("open", () => {
      log.info("Logging also to %s", debugLogPath);
      output.write("\n--- log starting by pid " + process.pid + " ---\n");

      const fileTransportOptions = {
        name: "debugLog",
        stream: output,
        level: "debug",
        timestamp: log.timestamp,
        colorize: true,
        json: false
      };

      // TODO: This does not log HTTP requests to the file. For that we may want to use
      // "express-winston" module, and possibly update winston (we are far behind).
      log.add(winston.transports.File, fileTransportOptions);
      winston.add(winston.transports.File, fileTransportOptions);
    });
  }    
}
