/// <reference path="../@types/vdom.hooks.js" />
/// <reference path="../@types/vdom.js" />
"use strict";
import { value, valueComputed } from "../helper/helper.js";
import VDOM from "./vdom.js";

function onReady(cb, delay = 1000) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            setTimeout(cb, delay);
        });
    } else {
        setTimeout(cb, delay);
    }
}

/**
 * Thrown when a hook (or any hook-chain utility) is used while no Root is
 * mounted / currently rendering.
 */
class RootError extends Error {
    /** @param {string} name */
    constructor(name) {
        super(
            `[hooks] "${name}" was called without an active root.\n` +
            `Hooks can only run while a Root is rendering. Start one first:\n\n` +
            `    const hooks = new Hooks(vdom);\n` +
            `    hooks.createRoot("#app").render(App);\n\n` +
            `If you are calling "${name}" outside of a component body ` +
            `(module scope, an event handler, a setTimeout callback, ...), ` +
            `move it inside the render function.`,
        );
        this.name = "RootError";
    }
}

/**
 * A single mounted application root: owns the hook chain for the top level
 * component, the last rendered vdom tree, and re-render scheduling.
 */
class Root {
    /**
     * @param {Hooks} hooksRuntime
     * @param {Element|Document|DocumentFragment|String} target
     */
    constructor(hooksRuntime, target) {
        /** @type {Hooks} */
        this.hooksRuntime = hooksRuntime;
        /** @type {VDOM} */
        this.vdom = hooksRuntime.vdom;
        this.hooks = { next: null };
        this.hookNode = null;
        /** last rendered vdom tree (kept separate from `this.vdom`, the engine) */
        this.vdomTree = null;
        this.target = this.vdom.getTarget(target);
        /** @type {Function|null} */
        this.renderFn = null;
    }

    /**
     * @param {Function} app
     * @returns {Root}
     */
    render(app) {
        this.renderFn = app;
        this.hooksRuntime.handler = () => this.rerender();
        this.rerender();
        return this;
    }

    /**
     * @param {Object} any
     * @returns {Root}
     */
    use(any) {
        if ("prepare" in any) {
            any.prepare(this);
        } else {
            throw Error("Incompatible mod type.");
        }
        return this;
    }

    /** @param {Function} fn */
    setRenderFn(fn) {
        this.renderFn = fn;
    }

    rerender() {
        requestAnimationFrame(() => {
            const runtime = this.hooksRuntime;

            if (typeof runtime.renderDebounce == "number") {
                clearTimeout(runtime.renderDebounce);
                runtime.renderDebounce = null;
            }

            runtime.renderDebounce = setTimeout(() => {
                try {
                    runtime.currentComponent = this;
                    runtime.resetContext();
                    const newVNode = this.renderFn();
                    if (!this.vdomTree) {
                        this.vdomTree = this.vdom.render(newVNode, this.target);
                    } else {
                        this.vdomTree = this.vdom.update(
                            this.target,
                            this.vdomTree,
                            newVNode,
                        );
                    }
                } catch (error) {
                    this.target.innerHTML = `<pre>${error.stack}</pre>`;
                    console.error(error);
                }
            }, 33);

            onReady(() => this.vdom.executeJobs(), 300);
        });
    }
}

/**
 * Hook runtime. Tracks the component currently being rendered and provides
 * useState/useEffect/useRef/useMemo plus the hook-chain bookkeeping
 * (allocate/orphan/overwrite) that the VDOM engine uses when reconciling
 * components.
 */
class Hooks {
    /**
     * @param {VDOM} vdom - engine instance exposing
     *  getTarget/render/update/executeJobs
     */
    constructor(vdom) {
        this.vdom = vdom;
        /** @type {Root|null} */
        this.currentComponent = null;
        /** @type {Function|null} */
        this.handler = null;
        this.disableRerender = false;
        this.renderDebounce = null;
    }

    /**
     * Guard: returns the active Root or throws.
     * @param {string} name - the caller, used in the error message
     * @returns {Root}
     */
    requireRoot(name) {
        if (!this.currentComponent) throw new RootError(name);
        return this.currentComponent;
    }

    /**
     * Guard: returns the current position in the active Root's hook chain,
     * lazily initialising it if the chain has not been walked yet.
     * @param {string} name - the caller, used in the error message
     */
    requireHookNode(name) {
        const root = this.requireRoot(name);
        if (!root.hookNode) root.hookNode = root.hooks;
        return root.hookNode;
    }

    nextNode(hookNode) {
        return (hookNode.next = hookNode.next || { next: null });
    }

    resetContext() {
        const root = this.requireRoot("resetContext");
        root.hookNode = root.hooks;
    }

    triggerRerender() {
        if (this.handler) this.handler();
    }

    trailMaker(n = 1) {
        let head = { next: null };
        let node = head;
        for (let i = 1; i <= n; i++) {
            node = node.next = { next: null };
        }
        return [head, node];
    }

    /**
     * Forgets the next n states in the hook chain
     * @param {number} [n=1]
     */
    resets(n = 1) {
        let hookNode = this.requireHookNode("resets");

        for (let i = 1; i <= n && hookNode.next; i++) {
            hookNode.value = undefined;
            hookNode = hookNode.next;
        }
    }

    allocate(n) {
        let start = this.requireHookNode("allocate");
        let actual = n - 1;

        if (actual > -1) {
            let [head, tail] = this.trailMaker(actual);
            tail.next = start.next;
            start.next = head;
        }
    }

    /**
     * @param {any[]} array
     * @param {Boolean} recompute
     */
    overwrite(array, recompute = false) {
        let start = this.requireHookNode("overwrite");
        array.map((e) => {
            if (recompute && typeof e?.recompute !== "undefined") {
                e.recompute = true;
            }
            start.value = e;
            start = start.next;
        });
    }

    orphan(n) {
        let start = this.requireHookNode("orphan");
        let end = start;

        for (let i = 1; i <= n; i++) {
            end = end.next = end.next;
        }
        start.next = undefined;
        start.next = end?.next || null;
    }

    getData(until) {
        const hookNode = this.requireHookNode("getData");
        let n = 0;
        let data = [];

        let current = hookNode;
        while (n < until && current) {
            data.push(current?.value || undefined);
            current = current?.next;
            n++;
        }

        return data;
    }

    getCurrentHookNode() {
        return this.requireHookNode("getCurrentHookNode");
    }

    /**
     * @param {string|Function} stringFn
     * @returns {number}
     */
    countHooks(stringFn) {
        return (
            stringFn.match(
                /(?<!\/\/[^\n]*)(useEffect\(|useState\(|useRef\(|useMemo\()/gm,
            ) || []
        ).length;
    }

    /**
     * Component factory with hook tracking and optional memoization.
     *
     * @param {Function} compFn
     * @param {object} args
     * @param {object|null} [options]
     * @returns {VNodeComponent}
     */
    comp(
        compFn,
        args = {},
        options = {
            name: null,
            hook: null,
            remember: false,
            recompute: false,
            invalidAfter: undefined,
        },
    ) {
        let name,
            counter = 0,
            result = {
                render: () => compFn(args),
                isComp: true,
                remember: value(options?.remember, false),
                recompute: value(options?.recompute, false),
                invalidAfter: value(options?.invalidAfter, 0),
                stringified: null,
                compHooks: null,
            };

        counter = valueComputed(options?.hook, () =>
            this.countHooks(compFn.toString()),
        );
        name = valueComputed(
            options?.name,
            () => this.comp.toString() + JSON.stringify(options),
        );

        result.stringified = name;
        result.compHooks = counter;

        return result;
    }

    /**
     * Destroys all remaining hook states from current position to end of chain
     */
    destroy() {
        const root = this.requireRoot("destroy");
        let hookNode = this.requireHookNode("destroy");

        while (hookNode.next) {
            hookNode.value = undefined;
            hookNode = hookNode.next;
        }
        root.hookNode = hookNode;
    }

    /**
     * @template T
     * @param {T} initial
     * @param {Boolean} handleInputEvent
     * @returns {[T, (val: T | ((prev: T) => T)) => void]}
     */
    useState(initial, handleInputEvent = false) {
        const root = this.requireRoot("useState");
        let hookNode = this.requireHookNode("useState");

        if (typeof hookNode.value === "undefined") {
            hookNode.value = initial;
        }

        const set = (val) => {
            if (handleInputEvent && val instanceof InputEvent) {
                val = val.target.value;
            }
            hookNode.value = typeof val == "function" ? val(hookNode?.value) : val;

            if (!this.disableRerender) {
                root.rerender();
            }
        };

        root.hookNode = this.nextNode(hookNode);

        return [hookNode?.value, set];
    }

    bulkSetState(callback) {
        const root = this.requireRoot("bulkSetState");

        this.disableRerender = true;
        try {
            callback();
        } finally {
            this.disableRerender = false;
        }

        root.rerender();
    }

    useRef(initial) {
        const root = this.requireRoot("useRef");
        let hookNode = this.requireHookNode("useRef");

        if (typeof hookNode.value === "undefined") {
            hookNode.value = { current: initial };
        }

        root.hookNode = this.nextNode(hookNode);
        return hookNode?.value;
    }

    /**
     * @param {Function} effect
     * @param {any[]|null} deps
     */
    useEffect(effect, deps = null) {
        const root = this.requireRoot("useEffect");
        let hookNode = this.requireHookNode("useEffect");

        const hasNoDeps = !deps;

        const oldHook = hookNode?.value;
        const hasChangedDeps =
            typeof oldHook !== "undefined"
                ? oldHook?.recompute ||
                !deps.every((dep, j) => Object.is(dep, oldHook.deps[j]))
                : true;

        if (hasNoDeps || hasChangedDeps) {
            if (oldHook?.cleanup) {
                queueMicrotask(() => {
                    oldHook.cleanup?.();
                });
            }

            queueMicrotask(() => {
                const cleanup = effect();
                hookNode.value = { deps, cleanup, recompute: false };
            });
        } else {
            hookNode.value = oldHook;
        }

        root.hookNode = this.nextNode(hookNode);
    }

    /**
     * @template T
     * @param {() => T} compute
     * @param {readonly any[]} deps
     * @returns {T}
     */
    useMemo(compute, deps) {
        const root = this.requireRoot("useMemo");
        let hookNode = this.requireHookNode("useMemo");

        const prev = hookNode?.value;

        const hasNoDeps = !deps;
        const hasChanged = prev
            ? !deps.every((d, j) => Object.is(d, prev.deps[j]))
            : true;

        if (hasNoDeps || hasChanged) {
            const value = compute();
            hookNode.value = { value, deps };
            root.hookNode = hookNode.next = hookNode.next || {
                next: null,
            };
            return value;
        }

        root.hookNode = this.nextNode(hookNode);
        return prev.value;
    }

    /**
     * Create a new Root for current Hooks
     * ___
     * Note: Overwriting old Root is initilized twice
     * @param {Element|Document|DocumentFragment|String} root
     * @returns {Root}
     */
    createRoot(root) {
        return this.currentComponent = new Root(this, root);
    }

    /**
     * Wrapper for establishing connection to the ws server
     * @param {Object} config
     * @param {Root} app
     * @param {boolean} enabled
     */
    hmr(config, app, enabled = false) {
        if (enabled) {
            const wsPort = config?.ws?.port || 4040,
                wsHost = config?.ws?.host || location.hostname,
                main = config?.main || "./src/app.js";

            const socket = new WebSocket(`ws://${wsHost}:${wsPort}`);
            socket.addEventListener("message", async ({ data }) => {
                const msg = JSON.parse(data);
                if (msg.type === "reload") {
                    try {
                        console.log(`[HMR]: ${msg.path}`);
                        const mod = await import(`${main}?t=` + msg.timestamp);
                        if (mod.default) {
                            app.setRenderFn(mod.default);
                            app.rerender();
                        }
                    } catch (error) {
                        console.log(error);
                    }
                }
            });
        }
    }
}

export { Hooks, Root, RootError };
export default Hooks;