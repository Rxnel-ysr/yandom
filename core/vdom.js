/// <reference path="../@types/vdom.js" />
"use strict";
import {
    allocate,
    orphan,
    overwrite,
    getCurrentHookNode,
} from "./vdom.hooks.js";
import Memory from "./memory.js";

let jobs = [];
const memory = new Memory()
const memoryPrefix = "ComponentState_";
const _keys = {};
const getKey = (vnode) => vnode?.props?.key ?? null;
const hasKey = (vnode) => vnode && typeof vnode.props?.key !== "undefined";
const setKey = (key, vnode) => (_keys[key] = vnode.el);

/**
 * @param {any} v
 * @returns {v is VNode}
 */
function isVNode(v) {
    return (
        typeof v == "object" &&
        v?.isComp === false &&
        typeof v?.props == "object" &&
        typeof v?.tag == "string"
    );
}

/**
 * @param {any} v
 * @returns {v is VNodeComponent}
 */
function isVNodeComponent(v) {
    return (
        typeof v == "object" &&
        v?.isComp === true &&
        typeof v?.compHooks == "number" &&
        typeof v?.stringified == "string" &&
        typeof v?.remember == "boolean" &&
        typeof v?.recompute == "boolean" &&
        typeof v?.invalidAfter == "number" &&
        typeof v?.render == "function"
    );
}

/**
 *
 * @param {Function} fn
 */
function pushJob(fn) {
    jobs.push(fn);
}

function executeJobs() {
    for (const job of jobs) job();
    jobs.length = 0;
}

function filterFalsy(c) {
    return c !== false && c !== null && c !== undefined;
}

/**
 *
 * @param {Array} children
 * @returns
 */
const flattenChildren = (children) => children.flat(10).filter(filterFalsy);

/**
 * @param {string} tag
 * @param {object} props
 * @param  {VNodeChild[] | VNodeChild[][]} children
 * @returns {VNode}
 */
const createVNode = (tag, props = {}, ...children) => {
    let flatten = flattenChildren(children);
    let keyed = false;

    for (let i = 0; i < flatten.length; i++) {
        if (flatten[i]?.props?.key !== undefined) {
            keyed = true;
            break;
        }
    }

    if (keyed) {
        props.keyed = true;
    }

    return {
        tag,
        stringifiedProps: JSON.stringify(props),
        props,
        children: flatten.map(wrapPrimitive),
        isComp: false,
    };
};

function wrapPrimitive(node) {
    if (typeof node == "function") {
        node = node();
    }
    if (["string", "number"].includes(typeof node)) {
        const text = String(node);
        return {
            tag: "#text",
            text: text,
            children: [text],
            props: {},
            el: document.createTextNode(text),
            isComp: false,
        };
    }
    return node;
}

// Helper function to handle ref updates
const updateRef = (ref, value) => {
    if (!ref) return;

    try {
        if (typeof ref === "function") {
            ref(value);
        } else if (ref && typeof ref === "object" && "current" in ref) {
            ref.current = value;
        }
    } catch (e) {
        console.error("Error updating ref:", e);
    }
};

function cleanupVNode(node) {
    if (!node || typeof node !== "object") return;

    const el = node.el;

    // Clean up event listeners
    if (el && node.props) {
        for (const key in node.props) {
            const value = node.props[key];
            if (key.startsWith("on") && typeof value === "function") {
                const event = key.slice(2).toLowerCase();
                el.removeEventListener(event, value);
            }
        }
    }

    // Clean up custom cleanup hooks
    if (typeof node.props?.useCleanup === "function") {
        try {
            node.props.useCleanup(node.el);
        } catch (e) { }
    }

    const ref = node.props?.ref;
    if (ref && el?.isConnected === false) {
        updateRef(ref, null);
    }

    // Recursively clean up children
    if (Array.isArray(node.children)) {
        for (const child of node.children) cleanupVNode(child);
    }

    node.children = null;
    node.props = null;
}

const updateProps = (el, oldProps, newProps) => {
    const allProps = { ...oldProps, ...newProps };

    for (const key in allProps) {
        const oldValue = oldProps[key];
        const newValue = newProps[key];
        if (key === "keyed") continue;

        if (
            key === "useCleanup" &&
            (typeof oldValue === "function" || typeof newValue == "function")
        ) {
            continue;
        }

        if (key === "ref") {
            // Only update ref if it actually changed
            if (oldValue !== newValue) {
                // Remove old ref
                if (oldValue) {
                    updateRef(oldValue, null);
                }
                // Set new ref
                if (newValue && el) {
                    updateRef(newValue, el);
                }
            }
            continue;
        }

        if (newValue === undefined) {
            if (key === "class") {
                el.removeAttribute("class");
            } else if (key === "style") {
                el.style.cssText = "";
            } else if (key.startsWith("on") && typeof oldValue === "function") {
                el.removeEventListener(key.slice(2).toLowerCase(), oldValue);
            } else {
                el.removeAttribute(key);
            }
        } else if (oldValue !== newValue) {
            if (key === "class") {
                el.setAttribute(
                    "class",
                    Array.isArray(newValue)
                        ? newValue.filter(Boolean).join(" ")
                        : newValue,
                );
            } else if (key === "style") {
                if (typeof newValue === "string") {
                    el.style.cssText = newValue;
                } else {
                    el.style.cssText = "";
                    Object.assign(el.style, newValue);
                }
            } else if (key.startsWith("on") && typeof newValue === "function") {
                if (oldValue)
                    el.removeEventListener(key.slice(2).toLowerCase(), oldValue);
                el.addEventListener(key.slice(2).toLowerCase(), newValue);
            } else {
                el.setAttribute(key, newValue);
            }
        }
    }
    return newProps;
};

const renderVNode = (vnode, parentIsSvg = false) => {
    let work;
    if (vnode.isComp) {
        work = vnode.vdom = vnode.render();
    } else {
        work = vnode;
    }

    if (work.tag == "#text") {
        return work.el;
    }

    let isSvg = work.tag == "svg" || parentIsSvg;

    if (work.tag === "#fragment") {
        const start = document.createComment("fragment-start");
        const end = document.createComment("fragment-end");
        const frag = document.createDocumentFragment();

        work.el = start;
        work._end = end;

        frag.appendChild(start);
        for (let child of work.children || []) {
            const el = renderVNode(child);
            if (el) frag.appendChild(el);
        }
        frag.appendChild(end);

        return frag;
    }

    const el = isSvg
        ? document.createElementNS("http://www.w3.org/2000/svg", work.tag)
        : document.createElement(work.tag);

    const ref = work.props?.ref;
    if (ref && el) {
        updateRef(ref, el);
    }

    for (const [key, value] of Object.entries(work.props)) {
        if (key === "useCleanup" && typeof value === "function") continue;
        if (key === "ref" || key === "keyed") continue; // Already handled
        if (key === "key") setKey(value, work);

        if (key === "class") {
            if (isSvg) {
                el.setAttribute(
                    "class",
                    Array.isArray(value) ? value.filter(Boolean).join(" ") : value,
                );
            } else {
                el.className = Array.isArray(value)
                    ? value.filter(Boolean).join(" ")
                    : value;
            }
        } else if (key === "style") {
            if (typeof value === "string") {
                el.style.cssText = value;
            } else {
                Object.assign(el.style, value);
            }
        } else if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
            el.setAttribute(key, value);
        }
    }

    if (work.props.shadow) {
        const shadow = el.attachShadow({
            mode: work.props.shadow === true ? "open" : work.props.shadow,
        });
        el._shadow = shadow;
    }

    const children = Array.isArray(work.children)
        ? work.children
        : [work.children];

    for (let child of children) {
        if (child === null || child === undefined) continue;
        el.appendChild(renderVNode(child, isSvg));
    }

    work.el = el;
    return el;
};

const patchChildrenWithKeys = (parent, oldChildren, newChildren) => {
    const oldKeyMap = new Map();
    oldChildren.forEach((vnode) => oldKeyMap.set(vnode.props.key, vnode));

    const newKeySet = new Set();
    const updatedChildren = [];

    newChildren.forEach((newVNode, i) => {
        const key = newVNode.props.key;
        newKeySet.add(key);

        const oldVNode = oldKeyMap.get(key);
        if (oldVNode) {
            if (oldVNode.stringifiedProps != newVNode.stringifiedProps) {
                requestAnimationFrame(() => {
                    updateProps(oldVNode.el, oldVNode.props, newVNode.props);
                });
            }

            const oldChildren = oldVNode.children || [];
            const newChildren = newVNode.children || [];
            const max = Math.max(oldChildren.length, newChildren.length);

            for (let i = 0; i < max; i++) {
                patch(oldVNode.el, oldChildren[i], newChildren[i]);
            }

            newVNode.el = oldVNode.el;

            updatedChildren.push(newVNode);
        } else {
            const el = renderVNode(newVNode);
            newVNode.el = el;
            parent.insertBefore(el, parent.children[i] || null);
            updatedChildren.push(newVNode);
        }
    });

    oldChildren.forEach((oldVNode) => {
        if (!newKeySet.has(oldVNode.props.key)) {
            cleanupVNode(oldVNode);
            parent.removeChild(oldVNode.el);
        }
    });

    updatedChildren.forEach((vnode, i) => {
        const current = parent.children[i];
        if (vnode.el !== current) {
            parent.insertBefore(vnode.el, current);
        }
    });

    return updatedChildren;
};

/**
 * Handle component's state management
 *
 * @param {VNodeComponent} old
 * @param {VNodeComponent} replacement
 */
const handleComponentState = (old, replacement) => {
    let oldHookCount = old.compHooks,
        replacementHookCount = replacement.compHooks;

    let current = getCurrentHookNode();
    let store = new Array(oldHookCount);
    let storedMemory = [];
    if (
        replacement.remember &&
        memory.remembered(memoryPrefix + replacement.stringified)
    ) {
        storedMemory = memory.recall(memoryPrefix + replacement.stringified);
    }

    for (let i = 0; i < Math.max(oldHookCount, replacementHookCount); i++) {
        if (i > oldHookCount) {
            current = { next: current?.next };
        } else {
            if (old.remember) {
                store[i] = current.value;
            }
        }

        if (current.value?.cleanup) {
            try {
                current.value.cleanup();
            } catch (error) { }
        }

        current.value = undefined;

        if (replacement.remember) {
            current.value = storedMemory[i];
            if (
                replacement.recompute &&
                typeof current.value?.recompute !== "undefined"
            ) {
                current.value.recompute = true;
            }
        }

        current = current.next;
    }

    if (oldHookCount > replacementHookCount) {
        orphan(old.compHooks - replacement.compHooks);
    }

    memory.memorize(memoryPrefix + old.stringified, store, old.invalidAfter);
};

/**
 * Handle component's state retrieval
 *
 * @param {VNodeComponent} component
 */
const handleComponentRetrieval = (component) => {
    let data = new Array(component.compHooks);
    let current = getCurrentHookNode();

    for (let i = 0; i < component.compHooks; i++) {
        if (component.remember) {
            data[i] = current.value;
        }
        if (current.value?.cleanup) {
            try {
                current.value.cleanup();
            } catch (error) { }
        }
        current.value = undefined;
        current = current.next;
    }

    orphan(component.compHooks - 1);

    if (component.remember) {
        memory.memorize(
            memoryPrefix + component.stringified,
            data,
            component.invalidAfter,
        );
    }
};

/**
 * Handle component's state application
 *
 * @param {VNodeComponent} component
 */
const handleComponentApplyState = (component) => {
    allocate(component.compHooks - 1);
    if (component.remember && memory.remembered(memoryPrefix + component.stringified)) {
        overwrite(
            memory.recall(memoryPrefix + component.stringified),
            component.recompute,
        );
    }
};

/**
 *
 * @param {Element} parent
 * @param {VNode | VNodeComponent | undefined } old
 * @param {VNode | VNodeComponent | undefined } newOne
 * @returns {VNode | VNodeComponent | null}
 */
const handleComponent = (parent, old, newOne) => {
    if (isVNodeComponent(old) && isVNodeComponent(newOne)) {
        // console.log(old, newOne)
        if (old.stringified !== newOne.stringified) {
            handleComponentState(old, newOne);
        }

        newOne.vdom = patch(parent, old.vdom, newOne.render(), true);
        return newOne;
    } else if (isVNodeComponent(old) && !isVNodeComponent(newOne)) {
        handleComponentRetrieval(old);

        return patch(parent, old.vdom, newOne, true);
    } else if (!isVNodeComponent(old) && isVNodeComponent(newOne)) {
        handleComponentApplyState(newOne);

        newOne.vdom = patch(parent, old, newOne.render(), true);
        return newOne;
    } else {
        console.error("Impossible", old, newOne);
        return null;
    }
};

/**
 *
 * @param {Element} parent
 * @param {VNode | VNodeComponent | null | undefined} oldNode
 * @param {VNode | VNodeComponent | null | undefined} newNode
 * @param {boolean} skip
 * @returns {VNode | null}
 */
const patch = (parent, oldNode, newNode, skip = false, type = -1) => {
    if (oldNode == null && newNode == null) return null;

    if (!skip && (isVNodeComponent(oldNode) || isVNodeComponent(newNode))) {
        return handleComponent(parent, oldNode, newNode);
    }

    if (newNode == null || newNode == undefined) {
        if (oldNode?.tag == "#fragment") {
            let node = oldNode.el;
            const end = oldNode._end;

            if (end == undefined) {
                return null;
            }
            while (node && node !== end) {
                const next = node.nextSibling;
                parent.removeChild(node);
                // console.log(node);
                node = next;
            }

            return null;
        }
        cleanupVNode(oldNode);
        if (type > -1) parent[0].removeChild(oldNode.el);
        else parent.removeChild(oldNode.el);
        return null;
    }

    if (newNode.tag === "#text") {
        if (oldNode?.tag === "#text") {
            const oldText = oldNode.children?.[0];
            const newText = newNode.children?.[0];

            if (oldText !== newText && oldNode.el) {
                oldNode.el.nodeValue = newText;
            }
            newNode.el = oldNode?.el;
            return newNode;
        }

        if (oldNode?.tag == "#fragment") {
            let node = oldNode.el;
            const end = oldNode._end;

            if (end == undefined) {
                return null;
            }

            while (node && node !== end) {
                const next = node.nextSibling;
                parent.removeChild(node);
                node = next;
            }

            const newEl = renderVNode(newNode);
            parent.replaceChild(newEl, oldNode._end);
            newNode.el = newEl;

            return newNode;
        }

        const newEl = renderVNode(newNode);
        if (oldNode?.el) {
            parent.replaceChild(newEl, oldNode.el);
        } else {
            parent.appendChild(newEl);
        }

        newNode.el = newEl;
        return newNode;
    }

    if (oldNode == null) {
        if (newNode.tag === "#fragment") {
            const frag = renderVNode(newNode);
            parent.appendChild(frag);
            return newNode;
        }

        const el = renderVNode(newNode);
        if (type == 0) parent[1].after(el);
        else if (type > 0) parent[2].after(el);
        else parent.appendChild(el);
        newNode.el = el;
        return newNode;
    }

    if (oldNode.tag === "#fragment" && newNode.tag !== "#fragment") {
        let node = oldNode.el;
        const end = oldNode._end;

        if (end == undefined) {
            return;
        }

        while (node && node !== end) {
            const next = node.nextSibling;
            if (type > -1) parent[0].removeChild(node);
            else parent.removeChild(node)
            node = next;
        }

        const newEl = renderVNode(newNode);
        if (type > -1) parent[0].removeChild(node);
        else parent.replaceChild(newEl, oldNode._end)

        return newNode;
    }

    if (oldNode.tag == "#fragment" && newNode.tag == "#fragment") {
        patchFragmentChild(parent, oldNode, newNode);
        newNode.el = oldNode.el;
        newNode._end = oldNode._end;
        return newNode;
    }

    if (oldNode.tag !== newNode.tag) {
        cleanupVNode(oldNode);

        if (newNode.tag === "#fragment") {
            const frag = renderVNode(newNode);
            if (type > -1) parent[0].replaceChild(frag, oldNode.el);
            else   parent.replaceChild(frag, oldNode.el);
            return newNode;
        }

        const el = renderVNode(newNode);
        if (type > -1) parent[0].replaceChild(el, oldNode.el);
        else parent.replaceChild(el, oldNode.el);
        newNode.el = el;
        return newNode;
    }

    if (newNode.tag === "svg") {
        cleanupVNode(oldNode);

        const el = renderVNode(newNode, true);
        parent.replaceChild(el, oldNode.el);
        newNode.el = el;
        return newNode;
    }

    if (oldNode.stringifiedProps !== newNode.stringifiedProps) {
        requestAnimationFrame(() => {
            updateProps(oldNode.el, oldNode.props || {}, newNode.props || {});
        });
    }

    if (newNode.tag === "input" && oldNode.el?.value !== newNode.props?.value) {
        oldNode.el.value = newNode.props.value;
    }

    const oldChildren = oldNode.children || [];
    const newChildren = newNode.children || [];
    if (oldNode.props?.keyed && newNode.props?.keyed) {
        patchChildrenWithKeys(oldNode.el, oldChildren, newChildren);
    } else {
        const max = Math.max(oldChildren.length, newChildren.length);
        for (let i = 0; i < max; i++) {
            patch(
                oldNode?.tag === "#fragment" ? parent : oldNode.el,
                oldChildren[i],
                newChildren[i],
            );
        }
    }

    if (newNode.tag === "#fragment") {
        newNode._end = oldNode._end;
    }
    newNode.el = oldNode.el;
    return newNode;
};

const patchFragmentChild = (parent, oldFragment, newFragment) => {
    const start = oldFragment.el;
    const end = oldFragment._end;
    let current = parent;

    const max = Math.max(
        oldFragment.children.length,
        newFragment.children.length,
    );
    for (let i = 0; i < max; i++) {
        patch(
            [parent, start, current],
            oldFragment.children[i],
            newFragment.children[i],
            false,
            i,
        );
        if (i == 0) {
            current = newFragment.children[0].el;
        } else if (i > 0) {
            current = current?.nextSibling || end;
        }
    }

    return newFragment;
};

/**
 *
 */
const RenderVDOM = {
    createVNode,
    /**
     *
     * @param {VNode} vnode
     * @param {Element|string} container
     * @returns {VNode | null}
     */
    render(vnode, container) {
        container =
            typeof container === "string" ? getTarget(container) : container;
        container.innerHTML = "";
        const node =
            typeof vnode === "string"
                ? vnode
                : createVNode(vnode.tag, vnode.props, vnode.children);
        return patch(container, null, node);
    },
    /**
     *
     * @param {Element} container
     * @param {VNode|null} oldNode
     * @param {VNode|null} newNode
     * @returns {VNode|null}
     */
    update(container, oldNode, newNode) {
        return patch(container, oldNode, newNode);
    },
};

const __ = (tag, props = {}, ...children) => {
    return renderVNode(createVNode(tag, props, children));
};
/**
 *
 * @param {String|Document|Node} selector
 * @param {Document} scope
 * @returns
 */
const getTarget = (selector, scope = document) => {
    if (selector instanceof Node || selector instanceof Document) {
        return scope;
    }
    const target = scope.querySelector(selector);
    if (!target) throw new Error(`Target "${scope}" not found`);
    return target;
};

let customVDom = {};

/**
 * @param {string} tag
 * @param {(props: any, ...children: VNodeChild[])} resolver
 */
const registerVdom = (tag, resolver) => {
    customVDom[tag] = resolver;
};
/**
 * More direct way to create vnode
 */
function vnode(tag, props, ...children) {
    let propType = typeof props;

    if (propType === "string" || propType === "number") {
        return createVNode(tag, {}, props, children);
    } else if (Array.isArray(props)) {
        return createVNode(tag, {}, props, children);
    } else if (children.length == 0 && props?.tag) {
        return createVNode(tag, {}, props);
    } else {
        return createVNode(tag, props, children);
    }
}

/**
 * DSL-VDOM factory proxy.
 *
 * Provides:
 * - Dynamic HTML tag functions (e.g. `html.div(...)`)
 * - DOM mount helpers
 * - Shadow DOM mounting
 * - Fragment creation
 * - VDOM rendering passthrough
 *
 * @type {HTMLProxy}
 *
 * @example
 * html.div({ class: "box" }, "Hello")
 * html.mount(node, "#app")
 * html.$(child1, child2)
 */
const html = new Proxy(
    {},
    {
        /**
         * Trap for dynamic property access.
         *
         * @param {object} _
         * @param {string} tag
         *
         * @returns {Function}
         * Tag factory, action helper, or custom VDOM handler.
         */
        get: (_, tag) => {
            /**
             * Built-in DSL actions.
             */
            const actions = {
                /**
                 * Replace target children with element.
                 */
                mount: (el, selector, scope = document) =>
                    getTarget(selector, scope).replaceChildren(el),

                /**
                 * Append element to target.
                 */
                push: (el, selector, scope = document) =>
                    getTarget(selector, scope).appendChild(el),

                /**
                 * Mount into Shadow DOM (open).
                 * Reuses existing shadow root if present.
                 */
                mountShadow: (el, selector, scope = document) => {
                    const target = getTarget(selector, scope);
                    if (!target._shadow) {
                        target._shadow = target.attachShadow({ mode: "open" });
                    }
                    target._shadow.replaceChildren(el);
                    return target._shadow;
                },

                /**
                 * Create VNode from tag, props, and children.
                 * 
                 * @param {string} tag 
                 * @param {object} props 
                 * @param  {...VNodeChild[][]} children 
                 * @returns 
                 */
                element: (tag, props = {}, ...children) =>
                    createVNode(tag, props, children),

                /**
                 * Render Virtual DOM tree.
                 */
                vdom: RenderVDOM,

                /**
                 * Placeholder / noop hook.
                 */
                _: __,

                /**
                 * Fragment factory.
                 */
                $: (...children) => ({
                    tag: "#fragment",
                    children: flattenChildren(children).map(wrapPrimitive),
                    isComp: false,
                }),

                ...customVDom,
            };

            /**
             * Resolution order:
             * 1. Built-in actions
             * 2. Custom VDOM extensions
             * 3. HTML tag factory
             */
            return (
                actions[tag] ||
                /**
                 * HTML element VNode factory.
                 *
                 * @param {object|string|any[]} [props]
                 * @param {...any} children
                 *
                 * @returns {object} VNode
                 */
                ((props = {}, ...children) => vnode(tag, props, ...children))
            );
        },
    },
);

export {
    html,
    vnode,
    getTarget,
    getKey,
    updateProps,
    createVNode,
    renderVNode,
    cleanupVNode,
    RenderVDOM,
    patch,
    registerVdom,
    pushJob,
    executeJobs,
};
