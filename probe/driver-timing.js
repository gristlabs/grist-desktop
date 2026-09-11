// Times the pieces of starting a headless Chrome session, with chromedriver's own verbose log
// for the internal breakdown. Run standalone, so nothing else is competing except by design.
const {Builder} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function once(i) {
  // --disable-build-check for the same reason the harness passes it: the packaged chromedriver
  // and the runner's Chrome are not always the same version.
  const service = new chrome.ServiceBuilder(require('chromedriver').path)
    .addArguments('--disable-build-check')
    .loggingTo(`probe-logs/chromedriver-${i}.log`).enableVerboseLogging();
  const opts = new chrome.Options().addArguments('--headless=new', '--no-sandbox');
  const t0 = Date.now();
  const driver = await new Builder().forBrowser('chrome')
    .setChromeService(service).setChromeOptions(opts).build();
  const t1 = Date.now();
  await driver.get('data:text/html,hello');
  const t2 = Date.now();
  await driver.quit();
  console.log(`DRIVERTIMING run=${i} session=${t1 - t0}ms firstPage=${t2 - t1}ms quit=${Date.now() - t2}ms`);
}

(async () => {
  for (let i = 1; i <= 5; i++) { await once(i); }
})().catch((e) => { console.error(e); process.exit(1); });
