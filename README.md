# yandom

Yet Another VDOM - A lightweight, hook-based virtual DOM library with a fluent proxy-based DSL — write UIs in plain JS, no JSX, no compiler.

## Table of Contents

- [yandom](#yandom)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [Core Concepts](#core-concepts)
  - [The `html` DSL](#the-html-dsl)
    - [Props](#props)
    - [Built-in DSL helpers](#built-in-dsl-helpers)
    - [Fragments](#fragments)
  - [Hooks](#hooks)
    - [`useState(initial, handleInputEvent?)`](#usestateinitial-handleinputevent)
    - [`useEffect(effect, deps?)`](#useeffecteffect-deps)
    - [`useMemo(compute, deps)`](#usememocompute-deps)
    - [`useRef(initial)`](#userefinitial)
    - [`bulkSetState(callback)`](#bulksetstatecallback)
  - [Components \& `comp()`](#components--comp)
  - [Fragments, Keys \& Refs](#fragments-keys--refs)
    - [Keyed lists](#keyed-lists)
    - [Refs](#refs)
  - [Memory System](#memory-system)
  - [Router](#router)
    - [Features](#features)
  - [Custom VDOM Extensions](#custom-vdom-extensions)
  - [Job Queue](#job-queue)
  - [Error Handling](#error-handling)
  - [License](#license)

---

## Installation

Just add this imports into your html

```html
<script type="importmap">
  {
      "imports": {
          "yandom": "https://cdn.jsdelivr.net/gh/rxnel-ysr/yandom@minified/index.js"
      }
  }
</script>

```

---

## Quick Start

```js
import { html, createRoot, useState } from 'yandom';

const App = () => {
  const [count, setCount] = useState(0);

  return html.div(
    html.h1(`Count: ${count}`),
    html.button({ onClick: () => setCount(c => c + 1) }, "Increment")
  );
};

createRoot('#app').render(App);
```

---

## Core Concepts

- **VNodes** are plain objects describing elements (`tag`, `props`, `children`).
- **Components** (created via `comp()`) are render functions with hook tracking attached.
- **`createRoot(target)`** sets up a render loop. Calling `.render(App)` performs the initial render; subsequent state updates trigger `rerender()` automatically.
- Rendering is **debounced** via `requestAnimationFrame` + a short `setTimeout`, so multiple state updates in the same tick batch into a single re-render.

---

## The `html` DSL

`html` is a Proxy — any property access becomes a VNode factory for that tag name:

```js
html.div({ class: "container" },
  html.h1("Title"),
  html.p("Some text"),
  html.ul(
    html.li("Item 1"),
    html.li("Item 2")
  )
);
```

### Props

- `class` — string or array (falsy values filtered out)
- `style` — string (`cssText`) or object (applied via `Object.assign`)
- `onX` handlers — any prop starting with `on` + function becomes an event listener (`onClick` → `click`)
- `ref` — function or `{ current }` object, updated automatically on mount/unmount
- `key` — required for keyed list reconciliation (see below)
- `shadow` — `true` (open) or `"closed"` to attach a shadow root to the element
- `useCleanup` — function called with the element when the node is removed

### Built-in DSL helpers

| Helper | Description |
| --- | --- |
| `html.mount(el, selector, scope?)` | Replace target's children with `el` |
| `html.push(el, selector, scope?)` | Append `el` to target |
| `html.mountShadow(el, selector, scope?)` | Mount `el` into target's shadow root (creates one if absent) |
| `html.$(...children)` | Create a fragment (`#fragment`) — renders children without a wrapper element |
| `html.element(tag, props, ...children)` | Explicit VNode creation, bypassing the proxy |
| `html._` | Alias for direct DOM-producing render (`renderVNode(createVNode(...))`) |
| `html.vdom` | Access to the underlying `RenderVDOM` object (`render`/`update`) |

### Fragments

```js
html.$(
  html.h1("Title"),
  html.p("No wrapper div around these siblings")
)
```

---

## Hooks

Hooks must be called inside a component's render function (one wrapped via `comp()`, or the root render function). Hook order must stay consistent between renders — same rules as React.

### `useState(initial, handleInputEvent?)`

```js
const [value, setValue] = useState(0);

// Functional update (recommended for anything depending on previous state)
setValue(prev => prev + 1);
```

Set `handleInputEvent = true` to auto-unwrap `InputEvent`:

```js
const [text, setText] = useState("", true);
html.input({ value: text, onInput: setText }) // setText receives the event directly
```

### `useEffect(effect, deps?)`

```js
useEffect(() => {
  const id = setInterval(() => console.log("tick"), 1000);
  return () => clearInterval(id); // cleanup
}, [someDep]);
```

- `deps = null` (omitted) → runs after every render
- `deps = []` → runs once (cleanup runs on unmount)
- Effects run via `queueMicrotask`, after the DOM patch for that render

### `useMemo(compute, deps)`

```js
const sorted = useMemo(() => items.slice().sort(), [items]);
```

Recomputes only when `deps` change (`Object.is` comparison per-element).

### `useRef(initial)`

```js
const inputRef = useRef(null);
html.input({ ref: inputRef })
// later: inputRef.current.focus()
```

Returns a stable `{ current: value }` object — same identity across re-renders.

### `bulkSetState(callback)`

Batch multiple `setState` calls into a single re-render:

```js
bulkSetState(() => {
  setA(1);
  setB(2);
  setC(3);
}); // only one re-render triggered
```

---

## Components & `comp()`

Wrap any render function to give it its own hook chain and lifecycle behavior:

```js
import { comp, html, useState } from 'yandom';

const Counter = ({ start }) => {
  const [count, setCount] = useState(start);
  return html.button({ onClick: () => setCount(c => c + 1) }, `Count: ${count}`);
};

// Usage inside another component's render:
comp(Counter, { start: 10 }, {
  name: "myCounter",     // optional identity string (auto-derived if omitted, but still better to be named)
  hook: 1,               // optional explicit hook count (auto-detected from source otherwise)
  remember: true,        // persist hook state across unmount/remount via Memory
  recompute: false,      // force zero-dep useEffect to re-run when remounted with remembered state
  invalidAfter: 60000,   // ms before remembered state expires (0 = never)
});
```

**Notes:**

- Hook count is auto-detected by scanning the function source for `useState(`, `useEffect(`, `useRef(`, `useMemo(` calls — if you call hooks conditionally or in a loop (which you shouldn't), set `hook` explicitly.
- `remember: true` stores hook state in the global `Memory` instance keyed by the component's `stringified` identity, so swapping a component out and back in (e.g. via conditional rendering or routing) can restore its previous state.

---

## Fragments, Keys & Refs

### Keyed lists

Add a `key` prop to children of a list for efficient reconciliation (avoids full re-renders/re-creation when reordering):

```js
html.ul(
  ...items.map(item => html.li({ key: item.id }, item.name))
)
```

When any child in a children array has a `key`, the parent VNode is automatically marked `keyed`, switching to key-based diffing for that children list.

### Refs

```js
const boxRef = useRef(null);
html.div({ ref: boxRef }, "content");
// boxRef.current is the DOM element after render
```

Refs are automatically cleared (`null`) when their element is removed from the DOM.

---

## Memory System

`yandom` includes a generic `Memory` class (used internally for `remember`-enabled components, and for the router's route cache). You can also use it directly:

```js
import { Memory } from 'yandom';

const memory = new Memory(/* autoCleanupInterval ms, default 300000 */);

memory.memorize('key', { some: 'data' }, /* ttl ms */ 30000, (value, reason) => {
  console.log('invalidated:', reason); // 'expired' | 'manual' | 'validator' | 'cleanup' | 'dependency_removed'
});

memory.recall('key');       // returns value, or undefined if missing/expired
memory.remembered('key');   // boolean — exists and not expired
memory.forget('key');       // remove manually

// Validators — async functions that re-check validity on access
memory.registerValidator('key', async (value, def, map, entry) => {
  return value.isValid; // return false to invalidate
});

memory.unregisterValidator('key');

// Pattern-based validators: RegExp, function, or wildcard strings ("user:*", "*:cache")
memory.registerValidator(/^session:/, async (value) => checkSession(value));

await memory.findOrphans();     // entries not referenced by any other entry's value
await memory.cleanupExpired();  // manually trigger expiry cleanup
await memory.validateAll();     // re-run all validators immediately
memory.getStats();               // { totalEntries, expiredEntries, estimatedSizeBytes, validatorsCount, pendingValidations }
memory.clear();
memory.destroy();                // stops auto-cleanup, clears everything
```

Validation runs asynchronously and is automatically scheduled whenever entries are read, written, or removed — including a basic dependency-tracking heuristic (an entry "depends on" another if its serialized value contains the other's key).

---

## Router

```js
import { createRouter, lazyLoad, html, comp } from 'yandom';

const router = createRouter({
  routes: [
    { uri: "/", component: Home, title: "Home" },
    { uri: "/about", component: About, title: "About", static: true },
    { uri: "/users/:id", component: UserProfile },
    { uri: "/lazy", component: lazyLoad(() => import('./LazyPage.js')) },
    {
      uri: "/dashboard",
      component: Dashboard,
      children: [
        { uri: "settings", component: Settings } // -> /dashboard/settings
      ]
    }
  ],
  element: "a",          // tag used for routerLink (default "a")
  prefix: "",             // optional URI prefix for all routes
  cacheExp: 60000,        // default cache TTL per route (ms), overridable per-route via `cacheExp`
  defaultRoute: () => html.h1("404 Not Found"),
  placeholder: () => html.p("Loading..."),
  titleId: "page-title",  // element id to update document title into
});

const App = () => router.routerView();
createRoot('#app').use(router).render(App);
```

### Features

- **Radix-tree path matching** — efficient prefix-based route resolution
- **Dynamic params** — `:id` segments populate `router.getParams()`
- **Route caching** — rendered output cached per-path via `Memory`, with per-route `cacheExp`
- **`static: true`** — render once and reuse the result forever (skips re-render/caching logic)
- **Lazy-loaded routes** — `lazyLoad(() => import('./Page.js'))`; shows `placeholder` while loading, then re-renders
- **Nested routes** — `children` array, paths concatenated with parent's `uri`
- **`beforeEach((to, from, next) => {...})`** — navigation middleware (set via `router.beforeEach(...)`)
- **`routerLink`** custom element — registered automatically:

```js
html.routerLink({ to: "/about", scrollTo: "#section2", block: "start" }, "About")
```

Handles `pushState` navigation and optional smooth-scroll to a hash on the destination page.

- **Programmatic navigation:** `router.go('/some/path')`
- **Manual scroll:** `router.scrollToHash('#id', 'start')`

---

## Custom VDOM Extensions

Register your own tag-like DSL functions:

```js
import { registerVdom, html, createVNode } from 'yandom';

registerVdom('myWidget', (props = {}, ...children) => {
  return createVNode('div', { class: 'widget', ...props }, children);
});

html.myWidget({ id: "w1" }, "content"); // -> <div class="widget" id="w1">content</div>
```

Custom VDOM functions take priority over the default tag-factory fallback but are checked after built-in `html` actions (`mount`, `push`, `$`, etc.) — avoid naming collisions with those.

---

## Job Queue

For side effects that must run after the DOM has fully settled (e.g. scroll-to-hash after a lazy route resolves):

```js
import { pushJob } from 'yandom';

pushJob(() => {
  document.querySelector('#target')?.scrollIntoView();
});
```

Queued jobs run via `executeJobs()`, called automatically ~300ms after each render (via `onReady`).

---

## Error Handling

If a component's render function throws, `createRoot(...).render()` catches it and displays the error stack directly in the target element:

```html
<pre>Error: ...stack trace...</pre>
```

This is intended for development — consider wrapping with your own error boundary component for production.

---

## License

MIT © 2026 Ronel

See the [LICENSE](LICENSE) file.
