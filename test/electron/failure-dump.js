// Mocha --require plugin: on a failed test, record what the page actually
// looked like.
//
// Diagnostic scaffolding, not part of the mode. It exists for one open
// question. ReferenceColumns' "should render first items when opening empty
// cell" fails on windows and nowhere else: it clicks an empty School cell,
// presses Enter, and reads the reference editor's dropdown, and what comes back
// is the *Color* column's items. Two mechanisms fit that equally well from the
// log alone, and they call for opposite fixes:
//
//   - the cursor never moved to the School cell, so Enter reopened the editor on
//     the Color cell the previous step left it on; or
//   - a menu belonging to the closed Color editor was still in the page, and the
//     read found it. gu.autocomplete.close() waits for .test-autocomplete to be
//     absent, which argues against this, but does not settle it.
//
// The page at the moment of failure separates them: whether the cursor is on
// School or on Color, and whether there is one dropdown or two. Delete this file
// (and its --require in scripts/test-electron.js) once that is known.

const fs = require('fs');
const path = require('path');

const DIR = process.env.GRIST_TEST_DUMP_DIR;

// Runs in the browser. Reports the cursor's column and row, what dropdowns are
// present and which search text each was built for, and where the keyboard
// focus is -- the three things that tell the mechanisms apart.
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

exports.mochaHooks = {
  async afterEach() {
    const test = this.currentTest;
    if (!DIR || !test || test.state !== 'failed') { return; }

    // Required lazily: at load time mocha-webdriver has no driver yet.
    const {driver} = require('mocha-webdriver');
    const name = test.fullTitle().replace(/[^A-Za-z0-9]+/g, '-').slice(0, 80);
    try {
      const dump = await driver.executeScript(probe);
      fs.mkdirSync(DIR, {recursive: true});
      fs.writeFileSync(path.resolve(DIR, `failure-${name}.json`),
        JSON.stringify({test: test.fullTitle(), ...dump}, null, 2));
      await driver.saveScreenshot(`failure-${name}-{N}.png`, DIR);
    } catch (err) {
      // A dump that fails must not turn one failure into two.
      console.log(`[failure dump skipped: ${err.message}]`);
    }
  },
};
