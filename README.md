Just experimenting here, for an electron build of Grist see https://github.com/stan-donarise/grist-core-electron/

```
yarn install
yarn run setup
yarn run build
yarn run electron:preview
```

See [Releases](https://github.com/paulfitz/grist-electron/releases) for downloads.

 * [x] Set up a Windows x86 build
 * [x] Set up a Windows x64 build
 * [x] Set up a Linux x64 build
 * [x] Set up a Mac x64 build
 * [ ] Sign and notarize Mac builds
 * [ ] Revive the File items in the menu
 * [ ] Revive opening a Grist document from the command line
 * [ ] Revive the updater
 * [ ] Get ARM builds going
 * [ ] Land grist-core changes upstream
 * [ ] Land node-sqlite3 build changes in @gristlabs fork
