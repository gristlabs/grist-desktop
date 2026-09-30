# Custom Widgets for Grist Desktop

Grist Desktop supports custom widgets — small HTML/JS applications
that appear in the "Custom" widget picker and can read and write
document data.  Widgets are installed as local plugins that work
fully offline.

**Contents:**
- [Quick start](#quick-start) — minimal hello-world in 5 minutes
- [Tutorial](#tutorial-build-an-info-card-widget) — build a real
  widget step by step
- [API cheat sheet](#api-cheat-sheet) — commonly used `grist.*` methods
- [Reference](#reference) — widget fields, manifest format,
  environment variables, troubleshooting

## Quick start

1. **Find your plugin directory.**  When Grist Desktop starts it logs:

   ```
   No plugins found in directory: /home/you/.grist/plugins
   ```

   That is where user-installed plugins live.  (The path is
   `$GRIST_USER_ROOT/plugins`; the default is `~/.grist` on
   Linux/macOS, `%APPDATA%\.grist` on Windows.)

2. **Create a folder** with three files:

   ```
   ~/.grist/plugins/my-widgets/
     manifest.yml
     widgets.json
     hello.html
   ```

   **manifest.yml**
   ```yaml
   name: My Widgets
   components:
     widgets: widgets.json
   ```

   **widgets.json**
   ```json
   [
     {
       "name": "Hello Widget",
       "url": "./hello.html",
       "widgetId": "my-org/hello-widget",
       "published": true,
       "accessLevel": "none"
     }
   ]
   ```

   **hello.html**
   ```html
   <!DOCTYPE html>
   <html>
   <body style="background: #e0ffe0; font-family: sans-serif; padding: 1em;">
     <h2>Hello from a local widget!</h2>
   </body>
   </html>
   ```

3. **Set the environment variable** `GRIST_TRUST_PLUGINS=1` before
   launching Grist Desktop.  (See [Trusted vs untrusted
   plugins](#trusted-vs-untrusted-plugins) for why this is needed.)

4. **Restart Grist Desktop.**  You should see:

   ```
   Found 2 valid plugins on the system
   PLUGIN installed/my-widgets -- /home/you/.grist/plugins/my-widgets
   ```

   Open a document, add a custom widget, and "Hello Widget" will
   appear in the picker.

---

## Tutorial: Build an Info Card widget

This section walks through building a widget that displays the
selected row as a styled card, with column mapping, persistent
options, and Grist theme support.

The finished code is in
[`examples/info-card-widget/`](../examples/info-card-widget/).

### Prerequisites

- Grist Desktop installed (or built from source — see README.md)
- A text editor
- Basic HTML/CSS/JavaScript knowledge

### Step 1: Create the plugin folder

```bash
mkdir -p ~/.grist/plugins/info-card
cd ~/.grist/plugins/info-card
```

### Step 2: Write the manifest

**manifest.yml**
```yaml
name: Info Card
components:
  widgets: widgets.json
```

### Step 3: Declare the widget

**widgets.json**
```json
[
  {
    "name": "Info Card",
    "url": "./index.html",
    "widgetId": "my-org/info-card",
    "published": true,
    "accessLevel": "read table",
    "renderAfterReady": true,
    "description": "Displays the selected record as a styled card."
  }
]
```

### Step 4: Set up the HTML skeleton

Create `index.html`.  This is the entire widget — HTML, CSS, and
JavaScript in one file.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  /* We'll add styles in the next step */
</style>
<script src="grist-plugin-api.js"></script>
</head>
<body>
  <div id="content">
    <p>Select a row to see its card.</p>
  </div>
  <script>
    // Widget logic goes here
  </script>
</body>
</html>
```

The `<script src="grist-plugin-api.js">` line loads the Grist plugin
API.  For offline use, copy it into your plugin folder:

```bash
# If you built grist-desktop from source:
cp core/static/grist-plugin-api.js ~/.grist/plugins/info-card/

# Or download it:
curl -o ~/.grist/plugins/info-card/grist-plugin-api.js \
  https://docs.getgrist.com/grist-plugin-api.js
```

### Step 5: Call grist.ready() with column mapping

The most important call in any widget is `grist.ready()`.  It tells
Grist the widget is loaded and declares what data it needs.

```javascript
grist.ready({
  requiredAccess: 'read table',
  columns: [
    { name: "Title",    type: "Any",     description: "Main heading (e.g. Name)" },
    { name: "Subtitle", type: "Any",     description: "Secondary line", optional: true },
    { name: "Detail_1", type: "Any",     description: "First detail field", optional: true },
    { name: "Detail_2", type: "Any",     description: "Second detail field", optional: true },
    { name: "Number_1", type: "Numeric", description: "First stat", optional: true },
    { name: "Number_2", type: "Numeric", description: "Second stat", optional: true },
  ],
});
```

The `columns` array defines the widget's **column mapping**.  When the
user adds this widget, Grist shows a configuration panel where they
pick which real table columns map to "Title", "Subtitle", etc.
Columns marked `optional: true` can be left unmapped.

### Step 6: Listen for row changes

When the user clicks a row, Grist fires the `onRecord` event with
the row's data and current column mappings.

Since record values will be inserted into the page, add a helper to
escape HTML so that cell content can't inject markup:

```javascript
function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function val(v) {
  if (v === null || v === undefined || v === '') return '\u2014';
  return escapeHtml(String(v));
}
```

Then use `val()` whenever rendering record data:

```javascript
grist.onRecord((record, mappings) => {
  if (!record) {
    document.getElementById('content').innerHTML =
      '<p>Select a row to see its card.</p>';
    return;
  }

  // Apply column mapping: translates real column names
  // to our widget names (Title, Subtitle, etc.)
  const r = grist.mapColumnNames(record) || record;

  document.getElementById('content').innerHTML = `
    <div class="card">
      <h1>${val(r.Title)}</h1>
      ${r.Subtitle ? '<p class="subtitle">' + val(r.Subtitle) + '</p>' : ''}
      ${r.Detail_1 !== undefined ? '<p>' + val(r.Detail_1) + '</p>' : ''}
      ${r.Detail_2 !== undefined ? '<p>' + val(r.Detail_2) + '</p>' : ''}
    </div>
  `;
});
```

`grist.mapColumnNames(record)` is the key helper.  It takes a row
with real column names like `{Name: "France", Continent: "Europe"}`
and returns one with widget names like `{Title: "France", Subtitle:
"Europe"}`, based on the user's mapping choices.  If required columns
aren't mapped yet it returns `null`, so we fall back to the raw
record.

### Step 7: Add number formatting

For numeric columns, add a compact formatter:

```javascript
function formatNumber(n) {
  if (n === null || n === undefined || n === '') return '\u2014';
  n = Number(n);
  if (isNaN(n)) return '\u2014';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}
```

Then use it when rendering:

```javascript
if (r.Number_1 !== undefined) {
  html += `<div class="stat">${formatNumber(r.Number_1)}</div>`;
}
```

### Step 8: Add persistent widget options

Grist stores per-widget JSON options that persist across sessions.
Use this for user preferences like accent color or number format.

**Saving an option:**
```javascript
grist.setOption('accentColor', '#4e84d6');
```

**Restoring options on load:**
```javascript
grist.onOptions((options) => {
  if (options) {
    applyAccentColor(options.accentColor);
  }
});
```

**Adding a configuration panel:**

Pass `onEditOptions` to `grist.ready()` to enable the gear icon in
the widget header:

```javascript
grist.ready({
  requiredAccess: 'read table',
  columns: [ /* ... */ ],
  onEditOptions: () => {
    document.getElementById('options-panel').classList.toggle('open');
  },
});
```

When the user clicks the gear icon, Grist calls your `onEditOptions`
handler.  Build whatever settings UI you want and call
`grist.setOption()` when values change.

### Step 9: Follow the Grist theme

Grist injects CSS custom properties into widget iframes so your
widget can match the app's theme (light or dark mode):

```css
:root {
  --card-bg: var(--grist-theme-card-compact-widget-bg, #ffffff);
  --card-fg: var(--grist-theme-text, #262633);
  --card-muted: var(--grist-theme-text-light, #929299);
  --card-accent: var(--grist-theme-cursor, #16b378);
  --card-border: var(--grist-theme-widget-border, #e8e8e8);
}

body {
  background: var(--card-bg);
  color: var(--card-fg);
}
```

The second value in each `var()` is a fallback for when the widget is
opened outside of Grist (e.g. in a browser for testing).

### Step 10: Test it

Set `GRIST_TRUST_PLUGINS=1` and restart Grist Desktop.  Check the
terminal output for:

```
Found N valid plugins on the system
PLUGIN installed/info-card -- /home/you/.grist/plugins/info-card
```

Open any document, add a Custom widget, and select "Info Card".  Use
the column mapping panel on the right to wire up the columns.

**Testing with the World dataset:**

If you built grist-desktop from source, import
`core/test/fixtures/docs/World.grist` and open the Country table,
then map:

- **Title** → Name
- **Subtitle** → Continent
- **Detail_1** → Region
- **Detail_2** → GovernmentForm
- **Number_1** → Population
- **Number_2** → GNP

### The complete widget

The full `index.html` with all features (styles, column mapping,
number formatting, persistent options, theme support) is in
[`examples/info-card-widget/`](../examples/info-card-widget/).

---

## API cheat sheet

The most commonly used `grist.*` methods for widget development.

### Initialization
```javascript
grist.ready(options)             // Declare widget ready
```

### Reading data
```javascript
grist.onRecord(callback)         // Called when selected row changes
grist.onRecords(callback)        // Called when visible rows change
grist.onNewRecord(callback)      // Called when blank row selected
grist.fetchSelectedTable()       // Fetch all visible rows
grist.fetchSelectedRecord(rowId) // Fetch one row
grist.docApi.fetchTable(tableId) // Fetch any table by name
grist.docApi.listTables()        // List all tables
```

### Writing data
```javascript
grist.selectedTable.create(records)    // Add rows
grist.selectedTable.update(records)    // Modify rows (needs {id, ...fields})
grist.selectedTable.destroy(rowIds)    // Delete rows
grist.selectedTable.upsert(records)    // Insert or update
```

### Column mapping
```javascript
grist.mapColumnNames(record)           // Remap real columns → widget names
grist.mapColumnNamesBack(record)       // Remap widget names → real columns
```

### Widget options (persistent state)
```javascript
grist.onOptions(callback)        // Called when options change
grist.getOption(key)             // Read one option
grist.setOption(key, value)      // Write one option
grist.setOptions(obj)            // Write multiple options
grist.clearOptions()             // Delete all options
```

### Selection control
```javascript
grist.setSelectedRows(rowIds)    // Highlight specific rows
grist.setCursorPos(pos)          // Move cursor in linked section
```

### Access tokens (for REST API calls)
```javascript
const token = await grist.docApi.getAccessToken({readOnly: true});
// Use token.baseUrl and token.token to call /api/docs/...
```

---

## Reference

### Widget fields

Each entry in `widgets.json` supports:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Display name shown in the widget picker |
| `url` | yes | URL to the widget HTML.  Use `./filename.html` for files in the same plugin folder |
| `widgetId` | yes | Unique identifier (npm-style, e.g. `my-org/widget-name`) |
| `published` | no | Set `true` to show in the picker (default `false`) |
| `accessLevel` | no | `"none"` (default), `"read table"`, or `"full"` — how much document data the widget can access |
| `renderAfterReady` | no | If `true`, widget is hidden until it calls `grist.ready()` |
| `description` | no | Short description shown in the picker |
| `authors` | no | Array of `{ "name": "...", "url": "..." }` objects |

### The Grist Plugin API script

To interact with document data a widget must load the Grist plugin
API.  There are two ways:

```html
<!-- Online (always up to date) -->
<script src="https://docs.getgrist.com/grist-plugin-api.js"></script>

<!-- Offline (copy into your plugin folder) -->
<script src="./grist-plugin-api.js"></script>
```

For fully offline use, copy `grist-plugin-api.js` from
`core/static/` (if building from source) or download it from the URL
above.

### Manifest format

Every plugin folder needs a `manifest.yml` (or `manifest.json`).
For widgets-only plugins this is minimal:

```yaml
name: My Widgets
components:
  widgets: widgets.json
```

The full format supports more than just widgets — plugins can also
provide file parsers and import sources:

```yaml
name: My Plugin
version: 0.1.0
experimental: false          # if true, only loads when GRIST_EXPERIMENTAL_PLUGINS=1

components:
  widgets: widgets.json      # custom widget definitions
  safePython: sandbox/main.py   # Python code (runs in sandbox)
  safeBrowser: index.js         # JS code (runs in iframe)
  unsafeNode: backend.js        # Node.js code (runs in separate process)

contributions:
  fileParsers:
    - fileExtensions: ["myformat"]
      parseFile:
        component: safePython
        name: my_parser

  importSources:
    - label: "Import from My Service"
      importSource:
        component: safeBrowser
        name: "importer.html"
```

Most users will only need `components.widgets`.

### Plugin directory locations

Grist scans three categories of plugin directories:

| Kind | Path | Description |
|---|---|---|
| **builtIn** | `<app>/plugins/` | Core plugins shipped with Grist |
| **installed** | `~/.grist/plugins/` | User-installed plugins (put yours here) |
| **bundled** | `<app>/bundled/plugins/` | Bundled during build |

### Trusted vs untrusted plugins

By default Grist serves plugin content from a sandboxed origin
(`plugins.invalid`) so that plugin code cannot access Grist session
cookies.  This is important for hosted, multi-user deployments.

In Grist Desktop the `plugins.invalid` domain doesn't resolve to
anything, so plugin iframes fail to load.  Setting
`GRIST_TRUST_PLUGINS=1` tells Grist to serve plugins from the same
localhost origin as the main app.

This is safe for Grist Desktop because the server only listens on
localhost and there are no session cookies to protect.  **Do not set
`GRIST_TRUST_PLUGINS=1` on a multi-user Grist server** without
understanding the security implications.

Alternative approaches that avoid `GRIST_TRUST_PLUGINS`:

| Variable | Effect |
|---|---|
| `APP_UNTRUSTED_URL` | Explicit URL for plugin content (e.g. `http://localhost:9999`) |
| `GRIST_UNTRUSTED_PORT` | Serve plugins on a separate port on the same host |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `GRIST_USER_ROOT` | `~/.grist` | Parent of the `plugins/` directory |
| `GRIST_TRUST_PLUGINS` | (unset) | Serve plugins from same origin as app |
| `APP_UNTRUSTED_URL` | `http://plugins.invalid` | URL for plugin content |
| `GRIST_UNTRUSTED_PORT` | (unset) | Separate port for plugin content |
| `GRIST_EXPERIMENTAL_PLUGINS` | (unset) | Enable plugins marked `experimental: true` |
| `GRIST_WIDGET_LIST_URL` | (unset) | URL to a remote `widgets.json` to merge in |

### Troubleshooting

**Widget appears in picker but shows a blank iframe**
Most likely caused by the `plugins.invalid` domain.  Set
`GRIST_TRUST_PLUGINS=1` and restart.

**Plugin not detected at all**
Check that `manifest.yml` is valid YAML and is in the top level of
your plugin folder.  Look at the startup logs for errors — invalid
plugins are logged with details about what went wrong.

**Widget loads but can't read data**
Make sure `accessLevel` in `widgets.json` is set to `"read table"` or
`"full"`, and that the widget calls `grist.ready()` with a matching
`requiredAccess`.

## Next steps

- **Write-back widget**: Use `grist.selectedTable.update()` to build
  an editing widget (form, kanban board, etc.)
- **Multi-row widget**: Use `grist.onRecords()` instead of
  `grist.onRecord()` to build charts, galleries, or dashboards
- **Import plugin**: Add a `contributions.fileParsers` section to
  your manifest to support importing custom file formats
