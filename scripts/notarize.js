#!/usr/bin/env node

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin' ||
      process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    console.log('No notarization needed');
    return;
  }
  console.log('Notarization begins...')
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.normalize(path.join(context.appOutDir, `${appName}.app`));
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId) {
    console.warn('Please set APPLE_ID');
    process.exit(1);
  }
  if (!appleIdPassword) {
    console.warn('Please set APPLE_ID_PASSWORD');
    process.exit(1);
  }
  if (!teamId) {
    console.warn('Please set TEAM_ID');
    process.exit(1);
  }
  return notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId
  });
};
