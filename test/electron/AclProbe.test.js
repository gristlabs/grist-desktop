// PROBE ONLY - not for merge.
// Round 2: characterize the race. Each case makes its own doc, waits a given
// time, then applies. A failing case retries once, to see whether the doc
// recovers. Nothing throws: we want every case to report.

const gu = require('test/nbrowser/gristUtils');
const {setupTestSuite} = require('test/nbrowser/testUtils');

const ACL_ACTIONS = [
  ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
  ['AddRecord', '_grist_ACLRules', null, {
    resource: -1, aclFormula: 'True', permissionsText: '-R',
  }],
];
const PLAIN_ACTIONS = [['AddRecord', 'Table1', null, {A: 'probe'}]];

function stamp() { return new Date().toISOString(); }

describe('AclProbe', function () {
  this.timeout(180_000);
  const cleanup = setupTestSuite();

  async function runCase(label, delayMs, actions) {
    const session = await gu.session().user('user1').login();
    const created = Date.now();
    const docId = (await session.tempDoc(cleanup, 'Hello.grist')).id;
    const api = session.createHomeApi();
    console.log(`PROBE ${label}: doc ${docId} ready ${Date.now() - created}ms after request, ${stamp()}`);
    if (delayMs) { await new Promise(r => setTimeout(r, delayMs)); }

    const t0 = Date.now();
    try {
      await api.applyUserActions(docId, actions);
      console.log(`RESULT ${label} OK ${Date.now() - t0}ms`);
      return;
    } catch (e) {
      console.log(`RESULT ${label} FAIL ${Date.now() - t0}ms ${String(e).slice(0, 140)}`);
    }
    const t1 = Date.now();
    try {
      await api.applyUserActions(docId, actions);
      console.log(`RETRY ${label} OK ${Date.now() - t1}ms`);
    } catch (e) {
      console.log(`RETRY ${label} FAIL ${Date.now() - t1}ms ${String(e).slice(0, 140)}`);
    }
  }

  // Does the failure depend on how soon the action follows doc creation?
  for (const delay of [0, 1000, 3000, 6000]) {
    it(`acl after ${delay}ms`, async function () {
      await runCase(`acl-${delay}ms`, delay, ACL_ACTIONS);
    });
  }

  // Is it access rules specifically, or any action at that moment?
  it('plain AddRecord immediately', async function () {
    await runCase('plain-0ms', 0, PLAIN_ACTIONS);
  });
});
