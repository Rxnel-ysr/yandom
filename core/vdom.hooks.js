"use strict";
import { memorize, recall, remembered } from "./memory.js";
import { getHooks, setHooks } from "./state.js";
import { RenderVDOM, executeJobs, getTarget } from "./vdom.js";

let currentComponent = null,
    previewNode = { next: null },
    regression = false,
    handler = null,
    disableRerender = false,
    renderDebounce = null;

/**
 * 
 * @param {Object} hookNode 
 * @returns {Object}
 */
const nextNode = (hookNode) => {
    return hookNode.next = hookNode.next || { next: null }
}

const resetContext = () => {
    currentComponent.hookNode = currentComponent.hooks;
};

const triggerRerender = () => {
    if (handler) handler();
};

const setRegression = (bool) => (regression = bool);

const resetPreview = () => {
    previewNode = { next: null };
};

const trailMaker = (n = 1) => {
    let head = { next: null };
    let node = head;
    for (let i = 1; i <= n; i++) {
        node = node.next = { next: null };
    }

    return [head, node];
};

/**
 * Forgets the next n states in the hook chain
 * @param {number} [n=1] - Number of subsequent hook states to forget
 */
const resets = (n = 1) => {
    if (regression) return;

    if (!currentComponent) return;

    let hookNode = currentComponent.hookNode;
    if (!hookNode) return;

    for (let i = 1; i <= n && hookNode.next; i++) {
        hookNode.value = undefined;
        hookNode = hookNode.next;
    }
};

const allocate = (n) => {
    let start = currentComponent.hookNode;
    let actual = n - 1;

    if (actual > -1) {
        let [head, tail] = trailMaker(actual);
        tail.next = start.next;
        start.next = head;
    }
};

/**
 *
 * @param {any[]} array
 * @param {Boolean} recompute
 */
const overwrite = (array, recompute = false) => {
    let start = currentComponent.hookNode;
    array.map((e) => {
        if (recompute && typeof e?.recompute !== 'undefined') {
            e.recompute = true;
        }
        start.value = e;
        start = start.next;
    });
};

const orphan = (n) => {
    let start = currentComponent.hookNode;

    let end = start;

    for (let i = 1; i <= n; i++) {
        end = end.next = end.next;
    }
    start.next = undefined;
    start.next = end?.next || null;
};

const getData = (until) => {
    if (!currentComponent) return;

    const hookNode = currentComponent.hookNode;
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
};

const getCurrentHookNode = () => {
    if (!currentComponent) return;
    return currentComponent.hookNode;
}

/**
 * Component factory with hook tracking and optional memoization.
 *
 * @template {Record<string, any>} A
 * @template R
 *
 * @param {(args: A) => R} compFn
 * Component render function. Must be pure. Receives `args`.
 * 
 * @param {A} args
 * Args that will be passed on th `compFn`
 *
 * @param {{
 *   name?: string | null,
 *   hook?: number | null,
 *   remember: boolean,
 *   recompute: boolean,
 *   invalidAfter: number
 * }} [options]
 * Component configuration object.
 * - `name`: Optional component identifier.
 * - `hook`: Optional hooks count inside `compFn`.
 * - `remember`: Optional, decide should state retained or not.
 * - `recompute`: Optional, decide should empty dependency useEffect will recompute or no.
 * - `invalidAfter`: Optional, decide how many millisecond into invalidation of state stored, 0 to never invalidate.
 *
 * @returns {{
 *   render: () => R,
 *   isComp: true,
 *   compHooks: number,
 *   stringified: string,
 *   remember: boolean,
 *   recompute: boolean,
 *   invalidAfter: number
 * }}
 * Component descriptor object.
 */
const comp = (
    compFn,
    args = {},
    options = {
        name: null,
        hook: null,
        remember: false,
        recompute: false,
        invalidAfter: 500
    },
) => {
    let name;
    let counter = 0;
    let result = {
        render: () => compFn(args),
        isComp: true,
        remember: options.remember,
        recompute: options.recompute,
        invalidAfter: options.invalidAfter,
        stringified: null,
        compHooks: null
    };

    if (!options.hook && !options.name) {
        const previewHook = previewNode;

        regression = true;

        const vdom = compFn(args);

        result.vnode = vdom;

        regression = false;

        const nextExpectedNode = previewNode;
        let current = previewHook;

        while (current && current !== nextExpectedNode) {
            current = current.next;
            counter++;
        }
        name = JSON.stringify(vdom);
    } else if (options.name) {
        const stringifiedOption = JSON.stringify(options);

        if (!remembered('compHookCount_' + stringifiedOption)) {

            const previewHook = previewNode;

            regression = true;

            const vdom = compFn(args);

            result.vnode = vdom;

            regression = false;

            const nextExpectedNode = previewNode;
            let current = previewHook;

            while (current && current !== nextExpectedNode) {
                current = current.next;
                counter++;
            }
            memorize('compHookCount_' + stringifiedOption, counter, 0)

            name = options.name
        } else {
            name = options.name
            counter = recall('compHookCount_' + stringifiedOption)
        }
    } else {
        counter = options.hook;
        name = options.name;
    }
    result.stringified = name;
    result.compHooks = counter;

    return result;
};

/**
 * Destroys all remaining hook states from current position to end of chain
 */
const destroy = () => {
    if (!currentComponent) return;

    let hookNode = currentComponent.hookNode;
    if (!hookNode) return;

    while (hookNode.next) {
        hookNode.value = undefined;

        hookNode = hookNode.next;
    }
    currentComponent.hookNode = hookNode;
};

/**
 * A custom `useState` hook for reactive state management.
 *
 * @template T
 * @param {T} initial - The initial state value.
 * @returns {[T, (val: T | ((prev: T) => T)) => void]} A tuple: current state and a setter function.
 */
const useState = (initial) => {
    let hookNode = regression ? previewNode : currentComponent?.hookNode;

    if (regression) {
        previewNode = nextNode(hookNode);
        return [initial, () => { }];
    }

    if (typeof hookNode?.value === "undefined") {
        hookNode.value = initial;
    }

    const set = (val) => {
        hookNode.value = typeof val == "function" ? val(hookNode?.value) : val;

        if (!regression && !disableRerender) {
            currentComponent.rerender();
        }
    };

    currentComponent.hookNode = nextNode(hookNode);

    return [hookNode?.value, set];
};

const bulkSetState = (callback) => {
    if (regression) return;

    disableRerender = true;
    callback();
    disableRerender = false;

    if (!regression) {
        currentComponent.rerender();
    }
};

const useRef = (initial) => {
    let hookNode = regression ? previewNode : currentComponent.hookNode;

    if (regression) {
        previewNode = nextNode(hookNode);
        return { current: undefined };
    }

    if (typeof hookNode?.value === "undefined") {
        hookNode.value = { current: initial };
    }

    currentComponent.hookNode = nextNode(hookNode);
    return hookNode?.value;
};
/**
 * 
 * @param {Function} effect 
 * @param {String[]} deps 
 * @returns 
 */
const useEffect = (effect, deps = null) => {
    let hookNode = regression ? previewNode : currentComponent.hookNode;

    if (regression) {
        previewNode = nextNode(hookNode);
        return;
    }

    const hasNoDeps = !deps;

    const oldHook = hookNode?.value;
    const hasChangedDeps =
        typeof oldHook !== "undefined"
            ? (oldHook?.recompute || !deps.every((dep, j) => Object.is(dep, oldHook.deps[j])))
            : true;

    if (hasNoDeps || hasChangedDeps) {
        if (oldHook?.cleanup) { //&& !oldHook?.recompute) {
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

    currentComponent.hookNode = nextNode(hookNode);
};

/**
 * Memoizes the result of a computation based on dependency changes.
 *
 * @template T
 * @param {() => T} compute - Function that returns the computed value.
 * @param {readonly any[]} deps - Dependency list used to determine recomputation.
 * @returns {T} Memoized value.
 */
const useMemo = (compute, deps) => {
    let hookNode = regression ? previewNode : currentComponent.hookNode;

    if (regression) {
        previewNode = nextNode(hookNode);
        return undefined;
    }

    const prev = hookNode?.value;

    const hasNoDeps = !deps;
    const hasChanged = prev
        ? !deps.every((d, j) => Object.is(d, prev.deps[j]))
        : true;

    if (hasNoDeps || hasChanged) {
        const value = compute();
        hookNode.value = { value, deps };
        currentComponent.hookNode = hookNode.next = hookNode.next || {
            next: null,
        };
        return value;
    }

    currentComponent.hookNode = nextNode(hookNode);
    return prev.value;
};

function onReady(cb, delay = 1000) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(cb, delay);
        });
    } else {
        setTimeout(cb, delay);
    }
}
/**
 * Just wrapper for establishing connection to the ws server
 * @param {Object} config 
 * @param {Object} app 
 */
function hmr(config, app) {
    const wsPort = config?.ws?.port || 4040,
        wsHost = config?.ws?.host || location.hostname,
        main = config?.main || './src/app.js'

    const socket = new WebSocket(`ws://${wsHost}:${wsPort}`);
    socket.addEventListener('message', async ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.type === 'reload') {
            try {
                console.log(`[HMR]: ${msg.path}`);
                // window.setLoad(msg.path);
                const mod = await import(`${main}?t=` + msg.timestamp);
                if (mod.default) {
                    app.setRenderFn(mod.default)
                    app.rerender();
                }
            } catch (error) {
                console.log(error);
            }
        }
    });
}

/**
 *
 * @param {Element|Document|DocumentFragment|String} root
 * @returns
 */
function createRoot(root) {
    const comp = {
        /**
         * @param {Function} app 
         * @returns Object
         */
        render(app) {
            comp.renderFn = app
            currentComponent = comp;
            handler = comp.rerender;
            comp.rerender();
            return comp;
        },
        /**
         * 
         * @param {Object} any 
         * @returns Object
         */
        use(any) {
            if ('prepare' in any) {
                any.prepare()
            } else {
                throw Error("Incompatible mod type.")
            }
            return comp;
        },
        hooks: { next: null },
        hookNode: null,
        vdom: null,
        target: getTarget(root),
        renderFn: null,
        setRenderFn(fn) {
            comp.renderFn = fn;
        },
        rerender: () => requestAnimationFrame(() => {
            if (typeof renderDebounce == 'number') {
                clearTimeout(renderDebounce)
                renderDebounce = null
            }
            renderDebounce = setTimeout(() => {
                try {
                    resetContext();
                    resetPreview();
                    const newVNode = comp.renderFn();
                    if (!comp.vdom) {
                        comp.vdom = RenderVDOM.render(newVNode, comp.target);
                    } else {
                        comp.vdom = RenderVDOM.update(comp.target, comp.vdom, newVNode);
                    }

                } catch (error) {
                    comp.target.innerHTML = `<pre>${error.stack}</pre>`;
                    console.error(error);
                }

            }, 5);

            onReady(executeJobs, 300);
        }),
    };
    return comp;
}

export {
    resetContext,
    useState,
    useEffect,
    useMemo,
    useRef,
    createRoot,
    resets,
    getCurrentHookNode,
    destroy,
    comp,
    allocate,
    orphan,
    overwrite,
    setRegression,
    triggerRerender,
    getData,
    bulkSetState,
    hmr
};