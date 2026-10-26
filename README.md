# n3xn OS v2

Windows 11–style virtual operating system that runs entirely in the browser.

Rebuilt from the original single-file `n3xn_OS` into a **multi-file modular project** with:

- **Fluent Design UI** matching modern Windows 11 (taskbar, Start, acrylic, snap-ready windows)
- **Strict URL cloaking** — when enabled, real URLs never appear in the omnibox, tab titles, window titles, menus, or tooltips
- **Real WebAssembly** module for search scoring / arithmetic (with pure-JS fallback)
- **Working apps system** — built-in Edge, File Explorer, Settings, Notepad, Calculator, Store + installable web apps
- **IndexedDB persistence** for settings and custom apps

## Structure

```
n3xn-os/
├── index.html
├── css/
│   ├── fluent.css      # design tokens + shell
│   ├── desktop.css     # Start, search, widgets, toasts
│   ├── windows.css     # window manager chrome
│   └── apps.css        # built-in app UIs
├── js/
│   ├── main.js         # bootstrap
│   ├── db.js           # IndexedDB
│   ├── cloak.js        # URL hiding (no leaks)
│   ├── window-manager.js
│   ├── apps.js         # registry + factories
│   └── wasm/
│       └── engine.js   # real WASM + fuzzy search
└── data/
    └── apps.json       # preinstalled apps
```

## Run

Serve the folder over HTTP (modules require a server):

```bash
# Python
python3 -m http.server 8080

# or Node
npx serve .
```

Open `http://localhost:8080`.

## URL cloaking

Settings → Privacy & Cloaking:

- **Permanently hide URLs** — omnibox shows a neutral origin; titles use the cloak name
- **Cloak title / favicon** — identity used when hiding
- **Anti-Blocksi** — stamps safe attributes on iframes

The cloak layer sanitizes any string that might contain a URL before it hits the DOM.

## Compared to win11.blueedge.me

| Feature              | win11.blueedge.me | n3xn OS v2          |
|----------------------|-------------------|---------------------|
| UI generation        | React             | Vanilla modules     |
| Real WASM            | No                | Yes                 |
| Strict URL hide      | Limited           | Designed in         |
| Installable web apps | Limited           | Full + Store        |
| Multi-file edit      | Build step        | Direct              |
| Persistence          | Partial           | IndexedDB           |

## License

Use freely for school / personal projects. Not affiliated with Microsoft.
