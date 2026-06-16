const mw = require('mocha-webdriver');

describe('Probe', function () {
  this.timeout(60_000);
  it('reports home page state', async function () {
    const driver = mw.driver;
    await driver.get('http://localhost:8585/');
    await driver.sleep(2000);
    console.log('url:    ', await driver.getCurrentUrl());
    console.log('title:  ', await driver.getTitle());
    const probe = await driver.executeScript(`
      const has = sel => !!document.querySelector(sel);
      return {
        bodyStart: (document.body && document.body.innerText || '').slice(0, 300),
        hasIntroCreate: has('.test-intro-create-doc'),
        hasUserSignIn: has('.test-user-sign-in'),
        cookies: document.cookie,
      };
    `);
    console.log('probe:', JSON.stringify(probe, null, 2));
  });
});
