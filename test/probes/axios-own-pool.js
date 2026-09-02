// Throwaway diagnostic, not part of the harness. Goes with test/probes/.
//
// The third cure, and the one shaped like something core could take. The other
// two change what node does with every socket in the process: no-idle-timer.js
// disarms the pooled-socket timer, unhook-timeout.js patches
// Agent.keepSocketAlive. This changes nothing global -- it gives axios a
// connection pool of its own, so the sockets it poisons are only ever drawn on
// by axios again.
//
// That is a cure rather than a relocation because axios is immune to its own
// poison. follow-redirects calls socket.setTimeout(msecs) at the start of every
// request it handles, and axios passes 0 when no timeout is configured, so on
// axios's own pool the timer is off for the life of each request and the leaked
// socket.destroy listener has nothing to fire it. Everyone else's sockets --
// node-fetch's, and so the Grist API client's -- keep node's idle timer and
// node's own handler, which destroys a socket only when it is in the free list.
//
// Load order matters: axios.create() merges the defaults at the moment an
// instance is made, so this has to run before any module that builds one at
// import time. A --require does.

const http = require('http');
const https = require('https');
const axios = require('axios');

axios.defaults.httpAgent = new http.Agent({keepAlive: true});
axios.defaults.httpsAgent = new https.Agent({keepAlive: true});

// What the two pools look like at the end is the mechanism itself: axios's
// sockets should carry the leaked listener with the timer off, and the shared
// ones should be back to node's single handler with the timer armed.
const describe = (agent, label) => {
  const sockets = Object.values(agent.freeSockets || {}).flat();
  if (!sockets.length) { return `${label}: no free sockets`; }
  const shape = sockets.map((s) => `${s.listenerCount('timeout')} listeners/${s.timeout || 0}ms`);
  return `${label}: ${[...new Set(shape)].join(', ')}`;
};
process.on('exit', () => {
  console.log(`[axios-own-pool] ${describe(axios.defaults.httpAgent, "axios's pool")}`);
  console.log(`[axios-own-pool] ${describe(http.globalAgent, 'the shared pool')}`);
});

console.log('[axios given a connection pool of its own]');
