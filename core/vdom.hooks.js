"use strict";
import { getHooks, setHooks } from "./state.js";
import { RenderVDOM, executeJobs, getTarget } from "./vdom.js";

let currentComponent = null,
    previewNode = { next: null },
    headPreview = previewNode,
    regression = false,
    handler = null,
    disableRerender = false;

const resetContext = () => {
    currentComponent.hookNode = currentComponent.hooks;
};

const triggerRerender = () => {
    if (handler) handler();
};

const setRegression = (bool) => (regression = bool);

/**
 * Forgets the next n states in the hook chain
 * @param {number} [n=1] - Number of subsequent hook states to forget
 */
const forgot = (n = 1) => {
    if (regression) return;

    if (!currentComponent) return;

    let hookNode = currentComponent.hookNode;
    if (!hookNode) return;

    for (let i = 1; i <= n && hookNode.next; i++) {
        delete hookNode?.value;
        hookNode = hookNode.next;
    }
};

const resetPreview = () => {
    if (previewNode) {
        previewNode = headPreview;
    }
    let current = headPreview;

    while (current?.next) {
        current.value = undefined;
        current = current.next;
    }
};

const trailMaker = (n = 1) => {
    let head = { next: null };
    let node = head;
    for (let i = 1; i <= n; i++) {
        node = node.next = { next: null };
    }

    return [head, node];
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
 */
const overwrite = (array) => {
    let start = currentComponent.hookNode;
    array.map((e) => {
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
    delete start.next;
    start.next = end?.next || null;
};

const retainData = (nChild, vdom) => {
    if (!currentComponent) return;

    const hookNode = currentComponent.hookNode;
    if (!hookNode) return;

    const key = JSON.stringify(vdom);
    let n = 0;

    if (!hookNode.retained) hookNode.retained = { data: {} };
    if (!hookNode.retained.data[key]) hookNode.retained.data[key] = [];

    let current = hookNode.next;
    while (n < nChild && current) {
        hookNode.retained.data[key].push(current?.value);
        current = current.next;
        n++;
    }
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

/**
 * Component factory with hook tracking and optional memoization.
 *
 * @template {Record<string, any>} A
 * @template R
 *
 * @param {(args: A) => R} compFn
 * Component render function. Must be pure. Receives `options.args`.
 *
 * @param {{
 *   name?: string | null,
 *   hook?: number | null,
 *   args?: A
 * }} [options]
 * Component configuration object.
 * - `name`: Optional component identifier.
 * - `hook`: Optional hooks count inside `compFn`.
 * - `args`: Arguments passed into `compFn`.
 *
 * @param {boolean} [remember=false]
 * Enables component result persistence (memoization / retention).
 *
 * @returns {{
 *   render: () => R,
 *   isComp: true,
 *   compHooks: number,
 *   stringified: string,
 *   remember: boolean
 * }}
 * Component descriptor object.
 */
const comp = (
    compFn,
    options = {
        name: null,
        hook: null,
        args: {}
    },
    remember = false
) => {
    let name;
    let counter = 0;
    let result = {
        render: () => compFn(options.args),
        isComp: true,
        remember
    };

    if (!options.hook && !options.name) {
        const previewHook = previewNode;

        regression = true;

        const vdom = compFn(options.args);

        result.vnode = vdom;

        regression = false;

        const nextExpectedNode = previewNode;
        let current = previewHook;

        while (current && current !== nextExpectedNode) {
            current = current.next;
            counter++;
        }
        name = JSON.stringify(vdom);
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
    let hookNode = regression ? previewNode : currentComponent.hookNode;

    if (regression) {
        previewNode = hookNode.next = hookNode.next || { next: null };
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

    currentComponent.hookNode = hookNode.next = hookNode.next || { next: null };

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
        previewNode = hookNode.next = hookNode.next || { next: null };
        return { current: undefined };
    }

    if (typeof hookNode?.value === "undefined") {
        hookNode.value = { current: initial };
    }

    currentComponent.hookNode = hookNode.next = hookNode.next || { next: null };
    return hookNode?.value;
};

const useEffect = (effect, deps) => {
    let hookNode = regression ? previewNode : currentComponent.hookNode;

    if (regression) {
        previewNode = hookNode.next = hookNode.next || { next: null };
        return;
    }

    const hasNoDeps = !deps;

    const oldHook = hookNode?.value;
    const hasChangedDeps =
        typeof oldHook !== "undefined"
            ? !deps.every((dep, j) => Object.is(dep, oldHook.deps[j]))
            : true;

    if (hasNoDeps || hasChangedDeps) {
        if (oldHook?.cleanup) {
            queueMicrotask(() => {
                oldHook.cleanup?.();
            });
        }

        queueMicrotask(() => {
            const cleanup = effect();
            hookNode.value = { deps, cleanup };
        });
    } else {
        hookNode.value = oldHook;
    }

    currentComponent.hookNode = hookNode.next = hookNode.next || { next: null };
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
        previewNode = hookNode.next = hookNode.next || { next: null };
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

    currentComponent.hookNode = hookNode.next = hookNode.next || { next: null };
    return prev.value;
};

function onReady(cb, delay = 1000) {
    while (true) {
        if (document.readyState == "complete") {
            setTimeout(() => {
                cb();
            }, delay);
            break;
        }
    }
}
/**
 *
 * @param {Function} fn
 * @param {String} target
 * @param {String} id
 * @returns
 */
function createRoot(fn, target, id = "default") {
    const comp = {
        use: (any, callback) => {
            callback(any);
            return comp;
        },
        hooks: { next: null, ...getHooks(id) },
        hookNode: null,
        vdom: null,
        target: getTarget(target),
        renderFn: fn,
        setRenderFn: (fn) => (comp.renderFn = fn),
        rerender: () => {
            requestAnimationFrame(() => {
                try {
                    handler = comp.rerender;
                    currentComponent = comp;
                    resetContext();
                    resetPreview();
                    const newVNode = comp.renderFn();
                    if (!comp.vdom) {
                        comp.vdom = RenderVDOM.render(newVNode, comp.target);
                    } else {
                        comp.vdom = RenderVDOM.update(comp.target, comp.vdom, newVNode);
                    }
                    setHooks(id, comp.hooks);
                } catch (error) {
                    console.error(error);
                }
            });

            onReady(executeJobs, 300);
        },
    };
    comp.rerender();
    return comp;
}

export {
    resetContext,
    useState,
    useEffect,
    useMemo,
    useRef,
    createRoot,
    forgot,
    destroy,
    retainData,
    comp,
    allocate,
    orphan,
    overwrite,
    setRegression,
    triggerRerender,
    getData,
    bulkSetState,
};