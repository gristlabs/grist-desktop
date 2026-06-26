const {assert} = require('chai');
const mw = require('mocha-webdriver');

const HOST = `http://localhost:${process.env.GRIST_PORT || 8585}`;

describe('Smoke', function () {
  this.timeout(60_000);

  it('reaches the home page', async function () {
    await mw.driver.get(HOST + '/');
    await mw.driver.wait(async () => /Grist/.test(await mw.driver.getTitle()), 30_000);
  });

  it('exposes the Grist API to anonymous sessions', async function () {
    const result = await mw.driver.executeAsyncScript(async function (cb) {
      try {
        const r = await fetch('/api/session/access/active', {credentials: 'include'});
        cb({status: r.status, body: await r.text()});
      } catch (e) { cb({error: String(e)}); }
    });
    assert.equal(result.status, 200, `got: ${JSON.stringify(result)}`);
    assert.equal(JSON.parse(result.body).user.email, 'anon@getgrist.com');
  });
});
