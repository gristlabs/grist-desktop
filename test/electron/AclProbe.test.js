// PROBE ONLY - not for merge.
// The smallest slice of ActionLog's first test: log in, make a doc, POST the
// two ACL records. No browser interaction beyond login. If this drops the
// connection on windows, the browser side is irrelevant.

const gu = require('test/nbrowser/gristUtils');
const {setupTestSuite} = require('test/nbrowser/testUtils');

describe('AclProbe', function () {
  this.timeout(60_000);
  const cleanup = setupTestSuite();

  it('applies a deny-read rule over the API', async function () {
    const session = await gu.session().user('user1').login();
    console.log('PROBE: logged in');
    const docId = (await session.tempDoc(cleanup, 'Hello.grist')).id;
    console.log('PROBE: docId', docId);
    const api = session.createHomeApi();

    // Same payload as ActionLog's "should block history if access is not full".
    const t0 = Date.now();
    try {
      const result = await api.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'True', permissionsText: '-R',
        }],
      ]);
      console.log(`PROBE: apply OK after ${Date.now() - t0}ms:`, JSON.stringify(result.retValues));
    } catch (e) {
      console.log(`PROBE: apply FAILED after ${Date.now() - t0}ms:`, String(e));
      throw e;
    }
  });

  it('makes a plain API call for comparison', async function () {
    const session = await gu.session().user('user1').login();
    const api = session.createHomeApi();
    const t0 = Date.now();
    try {
      const orgs = await api.getOrgs();
      console.log(`PROBE: getOrgs OK after ${Date.now() - t0}ms, ${orgs.length} orgs`);
    } catch (e) {
      console.log(`PROBE: getOrgs FAILED after ${Date.now() - t0}ms:`, String(e));
      throw e;
    }
  });
});
