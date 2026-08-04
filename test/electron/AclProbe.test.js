// PROBE ONLY - not for merge.
//
// Round 2. Three things to learn:
//   1. Is this a race? Repeat each case, report a rate, not a verdict.
//   2. Does waitForServer() explain why ActionLog passes alone? Run the same
//      work with and without it, changing nothing else.
//   3. Is it access rules, or any action at that moment?
// Nothing throws: every case must report even after the first failure.

const gu = require('test/nbrowser/gristUtils');
const {setupTestSuite} = require('test/nbrowser/testUtils');

const REPS = Number(process.env.PROBE_REPS || 5);

const ACL_ACTIONS = [
  ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
  ['AddRecord', '_grist_ACLRules', null, {
    resource: -1, aclFormula: 'True', permissionsText: '-R',
  }],
];
const PLAIN_ACTIONS = [['AddRecord', 'Table1', null, {A: 'probe'}]];

const tally = {};
function record(label, ok) {
  tally[label] = tally[label] || {ok: 0, fail: 0};
  tally[label][ok ? 'ok' : 'fail']++;
}

describe('AclProbe', function () {
  this.timeout(60_000);
  const cleanup = setupTestSuite();

  // sync: what ActionLog's before() actually does after making its doc.
  async function runCase(label, {sync, actions}) {
    const session = await gu.session().user('user1').login();
    const docId = (await session.tempDoc(cleanup, 'Hello.grist')).id;
    const api = session.createHomeApi();
    if (sync) { await gu.dismissWelcomeTourIfNeeded(); }

    console.log(`PROBE ${label} doc=${docId} applying at ${new Date().toISOString()}`);
    const t0 = Date.now();
    try {
      await api.applyUserActions(docId, actions);
      console.log(`RESULT ${label} OK ${Date.now() - t0}ms`);
      record(label, true);
      return;
    } catch (e) {
      console.log(`RESULT ${label} FAIL ${Date.now() - t0}ms ${String(e).slice(0, 140)}`);
      record(label, false);
    }
    const t1 = Date.now();
    try {
      await api.applyUserActions(docId, actions);
      console.log(`RETRY ${label} OK ${Date.now() - t1}ms`);
    } catch (e) {
      console.log(`RETRY ${label} FAIL ${Date.now() - t1}ms ${String(e).slice(0, 140)}`);
    }
  }

  const CASES = {
    'acl-nosync': {sync: false, actions: ACL_ACTIONS},
    'acl-sync': {sync: true, actions: ACL_ACTIONS},
    'plain-nosync': {sync: false, actions: PLAIN_ACTIONS},
  };

  for (const [label, spec] of Object.entries(CASES)) {
    for (let i = 1; i <= REPS; i++) {
      it(`${label} #${i}`, async function () { await runCase(label, spec); });
    }
  }

  after(function () {
    console.log('==== PROBE TALLY ====');
    for (const [label, counts] of Object.entries(tally)) {
      console.log(`TALLY ${label}: ok=${counts.ok} fail=${counts.fail}`);
    }
  });
});
