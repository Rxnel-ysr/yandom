"use strict";
import { allocate, forgot, getData, orphan, overwrite } from "./vdom.hooks.js";
import { memorize, recall, remembered } from "./memory.js"

let jobs = [],
    memoryInvalidateAfter = 60000;
const _keys = {};
const getKey = (vnode) => vnode?.props?.key ?? null;
const hasKey = (vnode) => vnode && typeof vnode.props?.key !== "undefined";
const setKey = (key, vnode) => (_keys[key] = vnode.el);

/**
 *
 * @param {Function} fn
 */
const pushJob = (fn) => {
    jobs.push(fn);
};

const executeJobs =  () => {
    requestAnimationFrame(() => {
        for (const job of jobs) job();
        jobs.length = 0;
    });
};


const flattenChildren = (children) =>
    children
        .flat(512)
        .filter((c) => c !== false && c !== null && c !== undefined);

const createVNode = (tag, props = {}, ...children) => {
    return {
        tag,
        props,
        children: flattenChildren(children).map((v) => wrapPrimitive(v)),
        isComp: false,
    };
};

function wrapPrimitive(node) {
    if (["string", "number"].includes(typeof node)) {
        const text = String(node);
        return {
            tag: "#text",
            children: [text],
            props: {},
            el: document.createTextNode(text),
        };
    }
    return node;
}

// Helper function to handle ref updates
const updateRef = (ref, value) => {
    if (!ref) return;

    try {
        if (typeof ref === 'function') {
            ref(value);
        } else if (ref && typeof ref === 'object' && 'current' in ref) {
            ref.current = value;
        }
    } catch (e) {
        console.error('Error updating ref:', e);
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

    // Clean up refs - this is crucial!
    const ref = node.props?.ref || node.ref;
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

        if (
            key === "useCleanup" &&
            (typeof oldValue === "function" || typeof newValue == "function")
        ) {
            continue;
        }

        if (key === 'ref') {
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
                        : newValue
                );
            } else if (key === "style") {
                if (typeof newValue === "string") {
                    el.style.cssText = newValue;
                } else {
                    for (const style in oldValue || {}) {
                        if (!newValue || newValue[style] === undefined) {
                            el.style[style] = "";
                        }
                    }
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

    // Set ref after element is created but before children are added
    const ref = work.props?.ref;
    if (ref && el) {
        updateRef(ref, el);
    }

    for (const [key, value] of Object.entries(work.props)) {
        if (key === "useCleanup" && typeof value === "function") continue;
        if (key === "ref") continue; // Already handled above
        if (key === "key") setKey(value, work);

        if (key === "class") {
            if (isSvg) {
                el.setAttribute(
                    "class",
                    Array.isArray(value) ? value.filter(Boolean).join(" ") : value
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
        if (child === null || child === undefined || typeof child === "boolean")
            continue;

        if (child.tag == "#fragment") {
            for (let frag of child.children) {
                el.appendChild(renderVNode(frag, isSvg));
            }
            continue;
        }

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
            updateProps(oldVNode.el, oldVNode.props, newVNode.props);

            const oldChildren = oldVNode.children || [];
            const newChildren = newVNode.children || [];
            const max = Math.max(oldChildren.length, newChildren.length);

            for (let i = 0; i < max; i++) {
                patch(oldVNode.el, oldChildren[i], newChildren[i], i, oldVNode);
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
            isComp
            parent.insertBefore(vnode.el, current);
        }
    });

    return updatedChildren;
};

const handleComponent = (parent, old, newOne) => {
    if (old?.isComp && newOne?.isComp) {
        // console.log(old, newOne)
        if (old.stringified !== newOne.stringified) {
            if (old.compHooks > newOne.compHooks) {
                if (old.remember) {
                    memorize(old.stringified, getData(old.compHooks), memoryInvalidateAfter)
                }
                forgot(old.compHooks);
                orphan(old.compHooks - newOne.compHooks);
                if (newOne.remember && remembered(newOne.stringified)) {
                    overwrite(recall(newOne.stringified))
                }
            } else if (old.compHooks < newOne.compHooks) {
                if (old.remember) {
                    memorize(old.stringified, getData(old.compHooks), memoryInvalidateAfter)
                }
                forgot(old.compHooks);
                allocate(newOne.compHooks - old.compHooks);
                if (newOne.remember && remembered(newOne.stringified)) {
                    overwrite(recall(newOne.stringified))
                }
            } else {
                if (old.remember) {
                    memorize(old.stringified, getData(old.compHooks), memoryInvalidateAfter)
                }
                forgot(old.compHooks);
                if (newOne.remember && remembered(newOne.stringified)) {
                    overwrite(recall(newOne.stringified))
                }
            }
        }


        newOne.vdom = patch(parent, old.vdom, newOne.render(), true);
        return newOne;
    } else if (old?.isComp && !newOne?.isComp) {
        if (old.remember) {
            memorize(old.stringified, getData(old.compHooks), memoryInvalidateAfter)
        }
        forgot(old.compHooks);  
        orphan(old.compHooks - 1);

        return patch(parent, old.vdom, newOne, true);
    } else if (!old?.isComp && newOne?.isComp) {
        allocate(newOne.compHooks - 1);
        if (newOne.remember && remembered(newOne.stringified)) {
            overwrite(recall(newOne.stringified))
        }

        newOne.vdom = patch(parent, old, newOne.render(), true);
        return newOne;
    }
};

const patch = (parent, oldNode, newNode, skip = false) => {
    if (oldNode == null && newNode == null) return null;

    if (
        !skip &&
        ((oldNode?.isComp && newNode?.isComp) ||
            (oldNode?.isComp && !newNode?.isComp) ||
            (!oldNode?.isComp && newNode?.isComp))
    ) {
        return handleComponent(parent, oldNode, newNode);
    }

    if (newNode == null) {
        if (oldNode?.el) {
            cleanupVNode(oldNode);
            parent.removeChild(oldNode.el);
        }
        return null;
    }

    if (newNode.tag === "#text") {
        // console.log(oldNode,newNode)
        if (oldNode?.tag === "#text") {
            const oldText = oldNode.children?.[0];
            const newText = newNode.children?.[0];

            if (oldText !== newText && oldNode.el) {
                oldNode.el.nodeValue = newText;
            }
            newNode.el = oldNode?.el;
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

    if (oldNode?.tag === "#fragment" && newNode.tag !== "#fragment") {
        let node = oldNode.el;
        const end = oldNode._end;

        if (end == undefined) {
            return;
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

    if (oldNode == null) {
        const el = renderVNode(newNode);
        parent.appendChild(el);
        newNode.el = el;
        return newNode;
    }

    if (oldNode?.tag !== newNode?.tag) {
        cleanupVNode(oldNode);

        if (newNode.tag === "#fragment") {
            const frag = renderVNode(newNode);
            parent.replaceChild(frag, oldNode.el);
            return newNode;
        }

        const el = renderVNode(newNode);
        parent.replaceChild(el, oldNode.el);
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

    // Update props (including ref) before proceeding
    updateProps(oldNode.el, oldNode.props || {}, newNode.props || {});

    if (
        newNode.tag === "input" &&
        newNode.props?.value !== undefined &&
        oldNode.el.value !== newNode.props.value
    ) {
        oldNode.el.value = newNode.props.value;
    }

    const oldChildren = oldNode.children || [];
    const newChildren = newNode.children || [];
    if (
        oldChildren.some((node) => hasKey(node)) &&
        newChildren.some((node) => hasKey(node))
    ) {
        patchChildrenWithKeys(oldNode.el, oldChildren, newChildren);
    } else {
        const max = Math.max(oldChildren.length, newChildren.length);
        for (let i = 0; i < max; i++) {
            patch(
                oldNode?.tag === "#fragment" ? parent : oldNode.el,
                oldChildren[i],
                newChildren[i]
            );
        }
    }

    if (newNode.tag === "#fragment") {
        newNode._end = oldNode._end;
    }
    newNode.el = oldNode.el;
    return newNode;
};


const RenderVDOM = {
    createVNode,
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
    update(container, oldNode, newNode) {
        return patch(container, oldNode, newNode);
    },
};

const __ = (tag, props = {}, ...children) => {
    const vnode = createVNode(tag, props, children);
    return renderVNode(vnode);
};

const getTarget = (t, scope = document) => {
    if (t instanceof Node) {
        return t;
    }
    const target = scope.querySelector(t);
    if (!target) throw new Error(`Target "${t}" not found`);
    return target;
};

let customVdom = {};

const registerCustomVdom = (tag, resolver) => {
    customVdom[tag] = resolver;
};

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
 * @type {Proxy<Record<string, any>>}
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
             *
             * @type {{
             *   mount: (el: Node, selector: string, scope?: ParentNode) => void,
             *   push: (el: Node, selector: string, scope?: ParentNode) => void,
             *   mountShadow: (el: Node, selector: string, scope?: ParentNode) => ShadowRoot,
             *   vdom: Function,
             *   _: Function,
             *   $: (...children: any[]) => { tag: "#fragment", children: any[] }
             * }}
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
                    children: flattenChildren(children),
                }),

                ...customVdom,
            };

            /**
             * Resolution order:
             * 1. Built-in actions
             * 2. Custom VDOM extensions
             * 3. HTML tag factory
             */
            return (
                actions[tag] ||
                customVdom[tag] ||
                /**
                 * HTML element VNode factory.
                 *
                 * @param {object|string|any[]} [props]
                 * @param {...any} children
                 *
                 * @returns {object} VNode
                 */
                ((props = {}, ...children) => {
                    if (typeof props === "string") {
                        return createVNode(tag, {}, [props]);
                    } else if (Array.isArray(props)) {
                        return createVNode(tag, {}, props);
                    } else {
                        return createVNode(tag, props, children);
                    }
                })
            );
        },
    }
);


export {
    html,
    getTarget,
    getKey,
    updateProps,
    createVNode,
    renderVNode,
    cleanupVNode,
    RenderVDOM,
    patch,
    registerCustomVdom,
    pushJob,
    executeJobs,
};
