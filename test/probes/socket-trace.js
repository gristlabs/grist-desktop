// Throwaway CI probe, a mocha --require. Delete with test/probes/socket-idle.js.
//
// Phase one showed that a plain idle HTTP request survives well past five
// seconds on every runner, macos-15-intel included, so whatever closes the
// ActionLog /apply connection needs Grist or Electron in the loop. This traces
// the real request instead of a stand-in for it.
//
// The question it exists to answer is direction, and the evidence is whether
// anything arrived from the peer before the socket went. A FIN (`end`) means the
// server closed gracefully; an ECONNRESET means it closed abruptly; a close with
// neither means the socket was taken away on this side. All three produce the
// same `socket hang up` from node-fetch, which is why two rounds of reading the
// code did not settle it.
//
// Timestamps are absolute as well as relative, so the transcript can be lined up
// against deployment-app.log, which is the only account of what the server
// thought was happening.

const http = require('http');
const https = require('https');

// Everything is traced and almost nothing is printed: chromedriver traffic runs
// over the same client, and a request that behaved is not evidence.
const SLOW_MS = 4000;

function attach(req, label) {
  const started = Date.now();
  const events = [];
  const note = (what) => events.push(`${String(Date.now() - started).padStart(6)}ms  ${what}`);
  let sawFin = false;
  let sawTimeout = false;
  let socketError = null;

  req.on('socket', (s) => {
    note(`socket assigned, reused=${Boolean(req.reusedSocket)}`);
    const where = () => `${s.localAddress}:${s.localPort} -> ${s.remoteAddress}:${s.remotePort}`;
    if (s.connecting) { s.on('connect', () => note(`connect ${where()}`)); }
    else { note(`connect (pooled) ${where()}`); }
    s.on('timeout', () => { sawTimeout = true; note('socket timeout event (node agent 5s idle timer)'); });
    s.on('end', () => { sawFin = true; note('saw FIN from server'); });
    s.on('error', (e) => { socketError = e.code || e.message; note(`socket error ${socketError}`); });
    s.on('close', (had) => note(`socket close hadError=${had}`));
  });
  req.on('timeout', () => note('request timeout event'));
  req.on('response', (res) => note(`response ${res.statusCode}`));

  const verdict = () => {
    if (sawFin) { return 'SERVER closed gracefully (FIN arrived)'; }
    if (socketError === 'ECONNRESET') { return 'SERVER closed abruptly (RST arrived)'; }
    if (socketError) { return `peer or transport: socket error ${socketError}`; }
    return `LOCAL: closed with nothing from the peer${sawTimeout ? ', after the agent idle timer' : ''}`;
  };

  const report = (outcome) => {
    const elapsed = Date.now() - started;
    if (outcome === 'ok' && elapsed < SLOW_MS) { return; }
    // The close and error events land just after the outcome does, and they are
    // the ones that say who moved, so print a moment later.
    setTimeout(() => {
      console.log(`\n[socket-trace] ${label}`);
      console.log(`[socket-trace]   started ${new Date(started).toISOString()}, ${outcome} after ${elapsed}ms`);
      if (outcome !== 'ok') { console.log(`[socket-trace]   who closed: ${verdict()}`); }
      for (const e of events) { console.log(`[socket-trace]   ${e}`); }
    }, 250);
  };

  req.on('error', (e) => report(`FAILED (${e.code || e.message})`));
  req.on('response', (res) => res.on('end', () => report('ok')));
}

for (const mod of [http, https]) {
  for (const name of ['request', 'get']) {
    const orig = mod[name];
    mod[name] = function(...args) {
      const req = orig.apply(this, args);
      try { attach(req, `${req.method} ${req.host || ''}${req.path || ''}`); } catch (e) {
        // Tracing must never be the reason a test fails.
      }
      return req;
    };
  }
}

console.log('[socket-trace] tracing client sockets; reporting failures and anything over 4s');
