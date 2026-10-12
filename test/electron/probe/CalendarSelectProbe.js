"use strict";
// Probe: why does the CalendarView setup modal's start dropdown stay open after a pick on macos-14?
// Copied into core/_build/test/nbrowser/ by the probe workflow. Never fails; logs PROBE lines.
const gu = require("./gristUtils");
const {setupTestSuite} = require("./testUtils");
const {driver} = require("mocha-webdriver");

const log = (tag, obj) => console.log(`PROBE ${tag} ${JSON.stringify(obj)}`);
const ROUNDS = Number(process.env.PROBE_ROUNDS || 60);

describe("CalendarSelectProbe", function() {
  this.timeout(1800000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, "Calendar.grist");
    await gu.sendActions([["AddColumn", "Table1", "DateOnly", {type: "Date"}]]);
  });

  // Records mousedown/mouseup/click targets, and whether a select-row click handler ran.
  const installTrace = () => driver.executeScript(`
    window.__ev = [];
    if (!window.__probeOn) {
      window.__probeOn = true;
      for (const type of ["pointerdown", "mousedown", "mouseup", "click", "focusin"]) {
        document.addEventListener(type, ev => {
          const t = ev.target;
          const row = t && t.closest && t.closest(".test-select-row");
          window.__ev.push([type, Math.round(performance.now()),
            t && (t.tagName + "." + String(t.className).split(" ").slice(0, 2).join(".")),
            row ? row.textContent.trim() : null,
            ev.clientX !== undefined ? [Math.round(ev.clientX), Math.round(ev.clientY)] : null]);
        }, true);
      }
    }
  `);

  // State of open menus and what sits at a slot button's centre.
  const state = (slot) => driver.executeScript(`
    const menus = [...document.querySelectorAll(".grist-floating-menu")];
    const btn = document.querySelector(".test-calendar-setup-${slot} .test-select-open");
    let atBtn = null;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      atBtn = e && (btn.contains(e) ? "self" : (e.tagName + "." + String(e.className).split(" ")[0]));
    }
    return {t: Math.round(performance.now()), menus: menus.length,
      rows: menus.map(m => [...m.querySelectorAll(".test-select-row")].map(r => r.textContent.trim())),
      menuRects: menus.map(m => { const r = m.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); }),
      active: document.activeElement && (document.activeElement.tagName + "." + String(document.activeElement.className).split(" ")[0]),
      atBtn};
  `);

  // The test's pickSlot, instrumented: logs where the row was, the events, and how long the menu took to close.
  async function pick(round, slot, label, nextSlot) {
    await installTrace();
    const btnText0 = await driver.find(`.test-calendar-setup-${slot} .test-select-open`).getText();
    await driver.find(`.test-calendar-setup-${slot} .test-select-open`).click();
    const row = await driver.findContentWait(".test-select-row", label, 1000);
    const rowRect = await row.getRect();
    const before = await state(nextSlot);
    let clickErr = null;
    try { await row.click(); } catch (e) { clickErr = e.name; }
    const after0 = await state(nextSlot);
    let closedAfter = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      const s = await state(nextSlot);
      if (s.menus === 0) { closedAfter = Date.now() - t0; break; }
      await driver.sleep(20);
    }
    const ev = await driver.executeScript("return window.__ev");
    const btnText1 = await driver.find(`.test-calendar-setup-${slot} .test-select-open`).getText();
    const bad = after0.menus > 0;
    log(bad ? "OPEN" : "ok", {round, slot, label: String(label), btnText0, btnText1, clickErr,
      rowRect: [rowRect.x, rowRect.y, rowRect.width, rowRect.height].map(Math.round),
      closedAfter, before, after0, ...(bad || clickErr ? {ev} : {evCount: ev.length})});
    if (closedAfter === null) {
      // Leave the modal usable for the next round.
      await driver.find("body").sendKeys("");  // Escape
      await gu.waitForMenuToClose(1000).catch(() => undefined);
    }
    return bad;
  }

  it("loops the setup-modal picks", async function() {
    const counts = {};
    const bump = (k, bad) => {
      counts[k] = counts[k] || {n: 0, open: 0};
      counts[k].n++;
      if (bad) { counts[k].open++; }
    };
    for (let round = 1; round <= ROUNDS; round++) {
      await gu.addNewSection(/Calendar/, /Table1/, {selectBy: /TABLE1/});
      await driver.findWait(".test-calendar-setup-start", 2000);
      // As the failing test: re-pick the default "Create new column", then go straight to End.
      bump("start=Create(same) first", await pick(round, "start", /Create new column/, "end"));
      bump("end=DateOnly(change)", await pick(round, "end", /DateOnly/, "title"));
      // Title also defaults to "Create new column": re-pick it, and a changing pick.
      bump("title=Create(same)", await pick(round, "title", /Create new column/, "end"));
      bump("title=Label(change)", await pick(round, "title", /Label/, "end"));
      // Start again, now not the first pick in the modal: change it, then back.
      bump("start=From(change)", await pick(round, "start", /From/, "end"));
      bump("start=Create(change)", await pick(round, "start", /Create new column/, "end"));
      bump("start=Create(same) later", await pick(round, "start", /Create new column/, "end"));
      await driver.find(".test-modal-cancel").click();
      await driver.wait(async () => !(await driver.find(".test-modal-cancel").isPresent()), 2000)
        .catch(() => undefined);
      // Drop the unmapped section so the page doesn't grow every round.
      await gu.undo();
      log("COUNTS", {round, counts});
    }
  });
});
