import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import path from "path";

const root = path.normalize(path.join(import.meta.dirname, '..'));
const packageInfo = JSON.parse(readFileSync('package.json'));
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    // Force "release" to always be an array
    isArray: (name) => name === "release",
});
const metainfo = xmlParser.parse(readFileSync(path.join(root, 'metadata', 'com.getgrist.grist.metainfo.xml')));
const metainfoReleases = metainfo.component.releases.release;

const matchingRelease = metainfoReleases.find(release => release.version === packageInfo.version);

if (!matchingRelease) {
    console.log(`No matching release found for version ${packageInfo.version}`);
    process.exit(1);
}

console.log(`Found matching release for version ${packageInfo.version}`);
process.exit(0);
