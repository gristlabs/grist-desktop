"use strict";
// Probe: why does CalendarView's drag test fail on macOS/Windows in upstream mode?
// Copied into core/_build/test/nbrowser/ by the probe workflow. Never fails; logs PROBE lines.
const gu = require("./gristUtils");
const {setupTestSuite} = require("./testUtils");
const {driver} = require("mocha-webdriver");
const moment = require("moment-timezone");

const DOC_TZ = "Europe/Warsaw";
const sec = (day, hour) =>
  moment.tz(`${day} ${String(hour).padStart(2, "0")}:00`, "YYYY-MM-DD HH:mm", DOC_TZ).unix();
const log = (tag, obj) => console.log(`PROBE ${tag} ${JSON.stringify(obj)}`);

describe("CalendarDragProbe", function() {
  this.timeout(300000);
  const cleanup = setupTestSuite();
  gu.bigScreen();

  let day, rowId;

  async function setMapping(name, value) {
    await driver.findWait(`.test-config-widget-mapping-for-${name}`, 2000);
    await gu.waitToPass(async () => {
      await driver.find(`.test-config-widget-mapping-for-${name} .test-select-open`).click();
      await driver.findWait(".grist-floating-menu", 500);
      await driver.findContentWait(".test-select-menu li", value, 500).click();
    });
    await gu.waitForServer();
  }

  const getEvent = () => driver.executeScript(
    "return window.gristCalendarView.getEventByTitle('DragMe')");

  const env = () => driver.executeScript(`return {
    inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight],
    screen: [screen.width, screen.height, screen.availWidth, screen.availHeight],
    dpr: devicePixelRatio, vv: window.visualViewport && visualViewport.scale,
    docEl: [document.documentElement.clientWidth, document.documentElement.clientHeight],
    ua: navigator.userAgent,
  }`);

  // Where the event is, what is under its centre and under the drop point, and an event trace.
  const snapshot = () => driver.executeScript(`
    const el = [...document.querySelectorAll("[data-event-id]")]
      .find(e => /DragMe/.test(e.textContent));
    if (!el) { return null; }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const desc = e => e ? (e.className && e.className.baseVal !== undefined ? e.tagName :
      (e.tagName + "." + String(e.className).split(" ").slice(0, 2).join("."))) : null;
    return {rect: [r.left, r.top, r.width, r.height].map(Math.round),
      atCentre: desc(document.elementFromPoint(cx, cy)),
      centreInside: el.contains(document.elementFromPoint(cx, cy)),
      atDrop: desc(document.elementFromPoint(cx, cy + 100))};
  `);

  const installTrace = () => driver.executeScript(`
    const t = window.__probeTrace = {counts: {}, first: {}, last: {}};
    for (const type of ["pointerdown", "mousedown", "pointermove", "mousemove", "pointerup", "mouseup"]) {
      document.addEventListener(type, ev => {
        t.counts[type] = (t.counts[type] || 0) + 1;
        const rec = [Math.round(ev.clientX), Math.round(ev.clientY), ev.buttons,
          ev.target && ev.target.className && String(ev.target.className).slice(0, 40)];
        if (!t.first[type]) { t.first[type] = rec; }
        t.last[type] = rec;
      }, true);
    }
  `);

  async function reset() {
    await gu.sendActions([["UpdateRecord", "Table1", rowId, {From: sec(day, 9), To: sec(day, 10)}]]);
    await gu.waitForServer();
    await driver.wait(async () => {
      const e = await getEvent();
      return e && e.startMs === startMs0;
    }, 3000).catch(() => undefined);
    const el = await driver.findContentWait("[data-event-id]", /DragMe/, 2000);
    await driver.executeScript("arguments[0].scrollIntoView({block: 'center', behavior: 'instant'})", el);
    await driver.sleep(300);
    return el;
  }

  let startMs0;

  before(async function() {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, "Calendar.grist");
    log("env-before-section", await env());
    await gu.addNewSection(/Calendar/, /Table1/, {selectBy: /TABLE1/});
    await driver.findWait(".test-calendar-setup-start", 2000);
    await driver.find(".test-modal-cancel").click();
    await gu.openWidgetPanel();
    await setMapping("startDate", /From/);
    await setMapping("endDate", /To/);
    await setMapping("title", /Label/);
    await setMapping("isAllDay", /IsFullDay/);
    await driver.find(".test-calendar-perspective-day").click();
    await driver.find(".test-calendar-today").click();
    for (let i = 0; i < 3; i++) { await driver.find(".test-calendar-next").click(); }
    day = moment(new Date(await driver.executeScript(
      "return window.gristCalendarView.getCalendarDate()"))).format("YYYY-MM-DD");
    await gu.sendActions([["AddRecord", "Table1", -1,
      {From: sec(day, 9), To: sec(day, 10), Label: "DragMe", IsFullDay: false}]]);
    await driver.findContentWait("[data-event-id]", /DragMe/, 2000);
    rowId = await driver.executeScript(`
      const table = window.gristDocPageModel.gristDoc.get().docData.getTable("Table1");
      return table.getRowIds().find(id => table.getValue(id, "Label") === "DragMe");`);
    startMs0 = (await getEvent()).startMs;
    log("env", await env());
    log("window-rect", await driver.manage().window().getRect().catch(e => String(e)));
    await installTrace();
  });

  const variants = {
    // The test's own gesture.
    asTest: el => driver.withActions(a => a
      .move({origin: el}).press()
      .move({origin: el, x: 0, y: 6}).pause(120)
      .move({origin: el, x: 0, y: 100}).pause(120)
      .release()),
    // Same, but from viewport coordinates of the element's centre.
    viewport: async el => {
      const r = await driver.executeScript(
        "const r = arguments[0].getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2];", el);
      const [x, y] = r.map(Math.round);
      await driver.withActions(a => a
        .move({origin: "viewport", x, y}).press()
        .move({origin: "viewport", x, y: y + 6}).pause(120)
        .move({origin: "viewport", x, y: y + 100}).pause(120)
        .release());
    },
    // The test's gesture in small steps with longer pauses.
    slowSteps: el => driver.withActions(a => {
      a.move({origin: el}).pause(150).press().pause(150);
      for (let dy = 5; dy <= 100; dy += 5) { a.move({origin: el, x: 0, y: dy, duration: 20}); }
      a.pause(300).release();
    }),
  };

  for (const [name, gesture] of Object.entries(variants)) {
    it(`drag variant ${name}`, async function() {
      let ok = 0;
      const rounds = 6;
      for (let i = 0; i < rounds; i++) {
        const el = await reset();
        const before = await snapshot();
        await driver.executeScript("const t = window.__probeTrace; t.counts = {}; t.first = {}; t.last = {};");
        await gesture(el);
        await gu.waitForServer();
        const soon = await getEvent();
        await driver.sleep(1000);
        const later = await getEvent();
        const moved = Boolean(later && later.startMs > startMs0);
        if (moved) { ok++; }
        log(`round ${name} ${i}`, {moved, movedSoon: Boolean(soon && soon.startMs > startMs0),
          deltaMin: later && (later.startMs - startMs0) / 60000, before,
          trace: await driver.executeScript("return window.__probeTrace"),
          popup: await driver.find(".toastui-calendar-popup-overlay, .test-record-card-popup-overlay")
            .isPresent().catch(() => false)});
        await driver.sendKeys(require("mocha-webdriver").Key.ESCAPE);
      }
      log(`summary ${name}`, {ok, rounds});
    });
  }
});
