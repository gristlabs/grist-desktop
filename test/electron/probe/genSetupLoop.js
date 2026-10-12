"use strict";
// Writes looped copies of core's compiled CalendarView setup-modal suite:
//   CalendarSetupOrig.js  - pickSlot as on core main
//   CalendarSetupFixed.js - pickSlot looking only inside the open menu
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "../../../core/_build/test/nbrowser");
const rounds = Number(process.env.PROBE_ROUNDS || 15);
let src = fs.readFileSync(path.join(dir, "CalendarView.js"), "utf8");

const describeRe = /describe\("(CalendarView[^"]*)", function \(\) \{/g;
let found = 0;
src = src.replace(describeRe, (m, name) => {
  if (name !== "CalendarView setup modal") { return m.replace("describe(", "describe.skip("); }
  found++;
  return `for (let __i = 1; __i <= ${rounds}; __i++) describe("${name} #" + __i, function () {`;
});
if (found !== 1) { throw new Error("setup modal describe not found"); }

const pickRe = /await mocha_webdriver_1\.driver\.findContentWait\("\.test-select-row", label, 1000\)\.click\(\);/;
if (!pickRe.test(src)) { throw new Error("pickSlot line not found"); }
fs.writeFileSync(path.join(dir, "CalendarSetupOrig.js"), src);
fs.writeFileSync(path.join(dir, "CalendarSetupFixed.js"),
  src.replace(pickRe, `await gu.findOpenMenuItem(".test-select-row", label, 1000).click();`));
