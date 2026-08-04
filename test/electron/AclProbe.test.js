// PROBE ONLY - not for merge.
//
// Round 3. Round 2 established: the server does the work and finishes at
// ~5.9s, but the client's socket dies at ~5.0s. Who closes it?
//
// Instrument the socket directly. The events distinguish the culprits:
//   'end'            -> server sent FIN
//   'error' ECONNRESET -> server/OS sent RST
//   'timeout' then close -> client-side idle timeout
// PROBE_AGENT=nokeepalive swaps the default agent, since node's globalAgent
// carries timeout:5000 (which on linux does NOT kill an in-flight request -
// verified - but windows is the question).

const http = require('http');

if (process.env.PROBE_AGENT === 'nokeepalive') {
  http.globalAgent = new http.Agent({keepAlive: false});
  console.log('PROBE: using a fresh agent, keepAlive=false, no timeout');
} else {
  console.log('PROBE: default agent options', JSON.stringify(http.globalAgent.options));
}

const origRequest = http.request;
http.request = function (...args) {
  const req = origRequest.apply(this, args);
  const path = (typeof args[0] === 'string') ? args[0] : ((args[0] && args[0].path) || '');
  if (String(path).includes('/apply')) {
    const t0 = Date.now();
    const mark = (ev, extra) => console.log(`SOCK +${Date.now() - t0}ms ${ev} ${extra || ''}`);
    req.on('socket', (s) => {
      mark('socket-assigned', `connecting=${s.connecting} timeout=${s.timeout}`);
      s.on('connect', () => mark('connect'));
      s.on('timeout', () => mark('TIMEOUT (idle)'));
      s.on('end', () => mark('end -- server sent FIN'));
      s.on('error', (e) => mark('socket-error', e.code || e.message));
      s.on('close', (hadError) => mark('close', `hadError=${hadError}`));
    });
    req.on('response', (res) => mark('response', `status=${res.statusCode}`));
    req.on('error', (e) => mark('req-error', e.code || e.message));
  }
  return req;
};

const gu = require('test/nbrowser/gristUtils');
const {setupTestSuite} = require('test/nbrowser/testUtils');

const REPS = Number(process.env.PROBE_REPS || 10);

const ACL_ACTIONS = [
  ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
  ['AddRecord', '_grist_ACLRules', null, {
    resource: -1, aclFormula: 'True', permissionsText: '-R',
  }],
];

const tally = {ok: 0, fail: 0};

describe('AclProbe', function () {
  this.timeout(60_000);
  const cleanup = setupTestSuite();

  for (let i = 1; i <= REPS; i++) {
    it(`acl-nosync #${i}`, async function () {
      const session = await gu.session().user('user1').login();
      const docId = (await session.tempDoc(cleanup, 'Hello.grist')).id;
      const api = session.createHomeApi();
      console.log(`PROBE #${i} doc=${docId} applying at ${new Date().toISOString()}`);
      const t0 = Date.now();
      try {
        await api.applyUserActions(docId, ACL_ACTIONS);
        console.log(`RESULT #${i} OK ${Date.now() - t0}ms`);
        tally.ok++;
      } catch (e) {
        console.log(`RESULT #${i} FAIL ${Date.now() - t0}ms ${String(e).slice(0, 120)}`);
        tally.fail++;
      }
    });
  }

  after(function () {
    console.log(`==== TALLY ok=${tally.ok} fail=${tally.fail} ====`);
  });
});
