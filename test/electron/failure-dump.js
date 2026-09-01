// Mocha --require plugin for deployment mode: on a failed test, record what the
// page actually looked like.
//
// Diagnostic scaffolding, not part of the mode. It exists for one open
// question. ReferenceColumns' "should render first items when opening empty
// cell" fails on windows and nowhere else: it clicks an empty School cell,
// presses Enter, and reads the reference editor's dropdown, and the *Color*
// column's items come back. Three mechanisms fit the log equally well, and they
// call for different fixes:
//
//   - the cursor never reached the School cell, so Enter reopened the editor on
//     the cell the previous step left it on;
//   - getCell() resolved the wrong cell, which the test cannot notice because
//     its only check on it is that the cell is empty, and the wrong cell is
//     empty too;
//   - a menu belonging to the closed Color editor was still in the page.
//
// The cursor's column and row at the moment of the read separates them, and the
// cursor does not move on its own, so reading it after the fact is sound.
//
// Two snapshots are taken, because they answer different questions. The one at
// the failed read is the state the assertion actually saw. The one in afterEach
// is a few hundred milliseconds later -- upstream's own failure hooks run in
// between -- so comparing them shows whether a wrong list was a lasting state or
// one that resolved itself, which is the difference between a stale read and a
// wrong editor.
//
// Delete this file, and its --require in scripts/test-electron.js, once the
// question is answered.

const fs = require('fs');
const path = require('path');

const DIR = process.env.GRIST_TEST_DUMP_DIR;

// Runs in the browser. Reports the cursor's column and row, what dropdowns are
// present and which search text each was built for, and where the keyboard
// focus is -- the things that tell the mechanisms apart.
function probe() {
  const text = (el) => (el && el.innerText || '').trim().slice(0, 40);

  const section = document.querySelector('.active_section');
  const headers = section ?
    Array.from(section.querySelectorAll('.column_name'), (el) => text(el)) : [];

  let cursor = null;
  const marker = section && section.querySelector('.has_cursor');
  const field = marker && marker.closest('.field');
  if (field) {
    const row = field.closest('.record');
    const index = row ? Array.prototype.indexOf.call(row.children, field) : -1;
    const rowNum = row && row.parentElement ?
      text(row.parentElement.querySelector('.gridview_data_row_num')) : null;
    cursor = {column: headers[index] ?? `#${index}`, index, rowNum, text: text(field)};
  }

  const menus = Array.from(document.querySelectorAll('.test-autocomplete'), (menu) => ({
    searchText: menu.getAttribute('data-ac-search-text'),
    items: Array.from(menu.querySelectorAll('li'), (li) => text(li)).slice(0, 4),
  }));

  const active = document.activeElement;
  return {
    cursor,
    menus,
    headers,
    editorOpen: Boolean(document.querySelector('.cell_editor, .celleditor_cursor_editor')),
    activeElement: active ? `${active.tagName.toLowerCase()}.${active.className}`.slice(0, 60) : null,
  };
}

let lastRead = null;

async function snapshot() {
  const {driver} = require('mocha-webdriver');
  return await driver.executeScript(probe);
}

// Records the state at each dropdown read, so the failing assertion's own view
// of the page is kept and not just the view a moment later.
//
// Patched from a root beforeAll rather than at load: by then mocha has loaded
// the test files, so gristUtils is imported and its helpers are bound, and this
// cannot disturb the import ordering that deployment-timeouts.js depends on.
function watchReads() {
  const gu = require(path.resolve(
    __dirname, '../../core/_build/test/nbrowser/gristUtils'));
  const orig = gu.autocomplete.getOptions;
  gu.autocomplete.getOptions = async function(...args) {
    const options = await orig.apply(this, args);
    try {
      lastRead = {searchTextAsked: args[0] ?? null, options, state: await snapshot()};
    } catch (err) {
      lastRead = {searchTextAsked: args[0] ?? null, options, error: String(err.message || err)};
    }
    return options;
  };
}

exports.mochaHooks = {
  beforeAll() {
    if (!DIR) { return; }
    // A dump that cannot be set up must not stop the tests from running.
    try { watchReads(); } catch (err) {
      console.log(`[failure dump: not watching reads: ${err.message}]`);
    }
  },

  beforeEach() {
    lastRead = null;
  },

  async afterEach() {
    const test = this.currentTest;
    if (!DIR || !test || test.state !== 'failed') { return; }

    const {driver} = require('mocha-webdriver');
    const name = test.fullTitle().replace(/[^A-Za-z0-9]+/g, '-').slice(0, 80);
    try {
      const atFailure = await snapshot();
      fs.mkdirSync(DIR, {recursive: true});
      fs.writeFileSync(path.resolve(DIR, `failure-${name}.json`),
        JSON.stringify({test: test.fullTitle(), atRead: lastRead, atFailure}, null, 2));
      await driver.saveScreenshot(`failure-${name}-{N}.png`, DIR);
    } catch (err) {
      // A dump that fails must not turn one failure into two.
      console.log(`[failure dump skipped: ${err.message}]`);
    }
  },
};
