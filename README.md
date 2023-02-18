# Grist Electron app

This is an unofficial, experimental electron build of Grist.

It draws on some ideas from https://github.com/stan-donarise/grist-core-electron/
and from an early standalone version of Grist.

Only use with your own Grist documents or documents you trust, there is no
sandboxing yet.

## Download

See https://github.com/paulfitz/grist-electron/releases

## Screenshots

The Grist [Meme Generator](https://templates.getgrist.com/gtzQwTXkgzFG/Meme-Generator) template being edited on a Mac:
![Grist on Mac](https://user-images.githubusercontent.com/118367/219882277-4dd1e60f-adde-463c-9a79-71e1924db6c1.png)

Grist [Doggy Daycare](https://templates.getgrist.com/vAcfEKLQf3YF/Doggie-Daycare) template running on an old super-low-resolution Windows 7 setup:
![Grist on Windows 7](https://user-images.githubusercontent.com/118367/215295214-83c46e03-16f6-45d2-84dd-d26d34cb5f95.jpeg)

## Build

```
git submodule init
git submodule update
yarn install
yarn run setup
yarn run build
yarn run electron:preview
yarn run electron
```

## Configure

There's no configuration needed if you are just running this as a regular app
to view and edit Grist documents on your laptop.

Some people use the app as a quick way to set up a simple Grist server
in a local network where everyone is trusted. Be sure you know what you're
doing - if you have any security concerns at all, I'd urge you to do a
proper Grist server installation - see https://support.getgrist.com/self-managed/

If you are sure you are in a trusted environment, you can set some environment
variables to make Grist listen on a specific network interface and port:

```
GRIST_HOST=192.168.1.22     # IP address to serve from
GRIST_PORT=8484             # Port number to serve at
GRIST_ELECTRON_AUTH=strict  # Auth strategy (strict, mixed, or none)
```

(You can create a `.env` file in the root directory of the app and set
the environment variables there). Set `GRIST_ELECTRON_AUTH` to `none`
to allow access across the network just as if you were using the app.
Set `GRIST_ELECTRON_AUTH` to `mixed` to allow anonymous access
across the network, but not logins. Set `GRIST_ELECTRON_AUTH` to `strict`
to require logins and to permit them only in the app.

Don't think any of this is secure. There is no sandboxing, so an
untrusted user who can edit formulas would have access to unrestricted
Python running on your machine, and that's dangerous. Connections are
plain http and not encrypted https, so network traffic could be
readable in transit. And there’s no real login mechanism built in.

## History

Learn the back-story of this work in the
[Packaging Grist as an Electron app](https://community.getgrist.com/t/packaging-grist-as-an-electron-app/1233)
forum thread.

## Roadmap

 * [x] Set up a Windows x86 build
 * [x] Set up a Windows x64 build
 * [x] Set up a Linux x64 build
 * [x] Set up a Mac x64 build
 * [x] Sign and notarize Mac builds
 * [ ] Revive the File items in the menu
 * [x] Revive opening a Grist document from the command line
 * [ ] Revive the updater
 * [ ] Get ARM builds going
 * [x] Land grist-core changes upstream
 * [x] Land node-sqlite3 build changes in @gristlabs fork
 * [ ] Get python sandboxing going (perhaps with runsc on Linux, sandbox-exec on Mac, ... but what on Windows? Maybe wasm for all)
