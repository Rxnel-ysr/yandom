/// <reference path="../@types/vdom.js" />
"use strict";
import VDOMBASE from "./vdom-core.js";
import Memory from "./memory.js";
import Hooks from "./hooks.js";

class VDOM extends VDOMBASE {
    /**
     * @param {Memory} memory
     * @param {Hooks|null} [hooks] - optionally inject an already-built hook
     *  runtime; otherwise call `setHooks` before rendering any component.
     */
    constructor(memory, hooks = null, memoryPrefix = "Component_") {
        super();
        this.memory = memory;
        this.memoryPrefix = memoryPrefix;
        this.hooks = hooks;
    }

    /** @param {Hooks} hooks */
    setHooks(hooks) {
        this.hooks = hooks;
    }

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
     * @override
     * @param {Element} parent  Real DOM parent. Never an array.
     * @param {VNode | VNodeComponent | null | undefined} oldNode
     * @param {VNode | VNodeComponent | null | undefined} newNode
     * @param {boolean} skip
     * @param {Node | null} after  Only used when oldNode is missing: the DOM node the new
     *                             content is inserted after. null appends to `parent`.
     * @returns {VNode | null}
     */
    patch(parent, oldNode, newNode, skip = false, after = null) {
        if (oldNode == null && newNode == null) return null;

        if (
            !skip &&
            (VDOM.isVNodeComponent(oldNode) || VDOM.isVNodeComponent(newNode))
        ) {
            return this.handleComponent(parent, oldNode, newNode, after);
        }

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

        this.updateProps(oldNode.el, oldNode.props || {}, newNode.props || {}, oldNode.stringifiedProps === newNode.stringifiedProps)

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

            html: self.html,

            _: (tag, props = {}, ...children) =>
                self.renderTag(tag, props, ...children),

            $: (...children) => ({
                tag: "#fragment",
                children: self
                    .flattenChildren(children)
                    .map((n) => self.wrapPrimitive(n)),
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

export default VDOM;
