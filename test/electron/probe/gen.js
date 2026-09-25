"use strict";
// Writes two instrumented copies of core's compiled CalendarView test:
//   CalendarViewTrace.js    - the whole suite, drag test logging each attempt
//   CalendarViewDragOnly.js - same, with every other test in the file skipped
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "../../../core/_build/test/nbrowser");
let src = fs.readFileSync(path.join(dir, "CalendarView.js"), "utf8");

const DRV = "mocha_webdriver_1.driver";
const anchor = `            await gu.sendActions([["UpdateRecord", "Table1", rowId,
                    { From: sec(day, 9), To: sec(day, 10) }]]);
`;
if (!src.includes(anchor)) { throw new Error("anchor 1 missing"); }
src = src.replace(anchor, anchor + `
            const __attempt = (global.__probeAttempt = (global.__probeAttempt || 0) + 1);
            const __stale = await eventEl.getRect().then(r => ({ok: true, r}), e => ({ok: false, e: e.name}));
            const __state = await ${DRV}.executeScript(\`
              const t = window.__probeTrace = {counts: {}, first: {}, last: {}};
              if (!window.__probeTraceOn) {
                window.__probeTraceOn = true;
                for (const type of ["pointerdown", "mousedown", "pointermove", "pointerup", "mouseup"]) {
                  document.addEventListener(type, ev => {
                    const t = window.__probeTrace;
                    t.counts[type] = (t.counts[type] || 0) + 1;
                    const rec = [Math.round(ev.clientX), Math.round(ev.clientY), ev.buttons,
                      String(ev.target && ev.target.className).slice(0, 50)];
                    if (!t.first[type]) { t.first[type] = rec; }
                    t.last[type] = rec;
                  }, true);
                }
              }
              const el = arguments[0];
              const fresh = [...document.querySelectorAll("[data-event-id]")].filter(e => /DragMe/.test(e.textContent));
              const r = el.getBoundingClientRect();
              const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
              const hit = document.elementFromPoint(cx, cy);
              return {connected: el.isConnected, freshCount: fresh.length, sameAsFresh: fresh[0] === el,
                rect: [r.left, r.top, r.width, r.height].map(Math.round),
                freshRect: fresh[0] && (b => [b.left, b.top, b.width, b.height].map(Math.round))(fresh[0].getBoundingClientRect()),
                hit: hit && (hit.tagName + "." + String(hit.className).slice(0, 50)), hitInside: el.contains(hit),
                inner: [innerWidth, innerHeight],
                overlays: [...document.querySelectorAll(".toastui-calendar-popup-overlay, .test-record-card-popup-overlay, .test-notifier-toast-wrapper, .grist-floating-menu, .test-modal-dialog")].map(e => e.className.slice(0, 60)),
                view: window.gristCalendarView.getViewName(), date: window.gristCalendarView.getCalendarDate(),
                event: window.gristCalendarView.getEventByTitle("DragMe")};
            \`, eventEl).catch(e => ({error: String(e)}));
            console.log("PROBE attempt " + __attempt + " pre " + JSON.stringify({stale: __stale, state: __state}));
`);

const anchor2 = `            const moved = await getEventByTitle("DragMe");
`;
if (!src.includes(anchor2)) { throw new Error("anchor 2 missing"); }
src = src.replace(anchor2, anchor2 + `
            console.log("PROBE attempt " + global.__probeAttempt + " post " + JSON.stringify({
              before, moved, later: await (async () => { await ${DRV}.sleep(1500); return getEventByTitle("DragMe"); })(),
              trace: await ${DRV}.executeScript("return window.__probeTrace").catch(e => String(e))}));
`);

fs.writeFileSync(path.join(dir, "CalendarViewTrace.js"), src);

// Drag-only: skip every other it() in the file.
const dragOnly = src.replace(/(\n\s+)it\("(?!moves an event)/g, '$1it.skip("');
fs.writeFileSync(path.join(dir, "CalendarViewDragOnly.js"), dragOnly);
// Fixed: the unmodified test, but waiting for the drag's write before asserting.
let fixed = fs.readFileSync(path.join(dir, "CalendarView.js"), "utf8");
const anchor3 = `            await gu.waitForServer();
            // The drag moved the event to a later time`;
if (!fixed.includes(anchor3)) { throw new Error("anchor 3 missing"); }
fixed = fixed.replace(anchor3, `            await gu.waitForServer();
            await ${DRV}.wait(async () => (await getEventByTitle("DragMe"))?.startMs > before.startMs, 3000)
              .catch(() => undefined);
            // The drag moved the event to a later time`);
fs.writeFileSync(path.join(dir, "CalendarViewFixed.js"), fixed);
console.log("wrote probe copies");
