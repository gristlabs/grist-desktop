// Throwaway diagnostic, not part of the harness. Goes with test/probes/.
//
// The other half of the experiment in test/probes/no-idle-timer.js. That one
// leaves the leaked listener in place and disarms the timer it waits for; this
// one leaves the timer alone and removes the listener, on the way back into the
// pool where follow-redirects left it.
//
// The two cures separate the cause from the coincidence. Node's own idle timer
// is not a defect -- its handler destroys a socket only when the socket is in
// the free list, which is what an idle timer is for. If removing just the
// leaked listener is enough, the timer is exonerated and axios is the whole
// story; if it is not, something else is destroying these sockets and the first
// cure was working for a reason we have not found.
//
// socket.destroy is inherited, so the value read here is the same function
// object follow-redirects passed to addListener, and removeListener finds it.

const http = require('http');
const https = require('https');

for (const mod of [http, https]) {
  const orig = mod.Agent.prototype.keepSocketAlive;
  mod.Agent.prototype.keepSocketAlive = function (socket) {
    socket.removeListener('timeout', socket.destroy);
    return orig.call(this, socket);
  };
}
console.log('[leaked timeout listeners removed as sockets return to the pool]');
