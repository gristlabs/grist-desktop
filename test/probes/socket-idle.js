// Throwaway CI probe. Not part of the test suite; delete with its workflow.
//
// Deployment mode's ActionLog failure is a `socket hang up` on a POST that the
// server goes on to answer successfully. It happens only on macos-15-intel, and
// only there because that is the only runner whose first sandbox call routinely
// takes more than five seconds. The interval from request to close was 4.999s in
// one run and 5.036s in another, so it is a timer. Locally, on Linux, nothing
// reproduces it: node's default agent leaves in-flight sockets alone, a server
// inside Electron behaves the same, and a real Grist /apply held open for a
// minute completes normally.
//
// So the question is whether a plain HTTP request that sits idle for more than
// five seconds survives at all on these runners, with no Grist and no Electron
// involved. The thing to learn from each case is not just pass or fail but which
// end moved first: a client that sees `end` before `close` was sent a FIN by the
// server, and a client that sees `close` with no `end` had its socket taken away
// locally. Both ends report every socket event with a timestamp, so the answer is
// in the transcript rather than in an inference from the error message.

const http = require('http');
const os = require('os');

// One request against a server that answers late, or dribbles its answer out.
// Resolves with an outcome rather than throwing: a failed case is a result.
function runCase({name, host, listenHost, delay, mode}) {
  return new Promise((resolve) => {
    // Per case, so a late event from a finished case cannot land in the next one.
    const events = [];
    const started = Date.now();
    const note = (what) => events.push({at: Date.now() - started, what});

    const server = http.createServer((req, res) => {
      note(`server: request ${req.method} ${req.url}`);
      if (mode === 'trickle') {
        // Headers and a byte a second. If this dies too, whatever closes the
        // connection is not counting idle time.
        res.writeHead(200, {'content-type': 'application/json'});
        let n = 0;
        const timer = setInterval(() => {
          if (++n * 1000 >= delay) { clearInterval(timer); res.end('"}'); note('server: replied'); }
          else { res.write(n === 1 ? '{"x":"' : '.'); }
        }, 1000);
      } else {
        setTimeout(() => { res.end('{"ok":true}'); note('server: replied'); }, delay);
      }
    });

    server.on('connection', (s) => {
      note(`server: connection from ${s.remoteAddress}`);
      s.on('end', () => note('server: saw FIN from client'));
      s.on('error', (e) => note(`server: socket error ${e.code || e.message}`));
      s.on('close', (had) => note(`server: socket close hadError=${had}`));
    });

    let done = false;
    const finish = (outcome) => {
      if (done) { return; }
      done = true;
      // The socket events that say who closed what arrive just after the outcome
      // does, so let them land before taking the transcript.
      setTimeout(() => {
        try { server.close(); } catch (e) { /* already closing */ }
        // Both ends write here, so order by the clock rather than by arrival.
        const timeline = events.slice().sort((a, b) => a.at - b.at)
          .map((e) => `${String(e.at).padStart(6)}ms  ${e.what}`);
        resolve({name, outcome, events: timeline});
      }, 250);
    };

    server.listen(0, listenHost, async () => {
      const port = server.address().port;
      const url = `http://${host}:${port}/apply`;

      // A prior fast request, so the slow one travels on a pooled socket. That is
      // how the real client reaches /apply, and it is the case where node's agent
      // has already armed a five second timer on the socket.
      if (mode === 'reuse') {
        await new Promise((done) => {
          const warm = http.request(url, {method: 'GET'}, (res) => { res.resume(); res.on('end', done); });
          warm.on('error', () => done());
          warm.end();
        });
        note('client: warm-up request done, pausing 2s');
        await new Promise((done) => setTimeout(done, 2000));
      }

      if (mode === 'fetch') {
        // A different client stack (undici) against the same server. If this one
        // lives and http.request does not, the timer belongs to the agent.
        const reqStart = Date.now();
        try {
          const r = await fetch(url, {method: 'POST', body: '[]'});
          await r.text();
          finish(`OK ${r.status} after ${Date.now() - reqStart}ms`);
        } catch (e) {
          finish(`FAILED after ${Date.now() - reqStart}ms: ${e.name}: ${e.message}` +
            (e.cause ? ` (cause: ${e.cause.code || e.cause.message})` : ''));
        }
        return;
      }

      const reqStart = Date.now();
      const req = http.request(url, {method: 'POST', headers: {'content-type': 'application/json'}}, (res) => {
        note(`client: response ${res.statusCode}`);
        res.resume();
        res.on('end', () => finish(`OK ${res.statusCode} after ${Date.now() - reqStart}ms`));
      });

      req.on('socket', (s) => {
        note(`client: socket assigned, reused=${Boolean(req.reusedSocket)}`);
        const describe = () => `${s.localAddress}:${s.localPort} -> ${s.remoteAddress}:${s.remotePort}`;
        if (s.connecting) { s.on('connect', () => note(`client: connect ${describe()}`)); }
        else { note(`client: connect (pooled) ${describe()}`); }
        s.on('timeout', () => note('client: socket timeout event'));
        s.on('end', () => note('client: saw FIN from server'));
        s.on('error', (e) => note(`client: socket error ${e.code || e.message}`));
        s.on('close', (had) => note(`client: socket close hadError=${had}`));
      });
      req.on('error', (e) => finish(`FAILED after ${Date.now() - reqStart}ms: ${e.message}`));
      req.end('[]');

      // Do not hang the job if a case neither answers nor fails.
      setTimeout(() => finish(`NO RESULT after ${Date.now() - reqStart}ms`), delay + 8000);
    });
  });
}

const CASES = [];
// Which address family, since dual-stack localhost is the obvious difference
// between a mac runner and a developer machine.
for (const [host, listenHost] of [['localhost', undefined], ['127.0.0.1', '127.0.0.1'], ['[::1]', '::1']]) {
  // Either side of five seconds, and well past it. If the failures all land at
  // five seconds regardless of how long the reply was going to take, it is a
  // fixed timer and not a proportion of anything.
  for (const delay of [4000, 6000, 10000]) {
    CASES.push({name: `${host} delay=${delay}ms`, host, listenHost, delay, mode: 'delay'});
  }
}
CASES.push({name: 'localhost delay=10000ms on a pooled socket', host: 'localhost', delay: 10000, mode: 'reuse'});
CASES.push({name: 'localhost trickling for 10000ms', host: 'localhost', delay: 10000, mode: 'trickle'});
CASES.push({name: 'localhost delay=10000ms via global fetch', host: 'localhost', delay: 10000, mode: 'fetch'});

(async () => {
  console.log(`node ${process.version} on ${os.platform()} ${os.release()} ${os.arch()}`);
  console.log(`http.globalAgent.options = ${JSON.stringify(http.globalAgent.options)}`);
  console.log('');
  const results = [];
  for (const c of CASES) {
    let result;
    try { result = await runCase(c); } catch (e) { result = {name: c.name, outcome: `THREW: ${e.message}`, events: []}; }
    results.push(result);
    console.log(`### ${result.name}`);
    console.log(`    ${result.outcome}`);
    for (const e of result.events) { console.log(`    ${e}`); }
    console.log('');
  }
  console.log('=== summary ===');
  for (const r of results) { console.log(`${r.outcome.startsWith('OK') ? 'ok  ' : 'FAIL'}  ${r.name}: ${r.outcome}`); }
  // The probe reports; it does not judge. A failing case is the finding.
  process.exit(0);
})();
