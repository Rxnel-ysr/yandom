/// <reference path="../@types/vdom.hooks.js" />
"use strict";
import { value, valueComputed } from "../helper/helper.js";

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
 * A single mounted application root: owns the hook chain for the top level
 * component, the last rendered vdom tree, and re-render scheduling.
 */
class Root {
    /**
     * @param {Hooks} hooksRuntime
     * @param {import("./vdom.js").VDOM} vdom
     * @param {Element|Document|DocumentFragment|String} target
     */
    constructor(hooksRuntime, vdom, target) {
        /** @type {Hooks} */
        this.hooksRuntime = hooksRuntime;
        /** @type {import("./vdom.js").VDOM} */
        this.vdom = vdom;
        this.hooks = { next: null };
        this.hookNode = null;
        /** last rendered vdom tree (kept separate from `this.vdom`, the engine) */
        this.vdomTree = null;
        this.target = vdom.getTarget(target);
        /** @type {Function|null} */
        this.renderFn = null;
    }

    /**
     * @param {Function} app
     * @returns {Root}
     */
    render(app) {
        this.renderFn = app;
        this.hooksRuntime.currentComponent = this;
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
     * @param {import("./vdom.js").VDOM} vdom - engine instance exposing
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

    nextNode(hookNode) {
        return (hookNode.next = hookNode.next || { next: null });
    }

    resetContext() {
        this.currentComponent.hookNode = this.currentComponent.hooks;
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
        if (!this.currentComponent) return;

        let hookNode = this.currentComponent.hookNode;
        if (!hookNode) return;

        for (let i = 1; i <= n && hookNode.next; i++) {
            hookNode.value = undefined;
            hookNode = hookNode.next;
        }
    }

    allocate(n) {
        let start = this.currentComponent.hookNode;
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
        let start = this.currentComponent.hookNode;
        array.map((e) => {
            if (recompute && typeof e?.recompute !== "undefined") {
                e.recompute = true;
            }
            start.value = e;
            start = start.next;
        });
    }

    orphan(n) {
        let start = this.currentComponent.hookNode;
        let end = start;

        for (let i = 1; i <= n; i++) {
            end = end.next = end.next;
        }
        start.next = undefined;
        start.next = end?.next || null;
    }

    getData(until) {
        if (!this.currentComponent) return;

        const hookNode = this.currentComponent.hookNode;
        if (!hookNode) return;
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
        if (!this.currentComponent) return;
        return this.currentComponent.hookNode;
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
     * @returns {import("../@types/vdom.js").VNodeComponent}
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
        if (!this.currentComponent) return;

        let hookNode = this.currentComponent.hookNode;
        if (!hookNode) return;

        while (hookNode.next) {
            hookNode.value = undefined;
            hookNode = hookNode.next;
        }
        this.currentComponent.hookNode = hookNode;
    }

    /**
     * @template T
     * @param {T} initial
     * @param {Boolean} handleInputEvent
     * @returns {[T, (val: T | ((prev: T) => T)) => void]}
     */
    useState(initial, handleInputEvent = false) {
        let hookNode = this.currentComponent?.hookNode;

        if (typeof hookNode?.value === "undefined") {
            hookNode.value = initial;
        }

        const set = (val) => {
            if (handleInputEvent && val instanceof InputEvent) {
                val = val.target.value;
            }
            hookNode.value = typeof val == "function" ? val(hookNode?.value) : val;

            if (!this.disableRerender) {
                this.currentComponent.rerender();
            }
        };

        this.currentComponent.hookNode = this.nextNode(hookNode);

        return [hookNode?.value, set];
    }

    bulkSetState(callback) {
        this.disableRerender = true;
        callback();
        this.disableRerender = false;

        this.currentComponent.rerender();
    }

    useRef(initial) {
        let hookNode = this.currentComponent.hookNode;

        if (typeof hookNode?.value === "undefined") {
            hookNode.value = { current: initial };
        }

        this.currentComponent.hookNode = this.nextNode(hookNode);
        return hookNode?.value;
    }

    /**
     * @param {Function} effect
     * @param {any[]|null} deps
     */
    useEffect(effect, deps = null) {
        let hookNode = this.currentComponent.hookNode;

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

        this.currentComponent.hookNode = this.nextNode(hookNode);
    }

    /**
     * @template T
     * @param {() => T} compute
     * @param {readonly any[]} deps
     * @returns {T}
     */
    useMemo(compute, deps) {
        let hookNode = this.currentComponent.hookNode;

        const prev = hookNode?.value;

        const hasNoDeps = !deps;
        const hasChanged = prev
            ? !deps.every((d, j) => Object.is(d, prev.deps[j]))
            : true;

        if (hasNoDeps || hasChanged) {
            const value = compute();
            hookNode.value = { value, deps };
            this.currentComponent.hookNode = hookNode.next = hookNode.next || {
                next: null,
            };
            return value;
        }

        this.currentComponent.hookNode = this.nextNode(hookNode);
        return prev.value;
    }

    /**
     * @param {Element|Document|DocumentFragment|String} root
     * @returns {Root}
     */
    createRoot(root) {
        return new Root(this, this.vdom, root);
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

export { Hooks, Root };
export default Hooks;