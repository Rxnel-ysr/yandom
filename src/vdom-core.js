/// <reference path="../@types/vdom.js" />
"use strict";
const BOOLEAN_PROPS = new Set([
    "allowfullscreen", "async", "autofocus",
    "autoplay", "checked", "controls",
    "default", "defer", "disabled",
    "formnovalidate", "hidden", "inert",
    "ismap", "itemscope", "loop",
    "multiple", "muted", "nomodule",
    "novalidate", "open", "playsinline",
    "readonly", "required", "reversed",
    "selected",
]);

/**
 * The VDOM rendering engine: virtual node creation, diffing/patching,
 * component (hook) reconciliation and the `html` DSL proxy all live here.
 */
class VDOMBASE {
    constructor() {
        /** @type {Function[]} */
        this.jobs = [];
        this._keys = {};
        /** @type {Record<string, VNodeFunction>} */
        this.customVDom = {};
        /** @type {Function|null} */
        this.renderFn = null;
        /** @type {VNode|null} */
        this.vdomTree = null;

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
        this.html = this._createHtmlProxy();
    }

    /**
     * 
     * @param {VNodeFunction} renderFn 
     */
    static create(renderFn, target) {
        const vdom = new VDOMBASE()
        vdom.renderFn = renderFn;

        return {
            ...vdom,
            render: () => { vdom.vdomTree = vdom.render(target, vdom.renderFn()); },
            update: () => { vdom.vdomTree = vdom.update(target, vdom.vdomTree, vdom.renderFn()) }
        }
    }

    // ---- static predicates -------------------------------------------------

    /**
     * @param {any} v
     * @returns {v is VNode}
     */
    static isVNode(v) {
        return (
            typeof v == "object" &&
            typeof v?.props == "object" &&
            typeof v?.tag == "string"
        );
    }

    // ---- vnode utilities -----------------------------------------------------

    getKey(vnode) {
        return vnode?.props?.key ?? null;
    }

    hasKey(vnode) {
        return vnode && typeof vnode.props?.key !== "undefined";
    }

    setKey(key, vnode) {
        this._keys[key] = vnode.el;
    }

    /** @param {Function} fn */
    pushJob(fn) {
        this.jobs.push(fn);
    }

    executeJobs() {
        for (const job of this.jobs) job();
        this.jobs.length = 0;
    }

    filterFalsy(c) {
        return c !== false && c !== null && c !== undefined;
    }

    /**
     * @param {Array<VNodeChild>} children
     * @returns {Array<VNodeChild>}
     */
    flattenChildren(children) {
        return children.flat(10).filter(this.filterFalsy);
    }

    /**
     * @param {string} tag
     * @param {object} props
     * @param  {...VNodeChild} children
     * @returns {VNode}
     */
    createVNode(tag, props = {}, ...children) {
        let flatten = this.flattenChildren(children);
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
            children: flatten.map((n) => this.wrapPrimitive(n)),
        };
    }

    wrapPrimitive(node) {
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
            };
        }
        return node;
    }

    // Helper to handle ref updates
    updateRef(ref, value) {
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
    }

    cleanupVNode(node) {
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
            this.updateRef(ref, null);
        }

        // Recursively clean up children
        if (Array.isArray(node.children)) {
            for (const child of node.children) this.cleanupVNode(child);
        }

        node.children = null;
        node.props = null;
    }

    updateProps(el, oldProps, newProps, onlyEvent = false) {
        const allProps = { ...oldProps, ...newProps };

        for (const key in allProps) {
            const oldValue = oldProps[key];
            const newValue = newProps[key];
            let isEvent = key.startsWith('on');
            if (key === "keyed") continue;
            if (onlyEvent && !isEvent) continue;

            if (
                key === "useCleanup" &&
                (typeof oldValue === "function" || typeof newValue == "function")
            ) {
                continue;
            }

            if (key === "ref") {
                if (oldValue !== newValue) {
                    if (oldValue) {
                        this.updateRef(oldValue, null);
                    }
                    if (newValue && el) {
                        this.updateRef(newValue, el);
                    }
                }
                continue;
            }

            if (newValue === undefined) {
                if (key === "class") {
                    el.removeAttribute("class");
                } else if (key === "style") {
                    el.style.cssText = "";
                } else if (isEvent && typeof oldValue === "function") {
                    el.removeEventListener(key.slice(2).toLowerCase(), oldValue);
                } else if (BOOLEAN_PROPS.has(key) && key in el) {
                    el[key] = false;
                } else if (key == "value" && key in el) {
                    el[key] = "";
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
                } else if (isEvent && typeof newValue === "function") {
                    if (oldValue)
                        el.removeEventListener(key.slice(2).toLowerCase(), oldValue);
                    el.addEventListener(key.slice(2).toLowerCase(), newValue);
                } else if (key == "value" && key in el) {
                    el[key] = BOOLEAN_PROPS.has(key) ? Boolean(newValue) : newValue;
                } else {
                    el.setAttribute(key, newValue);
                }
            }
        }
        return newProps;
    }

    renderVNode(vnode, parentIsSvg = false) {
        let work = vnode;

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
                const el = this.renderVNode(child);
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
            this.updateRef(ref, el);
        }

        if (work?.props) {
            for (const [key, value] of Object.entries(work.props)) {
                if (key === "useCleanup" && typeof value === "function") continue;
                if (key === "ref" || key === "keyed") continue; // Already handled
                if (key === "key") this.setKey(value, work);

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

            if (work.props?.shadow) {
                const shadow = el.attachShadow({
                    mode: work.props.shadow === true ? "open" : work.props.shadow,
                });
                el._shadow = shadow;
            }
        }

        const children = Array.isArray(work.children)
            ? work.children
            : [work.children];

        for (let child of children) {
            if (child === null || child === undefined) continue;
            el.appendChild(this.renderVNode(child, isSvg));
        }

        if (el.tagName === "SELECT" && work.props?.value !== undefined) {
            el.value = work.props.value;
        }

        work.el = el;
        return el;
    }

    patchChildrenWithKeys(parent, oldChildren, newChildren) {
        const oldKeyMap = new Map();
        oldChildren.forEach((vnode) => oldKeyMap.set(vnode.props.key, vnode));

        const newKeySet = new Set();
        const updatedChildren = [];

        newChildren.forEach((newVNode, i) => {
            const key = newVNode.props.key;
            newKeySet.add(key);

            const oldVNode = oldKeyMap.get(key);
            if (oldVNode) {
                this.updateProps(oldVNode.el, oldVNode.props, newVNode.props, oldVNode.stringifiedProps == newVNode.stringifiedProps)

                const oldChildren = oldVNode.children || [];
                const newChildren = newVNode.children || [];
                const max = Math.max(oldChildren.length, newChildren.length);

                for (let i = 0; i < max; i++) {
                    this.patch(oldVNode.el, oldChildren[i], newChildren[i]);
                }

                newVNode.el = oldVNode.el;

                updatedChildren.push(newVNode);
            } else {
                const el = this.renderVNode(newVNode);
                newVNode.el = el;
                parent.insertBefore(el, parent.children[i] || null);
                updatedChildren.push(newVNode);
            }
        });

        oldChildren.forEach((oldVNode) => {
            if (!newKeySet.has(oldVNode.props.key)) {
                this.cleanupVNode(oldVNode);
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
    }

    /** Last DOM node owned by a vnode (the end marker for fragments). */
    lastNode(vnode) {
        if (!vnode) return null;
        return vnode.tag === "#fragment" ? (vnode._end ?? vnode.el) : vnode.el;
    }

    /** Insert `el` (Node or DocumentFragment) after `after`, or append to `parent` when there is no anchor. */
    insertAfter(parent, el, after) {
        if (after) after.after(el);
        else parent.appendChild(el);
    }

    /** Remove every DOM node of a fragment, start marker through end marker (nested content included). */
    removeFragment(frag) {
        let node = frag.el;
        const end = this.lastNode(frag);
        if (!node || !end) return;

        while (node) {
            const next = node === end ? null : node.nextSibling;
            node.remove();
            node = next;
        }
    }

    /** Swap a whole fragment for a single DOM node. */
    replaceFragment(frag, newEl) {
        const end = this.lastNode(frag);
        if (!end) return;
        end.after(newEl); // outside the range that removeFragment deletes
        this.removeFragment(frag);
    }

    /**
     * @param {Element} parent  Real DOM parent. Never an array.
     * @param {VNode | null | undefined} oldNode
     * @param {VNode | null | undefined} newNode
     * @param {boolean} skip
     * @param {Node | null} after  Only used when oldNode is missing: the DOM node the new
     *                             content is inserted after. null appends to `parent`.
     * @returns {VNode | null}
     */
    patch(parent, oldNode, newNode, after = null) {
        if (oldNode == null && newNode == null) return null;

        // Removal
        if (newNode == null) {
            this.cleanupVNode(oldNode);
            if (oldNode.tag === "#fragment") this.removeFragment(oldNode);
            else oldNode.el?.remove();
            return null;
        }

        // Text
        if (newNode.tag === "#text") {
            if (oldNode?.tag === "#text") {
                const oldText = oldNode.children?.[0];
                const newText = newNode.children?.[0];

                if (oldText !== newText && oldNode.el) {
                    oldNode.el.nodeValue = newText;
                }
                newNode.el = oldNode.el;
                return newNode;
            }

            const newEl = this.renderVNode(newNode);
            if (oldNode?.tag === "#fragment") {
                this.cleanupVNode(oldNode);
                this.replaceFragment(oldNode, newEl);
            } else if (oldNode?.el) {
                parent.replaceChild(newEl, oldNode.el);
            } else {
                this.insertAfter(parent, newEl, after);
            }

            newNode.el = newEl;
            return newNode;
        }

        // Insertion
        if (oldNode == null) {
            const el = this.renderVNode(newNode);
            this.insertAfter(parent, el, after);
            // renderVNode already records el/_end on fragment vnodes
            if (newNode.tag !== "#fragment") newNode.el = el;
            return newNode;
        }

        // Fragment -> anything else
        if (oldNode.tag === "#fragment" && newNode.tag !== "#fragment") {
            this.cleanupVNode(oldNode);
            const el = this.renderVNode(newNode);
            this.replaceFragment(oldNode, el);
            newNode.el = el;
            return newNode;
        }

        // Fragment -> fragment
        if (oldNode.tag === "#fragment" && newNode.tag === "#fragment") {
            this.patchFragmentChild(parent, oldNode, newNode);
            newNode.el = oldNode.el;
            newNode._end = oldNode._end;
            return newNode;
        }

        // Tag changed
        if (oldNode.tag !== newNode.tag) {
            this.cleanupVNode(oldNode);

            const el = this.renderVNode(newNode);
            parent.replaceChild(el, oldNode.el);
            if (newNode.tag !== "#fragment") newNode.el = el;
            return newNode;
        }

        if (newNode.tag === "svg") {
            this.cleanupVNode(oldNode);

            const el = this.renderVNode(newNode, true);
            parent.replaceChild(el, oldNode.el);
            newNode.el = el;
            return newNode;
        }

        this.updateProps(oldNode.el, oldNode.props || {}, newNode.props || {}, oldNode.stringifiedProps === newNode.stringifiedProps);

        if (newNode.tag === "input" && oldNode.el?.value !== newNode.props?.value) {
            oldNode.el.value = newNode.props.value;
        }

        const oldChildren = oldNode.children || [];
        const newChildren = newNode.children || [];
        if (oldNode.props?.keyed && newNode.props?.keyed) {
            this.patchChildrenWithKeys(oldNode.el, oldChildren, newChildren);
        } else {
            const max = Math.max(oldChildren.length, newChildren.length);
            for (let i = 0; i < max; i++) {
                this.patch(oldNode.el, oldChildren[i], newChildren[i]);
            }
        }

        newNode.el = oldNode.el;
        return newNode;
    }

    patchFragmentChild(parent, oldFragment, newFragment) {
        const oldChildren = oldFragment.children;
        const newChildren = newFragment.children;
        const max = Math.max(oldChildren.length, newChildren.length);

        let cursor = oldFragment.el;

        for (let i = 0; i < max; i++) {
            const result = this.patch(
                parent,
                oldChildren[i],
                newChildren[i],
                cursor,
            );
            if (result) cursor = this.lastNode(result);
        }

        return newFragment;
    }

    /**
     * @param {Element|string} container
     * @param {VNode} vnode
     * @returns {VNode | null}
     */
    render(container, vnode) {
        container =
            typeof container === "string" ? this.getTarget(container) : container;
        container.innerHTML = "";
        const node =
            typeof vnode === "string"
                ? vnode
                : this.createVNode(vnode.tag, vnode.props, vnode.children);
        return this.patch(container, null, node);
    }

    /**
     * @param {Element} container
     * @param {VNode|null} oldNode
     * @param {VNode|null} newNode
     * @returns {VNode|null}
     */
    update(container, oldNode, newNode) {
        return this.patch(this.getTarget(container), oldNode, newNode);
    }

    /**
     * @param {String|Document|Node} selector
     * @param {Document} scope
     */
    getTarget(selector, scope = document) {
        // @ts-ignore
        if (selector instanceof Node || selector instanceof Document) {
            return scope;
        }
        const target = scope.querySelector(selector);
        if (!target) throw new Error(`Target "${scope}" not found`);
        return target;
    }

    /**
     * @param {string} tag
     * @param {(props: any, ...children: VNodeChild[])} resolver
     */
    registerVdom(tag, resolver) {
        this.customVDom[tag] = resolver;
    }

    /**
     * More direct way to create vnode
     */
    /**
     * 
     * @param {string} tag 
     * @param {object} props 
     * @param  {...VNodeChild} children 
     * @returns 
     */
    vnode(tag, props, ...children) {
        let propType = typeof props;

        if (propType === "string" || propType === "number") {
            return this.createVNode(tag, {}, props, children);
        } else if (Array.isArray(props)) {
            return this.createVNode(tag, {}, props, children);
        } else if (children.length == 0 && props?.tag) {
            return this.createVNode(tag, {}, props);
        } else if (VDOMBASE.isVNode(props)) {
            return this.createVNode(tag, {}, {}, props, children);
        } else {
            return this.createVNode(tag, props, children);
        }
    }

    /**
     * 
     * @param {string} tag 
     * @param {object} props 
     * @param  {...VNodeChild} children 
     * @returns 
     */
    renderTag(tag, props = {}, ...children) {
        return this.renderVNode(this.createVNode(tag, props, children));
    }

    /**
     * DSL-VDOM factory proxy: dynamic HTML tag functions (`html.div(...)`),
     * mount helpers, shadow DOM mounting, fragment creation and the VDOM
     * render passthrough.
     * @private
     * @returns {HTMLProxy}
     */
    _createHtmlProxy() {
        const self = this;

        const actions = {
            mount: (el, selector, scope = document) =>
                self.getTarget(selector, scope).replaceChildren(el),

            push: (el, selector, scope = document) =>
                self.getTarget(selector, scope).appendChild(el),

            mountShadow: (el, selector, scope = document) => {
                const target = self.getTarget(selector, scope);
                if (!target._shadow) {
                    target._shadow = target.attachShadow({ mode: "open" });
                }
                target._shadow.replaceChildren(el);
                return target._shadow;
            },

            element: (tag, props = {}, ...children) =>
                self.createVNode(tag, props, children),

            vdom: {
                render: self.render,
                update: self.update,
                createVNode: self.createVNode,
            },

            _: (tag, props = {}, ...children) =>
                self.renderTag(tag, props, ...children),

            $: (...children) => ({
                tag: "#fragment",
                children: self
                    .flattenChildren(children)
                    .map((n) => self.wrapPrimitive(n)),
            }),
        };

        return new Proxy(actions, {
            get: (target, tag) => {
                return (
                    target[tag] ||
                    self.customVDom[tag] ||
                    ((props = {}, ...children) => self.vnode(tag, props, ...children))
                );
            },
        });
    }
}

export default VDOMBASE;
