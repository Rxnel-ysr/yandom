/// <reference path="../@types/vdom.js" />
"use strict";
import { Hooks } from "./vdom.hooks.js";
import Memory from "./memory.js";

const memoryPrefix = "ComponentState_";

/**
 * The VDOM rendering engine: virtual node creation, diffing/patching,
 * component (hook) reconciliation and the `html` DSL proxy all live here.
 */
class VDOM {
    /**
     * @param {Memory} memory
     * @param {Hooks|null} [hooks] - optionally inject an already-built hook
     *  runtime; otherwise call `setHooks` before rendering any component.
     */
    constructor(memory, hooks = null) {
        this.jobs = [];
        this.memory = memory;
        this.memoryPrefix = memoryPrefix;
        this._keys = {};
        this.customVDom = {};
        /** @type {Hooks|null} */
        this.hooks = hooks;


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

        /** Legacy-shaped facade kept for drop-in compatibility. */
        this.RenderVDOM = {
            createVNode: this.createVNode.bind(this),
            render: this.render.bind(this),
            update: this.update.bind(this),
        };
    }

    /** @param {Hooks} hooks */
    setHooks(hooks) {
        this.hooks = hooks;
    }

    // ---- static predicates -------------------------------------------------

    /**
     * @param {any} v
     * @returns {v is VNode}
     */
    static isVNode(v) {
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
    static isVNodeComponent(v) {
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
     * @param {Array} children
     * @returns {Array}
     */
    flattenChildren(children) {
        return children.flat(10).filter(this.filterFalsy);
    }

    /**
     * @param {string} tag
     * @param {object} props
     * @param  {VNodeChild[] | VNodeChild[][]} children
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
            isComp: false,
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
                isComp: false,
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

    updateProps(el, oldProps, newProps) {
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
    }

    renderVNode(vnode, parentIsSvg = false) {
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
                if (oldVNode.stringifiedProps != newVNode.stringifiedProps) {
                    requestAnimationFrame(() => {
                        this.updateProps(oldVNode.el, oldVNode.props, newVNode.props);
                    });
                }

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

    /**
     * Handle component's state management
     * @param {VNodeComponent} old
     * @param {VNodeComponent} replacement
     */
    handleComponentState(old, replacement) {
        let oldHookCount = old.compHooks,
            replacementHookCount = replacement.compHooks;

        if (oldHookCount === 0 && replacementHookCount > 0) {
            return this.handleComponentApplyState(replacement);
        } else if (replacementHookCount === 0 && oldHookCount > 0) {
            return this.handleComponentRetrieval(old);
        } else if (replacementHookCount === 0 && oldHookCount === 0) {
            return;
        }

        let current = this.hooks.getCurrentHookNode();
        let store = new Array(oldHookCount);
        let storedMemory = [];
        let prev = null;
        if (
            replacement.remember &&
            this.memory.remembered(this.memoryPrefix + replacement.stringified)
        ) {
            storedMemory = this.memory.recall(
                this.memoryPrefix + replacement.stringified,
            );
        }

        for (let i = 0; i < Math.max(oldHookCount, replacementHookCount); i++) {
            if (i > oldHookCount) {
                let newNode = { value: undefined, next: current?.next };
                if (!current) {
                    prev.next = current = newNode;
                } else {
                    current.next = newNode;
                    prev = current;
                    current = newNode;
                }
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

            prev = current;
            current = current.next;
        }

        if (oldHookCount > replacementHookCount) {
            this.hooks.orphan(old.compHooks - replacement.compHooks);
        }

        if (old.remember) {
            this.memory.memorize(
                this.memoryPrefix + old.stringified,
                store,
                old.invalidAfter,
            );
        }
    }

    /**
     * Handle component's state retrieval
     * @param {VNodeComponent} component
     */
    handleComponentRetrieval(component) {
        let data = new Array(component.compHooks);
        let current = this.hooks.getCurrentHookNode();

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

        this.hooks.orphan(component.compHooks - 1);

        if (component.remember) {
            this.memory.memorize(
                this.memoryPrefix + component.stringified,
                data,
                component.invalidAfter,
            );
        }
    }

    /**
     * Handle component's state application
     * @param {VNodeComponent} component
     */
    handleComponentApplyState(component) {
        this.hooks.allocate(component.compHooks - 1);
        if (
            component.remember &&
            this.memory.remembered(this.memoryPrefix + component.stringified)
        ) {
            this.hooks.overwrite(
                this.memory.recall(this.memoryPrefix + component.stringified),
                component.recompute,
            );
        }
    }

    /**
     * @param {Element} parent
     * @param {VNode | VNodeComponent | undefined } old
     * @param {VNode | VNodeComponent | undefined } newOne
     * @returns {VNode | VNodeComponent | null}
     */
    handleComponent(parent, old, newOne) {
        if (VDOM.isVNodeComponent(old) && VDOM.isVNodeComponent(newOne)) {
            if (old.stringified !== newOne.stringified) {
                this.handleComponentState(old, newOne);
            }

            newOne.vdom = this.patch(parent, old.vdom, newOne.render(), true);
            return newOne;
        } else if (VDOM.isVNodeComponent(old) && !VDOM.isVNodeComponent(newOne)) {
            this.handleComponentRetrieval(old);

            return this.patch(parent, old.vdom, newOne, true);
        } else if (!VDOM.isVNodeComponent(old) && VDOM.isVNodeComponent(newOne)) {
            this.handleComponentApplyState(newOne);

            newOne.vdom = this.patch(parent, old, newOne.render(), true);
            return newOne;
        } else {
            console.error("Impossible", old, newOne);
            return null;
        }
    }

    /**
     * @param {Element} parent
     * @param {VNode | VNodeComponent | null | undefined} oldNode
     * @param {VNode | VNodeComponent | null | undefined} newNode
     * @param {boolean} skip
     * @returns {VNode | null}
     */
    patch(parent, oldNode, newNode, skip = false, type = -1) {
        if (oldNode == null && newNode == null) return null;

        if (!skip && (VDOM.isVNodeComponent(oldNode) || VDOM.isVNodeComponent(newNode))) {
            return this.handleComponent(parent, oldNode, newNode);
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
                    node = next;
                }

                return null;
            }
            this.cleanupVNode(oldNode);
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

                const newEl = this.renderVNode(newNode);
                parent.replaceChild(newEl, oldNode._end);
                newNode.el = newEl;

                return newNode;
            }

            const newEl = this.renderVNode(newNode);
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
                const frag = this.renderVNode(newNode);
                parent.appendChild(frag);
                return newNode;
            }

            const el = this.renderVNode(newNode);
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
                else parent.removeChild(node);
                node = next;
            }

            const newEl = this.renderVNode(newNode);
            if (type > -1) parent[0].removeChild(node);
            else parent.replaceChild(newEl, oldNode._end);

            return newNode;
        }

        if (oldNode.tag == "#fragment" && newNode.tag == "#fragment") {
            this.patchFragmentChild(parent, oldNode, newNode);
            newNode.el = oldNode.el;
            newNode._end = oldNode._end;
            return newNode;
        }

        if (oldNode.tag !== newNode.tag) {
            this.cleanupVNode(oldNode);

            if (newNode.tag === "#fragment") {
                const frag = this.renderVNode(newNode);
                if (type > -1) parent[0].replaceChild(frag, oldNode.el);
                else parent.replaceChild(frag, oldNode.el);
                return newNode;
            }

            const el = this.renderVNode(newNode);
            if (type > -1) parent[0].replaceChild(el, oldNode.el);
            else parent.replaceChild(el, oldNode.el);
            newNode.el = el;
            return newNode;
        }

        if (newNode.tag === "svg") {
            this.cleanupVNode(oldNode);

            const el = this.renderVNode(newNode, true);
            parent.replaceChild(el, oldNode.el);
            newNode.el = el;
            return newNode;
        }

        if (oldNode.stringifiedProps !== newNode.stringifiedProps) {
            requestAnimationFrame(() => {
                this.updateProps(oldNode.el, oldNode.props || {}, newNode.props || {});
            });
        }

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
                this.patch(
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
    }

    patchFragmentChild(parent, oldFragment, newFragment) {
        const start = oldFragment.el;
        const end = oldFragment._end;
        let current = parent;

        const max = Math.max(
            oldFragment.children.length,
            newFragment.children.length,
        );
        for (let i = 0; i < max; i++) {
            this.patch(
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
    }

    // ---- top-level render/update -------------------------------------------

    /**
     * @param {VNode} vnode
     * @param {Element|string} container
     * @returns {VNode | null}
     */
    render(vnode, container) {
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
        return this.patch(container, oldNode, newNode);
    }

    /**
     * @param {String|Document|Node} selector
     * @param {Document} scope
     */
    getTarget(selector, scope = document) {
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
    vnode(tag, props, ...children) {
        let propType = typeof props;

        if (propType === "string" || propType === "number") {
            return this.createVNode(tag, {}, props, children);
        } else if (Array.isArray(props)) {
            return this.createVNode(tag, {}, props, children);
        } else if (children.length == 0 && props?.tag) {
            return this.createVNode(tag, {}, props);
        } else {
            return this.createVNode(tag, props, children);
        }
    }

    renderTag(tag, props = {}, ...children) {
        return this.renderVNode(this.createVNode(tag, props, children));
    }

    /**
     * DSL-VDOM factory proxy: dynamic HTML tag functions (`html.div(...)`),
     * mount helpers, shadow DOM mounting, fragment creation and the VDOM
     * render passthrough.
     * @private
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

            vdom: self.RenderVDOM,

            _: (tag, props = {}, ...children) => self.renderTag(tag, props, ...children),

            $: (...children) => ({
                tag: "#fragment",
                children: self.flattenChildren(children).map((n) => self.wrapPrimitive(n)),
                isComp: false,
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

// ---- composition root: wire the engine and hook runtime together ----------

const vdom = new VDOM(new Memory());
const hooks = new Hooks(vdom);
vdom.setHooks(hooks);

// Backward-compatible bound exports (mirrors the original vdom.js + vdom.hooks.js API)
const html = vdom.html;
const vnode = vdom.vnode.bind(vdom);
const getTarget = vdom.getTarget.bind(vdom);
const getKey = vdom.getKey.bind(vdom);
const updateProps = vdom.updateProps.bind(vdom);
const createVNode = vdom.createVNode.bind(vdom);
const renderVNode = vdom.renderVNode.bind(vdom);
const cleanupVNode = vdom.cleanupVNode.bind(vdom);
const RenderVDOM = vdom.RenderVDOM;
const patch = vdom.patch.bind(vdom);
const registerVdom = vdom.registerVdom.bind(vdom);
const pushJob = vdom.pushJob.bind(vdom);
const executeJobs = vdom.executeJobs.bind(vdom);

const resetContext = hooks.resetContext.bind(hooks);
const useState = hooks.useState.bind(hooks);
const useEffect = hooks.useEffect.bind(hooks);
const useMemo = hooks.useMemo.bind(hooks);
const useRef = hooks.useRef.bind(hooks);
const createRoot = hooks.createRoot.bind(hooks);
const resets = hooks.resets.bind(hooks);
const getCurrentHookNode = hooks.getCurrentHookNode.bind(hooks);
const destroy = hooks.destroy.bind(hooks);
const comp = hooks.comp.bind(hooks);
const allocate = hooks.allocate.bind(hooks);
const orphan = hooks.orphan.bind(hooks);
const overwrite = hooks.overwrite.bind(hooks);
const triggerRerender = hooks.triggerRerender.bind(hooks);
const getData = hooks.getData.bind(hooks);
const bulkSetState = hooks.bulkSetState.bind(hooks);
const hmr = hooks.hmr.bind(hooks);

export {
    // classes + singletons
    VDOM,
    Hooks,
    vdom,
    hooks,
    // vdom.js-compatible exports
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
    // vdom.hooks.js-compatible exports
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
    triggerRerender,
    getData,
    bulkSetState,
    hmr,
};