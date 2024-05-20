# Grist Desktop App, built with Electron

This is an Electron build of [Grist](https://github.com/gristlabs/grist-core/).
Use it to easily open and edit Grist spreadsheets on your computer. It does not
need the internet, and will work fine on a desert island (assuming you can find a
power outlet). It is not tied to any online account or service.

This build is handy for all sorts of things, like editing splits for
ML training runs, analyzing some CSV or JSON data, or preparing some
structured lists for a batch job.

It is also the quickest way to demonstrate to the skeptical that a
Grist spreadsheet on a hosted service really is fully self-contained,
and that you could download it and work with it on your own hardware
if you needed to.

For hosting Grist spreadsheets on a server for use by a team,
better options are [grist-core](https://github.com/gristlabs/grist-core/)
and [grist-omnibus](https://github.com/gristlabs/grist-omnibus/).

## Download

See https://github.com/gristlabs/grist-electron/releases

## Screenshots

The Grist [Meme Generator](https://templates.getgrist.com/gtzQwTXkgzFG/Meme-Generator) template being edited on an Intel Mac.

![Grist on Intel Mac](https://user-images.githubusercontent.com/118367/219882277-4dd1e60f-adde-463c-9a79-71e1924db6c1.png)

A [Wedding Planner](https://templates.getgrist.com/mNp9G2bZ1uaE/Wedding-Planner) on Ubuntu.

![Grist on Linux](https://user-images.githubusercontent.com/118367/221054013-60d7bde0-c524-4185-972a-703b45141b56.png)

A [D&D Encounter Tracker](https://templates.getgrist.com/3r2i6U4zhQLb/DD-Encounter-Tracker) on an ARM Mac (M1).

![Grist on Mac M1](https://user-images.githubusercontent.com/118367/221052545-a1024710-b368-4f4b-a727-9d54c0b43cb5.png)

A [Doggy Daycare](https://templates.getgrist.com/vAcfEKLQf3YF/Doggie-Daycare) spreadsheet running on an old super-low-resolution Windows 7 setup.

![Grist on Windows 7](https://user-images.githubusercontent.com/118367/215295214-83c46e03-16f6-45d2-84dd-d26d34cb5f95.jpeg)

Grist Electron being used as a server on a LAN, on Windows 10 Pro (credit: [Sylvain_Page](https://community.getgrist.com/t/packaging-grist-as-an-electron-app/1233/29)).

![Grist on Windows 10 Pro](https://user-images.githubusercontent.com/118367/221203024-ac8ad72d-bb08-43dd-9447-f9a06cfbce3e.jpeg)


## How to build from source

You'll need an environment with `bash`, `git`, and `yarn`.

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
to view and edit Grist spreadsheets on your laptop.

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

It you use Grist on the network this way, be aware that data is being 
sent using plain http and not encrypted https, so network traffic could be
readable in transit. And there is no login mechanism built in.

An experimental sandboxing mechanism is turned on by default, so that
formulas in a spreadsheet are limited in their effect. Sandboxing can be
turned off by setting:

```
GRIST_SANDBOX_FLAVOR=unsandboxed
```

It can be explicitly set by doing:

```
GRIST_SANDBOX_FLAVOR=pyodide
```

There are also `gvisor` and `macSandboxExec` sandbox
flavors, but they are not yet easy to use.

If you turn off sandboxing, then the full raw power of Python will be available
to any Grist spreadsheet you open. So:

 * Use only with your own Grist spreadsheets, or
 * Use with spreadsheets you trust, or
 * Turn sandboxing the heck back on, or
 * Return to the YOLO days of opening spreadsheets and crossing your fingers.

## History

Learn the back-story of this work in the
[Packaging Grist as an Electron app](https://community.getgrist.com/t/packaging-grist-as-an-electron-app/1233)
forum thread.

It draws on some ideas from https://github.com/stan-donarise/grist-core-electron/
and from an early standalone version of Grist developed at Grist Labs.

## Roadmap

 * [x] Set up a Windows x86 build
 * [x] Set up a Windows x64 build
 * [x] Set up a Linux x64 build
 * [x] Set up a Mac x64 build
 * [x] Set up a Mac ARM build
 * [x] Sign and notarize Mac builds
 * [ ] Revive the File items in the menu
 * [x] Revive opening a Grist spreadsheet from the command line
 * [ ] Revive the updater
 * [ ] Add Linux ARM builds
 * [x] Land grist-core changes upstream
 * [x] Land node-sqlite3 build changes in @gristlabs fork
 * [x] Get python sandboxing going. [Considering using WASM](https://github.com/gristlabs/grist-core/pull/437); could also use runsc on Linux and sandbox-exec on Mac
 * [x] Turn sandboxing on by default
 * [x] Become an official [gristlabs](https://github.com/gristlabs/) project :-)

# License

[Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)
