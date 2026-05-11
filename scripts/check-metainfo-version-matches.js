const { XMLParser } = require('fast-xml-parser');
const { readFileSync } = require('fs');
const path = require('path');

const root = path.normalize(path.join(__dirname, '..'));
const packageInfo = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    // Force "release" to always be an array
    isArray: (name) => name === "release",
});
const metainfo = xmlParser.parse(readFileSync(path.join(root, 'metadata', 'com.getgrist.grist.metainfo.xml'), 'utf8'));
const metainfoReleases = metainfo.component.releases.release;

const matchingRelease = metainfoReleases.find(release => release.version === packageInfo.version);

if (!matchingRelease) {
    console.log(`No matching release found for version ${packageInfo.version}`);
    process.exit(1);
}

console.log(`Found matching release for version ${packageInfo.version}`);
process.exit(0);
