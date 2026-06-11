// @ts-check
/// <reference path="../@types/router.js" />

"use strict";
import { currentUri, trim, value } from "../helper/helper.js";
import { comp, triggerRerender } from "../core/vdom.hooks.js";
import { createVNode, html, pushJob, registerVdom } from "../core/vdom.js";
import Memory from "../core/memory.js";

/**
 * @param {any} v
 * @returns {v is RadixNode}
 */
function isRadixNode(v) {
    return v instanceof RadixNode;
}

/**
 * @param {any} v
 * @returns {v is LazyComponent}
 */
function isLazyComponent(v) {
    return v !== null && typeof v === "object" && v.lazy === true;
}

/**
 * @param {() => Promise<{ default: VNodeFunction }>} importFn
 * @returns {LazyComponent}
 */
function lazyLoad(importFn) {
    return {
        lazy: true,
        importFn,
        importedFn: undefined,
    };
}

class RadixNode {
    /** @type {Map<string, RadixNode>} */
    children = new Map();
    /** @type {RouteComponent | null} */
    route = null;
    /** @type {string} */
    path = "";
    /** @type {string[]} */
    paramKeys = [];
    /** @type {boolean} */
    isParam = false;
    /** @type {boolean} */
    isWildcard = false;
    /** @type {boolean} */
    isLeaf = false;

    /**
     * @param {string} [path]
     */
    constructor(path = "") {
        this.path = path;
    }
}

class Router {
    /** @type {RadixNode} */
    root;
    /** @type {(() => void) | undefined} */
    trigger;
    /** @type {Record<string, any>} */
    errors = {};
    /** @type {string} */
    element = "a";
    /** @type {Memory} */
    cache;
    /** @type {Record<string, any>} */
    elementProps = {};
    /** @type {string} */
    cachePath = "";
    /** @type {Record<string, RouteComponent>} */
    routes = {};
    /**
     * @type {RouterOptions}
     */
    option;

    /** @type {Record<string, string | undefined>} */
    params = {};

    /** @type {((to: string, from: string, next: Function) => void) | undefined} */
    middleware;

    /** @type {Record<string, string | undefined> | undefined} */
    proxy;

    /** @type {VNodeFunction | null} */
    placeholder = null;

    /**
     * @returns {void}
     */
    prepare() {
        this.use(triggerRerender);
    }

    /**
     *
     * @param {Route|Route[]} route
     * @private
     */
    _registerRoute(route) {
        route = Array.isArray(route) ? route : [route];

        route.forEach((route) => {
            this.register(`/${trim(route.uri, "/")}`, {
                component: route.component,
                title: route?.title,
                setting: route?.cache,
                static: route?.static,
                cacheExp: route?.cacheExp || this.option.cacheExp || 0,
            });

            if (route.children) {
                route.children.forEach((subroute) => {
                    this.register(`/${trim(route.uri, "/")}/${trim(subroute.uri, "/")}`, {
                        component: subroute.component,
                        title: subroute?.title,
                        setting: subroute?.cache,
                        static: subroute?.static,
                        cacheExp: subroute?.cacheExp || this.option.cacheExp || 0,
                    });
                });
            }
            this.routes[route.uri] = route;
        });
    }

    /**
     *  Register routes
     * @param {Route[]} routes
     */
    useRoutes(routes) {
        this._registerRoute(routes);
    }

    /**
     * Register a route
     * @param {Route} route
     */
    route(route) {
        this._registerRoute(route);
    }

    /**
     * @param {(to: string, from: string, next: Function) => void} callback
     */
    beforeEach(callback) {
        this.middleware = callback;
        return this;
    }

    /**
     * @returns {Record<string, string | undefined>}
     */
    getParams() {
        if (this.proxy) {
            return this.proxy;
        }

        return (this.proxy = new Proxy(this.params, {
            get(target, prop, receiver) {
                if (!(prop in target)) {
                    return undefined;
                }

                return Reflect.get(target, prop, receiver);
            },
        }));
    }

    /**
     * @param {RouterOptions} option
     * @returns {Router}
     */
    static make(option) {
        return new Router(option);
    }

    /**
     * @param {string} hash
     * @param {ScrollLogicalPosition} block
     * @returns {void}
     */
    scrollToHash(hash, block = "start") {
        const el = document.querySelector(hash);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: block });
        history.replaceState(null, "", hash);
    }

    /**
     * @param {RouterOptions} option
     */
    constructor(option) {
        this.root = new RadixNode();
        this.cache = new Memory(value(option?.cleanUpInterval, 300000));
        this.option = option;

        if (Array.isArray(option?.routes)) {
            this._registerRoute(option.routes);
        }

        if (option?.element) {
            this.element = option.element;
        }

        if (option?.placeholder) {
            this.placeholder = option.placeholder;
        }

        registerVdom("routerLink", (props = {}, ...children) => {
            let destination = props?.to || "";
            let scroll = props?.scrollTo || "";
            let block = props?.block || "start";
            let finalDestination = (props.href = `${destination}${scroll}`);

            delete props.to;
            delete props.scrollTo;

            return createVNode(
                this.element,
                {
                    ...this.elementProps,
                    ...props,
                    /**
                     * @param {PointerEvent} e 
                     */
                    onclick: (e) => {
                        e.preventDefault();
                        let different = currentUri() !== destination;

                        if (different) {
                            this.go(finalDestination);
                        }
                        if (scroll) {
                            if (different) {
                                pushJob(() => {
                                    this.scrollToHash(scroll, block);
                                });
                            } else {
                                this.scrollToHash(scroll, block);
                            }
                        }
                    },
                },
                children,
            );
        });
    }

    /**
     * Insert a route into the radix tree
     * @param {string} path
     * @param {RadixNode} node
     * @param {string[]} paramKeys
     * @returns {void}
     * @private
     */
    _insertPath(path, node, paramKeys = []) {
        if (path === "") {
            node.route = this.routes[path];
            node.paramKeys = paramKeys;
            return;
        }

        // Find common prefix with existing children
        let matched = false;
        for (let [childPath, childNode] of node.children) {
            const commonPrefix = this._getCommonPrefix(path, childPath);

            if (commonPrefix) {
                if (commonPrefix === childPath) {
                    // Child is fully matched, continue down
                    this._insertPath(
                        path.slice(commonPrefix.length),
                        childNode,
                        paramKeys,
                    );
                } else if (commonPrefix === path) {
                    // New path is shorter, need to split child
                    const remainingChildPath = childPath.slice(commonPrefix.length);
                    const newChildNode = new RadixNode(remainingChildPath);
                    newChildNode.children = childNode.children;
                    newChildNode.route = childNode.route;
                    newChildNode.paramKeys = childNode.paramKeys;
                    newChildNode.isParam = childNode.isParam;

                    childNode.path = commonPrefix;
                    childNode.children = new Map();
                    childNode.children.set(remainingChildPath, newChildNode);
                    childNode.route = null;
                    childNode.paramKeys = [];

                    this._insertPath("", childNode, paramKeys);
                } else {
                    // Split both paths
                    const remainingNewPath = path.slice(commonPrefix.length);
                    const remainingChildPath = childPath.slice(commonPrefix.length);

                    const newInternalNode = new RadixNode(commonPrefix);
                    newInternalNode.children = new Map();

                    // Update child node
                    childNode.path = remainingChildPath;
                    newInternalNode.children.set(remainingChildPath, childNode);

                    // Create new node for the remaining path
                    const newNode = new RadixNode(remainingNewPath);
                    newNode.route = this.routes[path];
                    newNode.paramKeys = paramKeys;
                    newInternalNode.children.set(remainingNewPath, newNode);

                    // Replace current node with internal node
                    node.children.delete(childPath);
                    node.children.set(commonPrefix, newInternalNode);
                }
                matched = true;
                break;
            }
        }

        if (!matched) {
            // No common prefix, add as new child
            const newNode = new RadixNode(path);
            newNode.route = this.routes[path];
            newNode.paramKeys = paramKeys;
            node.children.set(path, newNode);
        }
    }

    /**
     * Get common prefix between two strings
     * @param {string} a
     * @param {string} b
     * @returns {string}
     * @private
     */
    _getCommonPrefix(a, b) {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) {
            i++;
        }
        return a.slice(0, i);
    }

    /**
     * Search for a route in the radix tree
     * @param {string} path
     * @param {RadixNode} node
     * @param {Record<string, string>} params
     * @returns {RouteComponent | null}
     * @private
     */
    _searchPath(path, node, params = {}) {
        if (path === "") {
            return node.route;
        }

        for (let [childPath, childNode] of node.children) {
            if (childNode.isParam) {
                // Handle parameter nodes
                const slashIndex = path.indexOf("/");
                const paramValue = slashIndex === -1 ? path : path.slice(0, slashIndex);
                const remainingPath =
                    slashIndex === -1 ? "" : path.slice(slashIndex + 1);

                params[childNode.paramKeys[0]] = decodeURIComponent(paramValue);
                const result = this._searchPath(remainingPath, childNode, params);
                if (result) return result;
            } else if (path.startsWith(childPath)) {
                const remainingPath = path.slice(childPath.length);
                const result = this._searchPath(remainingPath, childNode, params);
                if (result) return result;
            }
        }

        return null;
    }

    /**
     * Parse path and extract parameter names
     * @param {string} path
     * @returns {{segments: string[], paramKeys: string[]}}
     */
    _parsePath(path) {
        const segments = path.split("/").filter(Boolean);
        const paramKeys = [];

        for (const segment of segments) {
            if (segment.startsWith(":")) {
                paramKeys.push(segment.slice(1));
            }
        }

        return { segments, paramKeys };
    }

    /**
     * Insert route into radix tree
     * @param {string} uri
     * @param {RouteComponent} comp
     * @returns {void}
     */
    _insertRoute(uri, comp) {
        if (this.option?.prefix) {
            uri = `${this.option?.prefix}${uri}`;
        }

        this.routes[uri] = comp;

        // Parse path and handle parameters
        const { segments, paramKeys } = this._parsePath(uri);
        let currentNode = this.root;

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const isParam = segment.startsWith(":");
            const key = isParam ? ":param" : segment;

            let node = currentNode.children.get(key);

            if (!isRadixNode(node)) {
                const newNode = new RadixNode(segment);
                newNode.isParam = isParam;
                if (isParam) {
                    newNode.paramKeys = [segment.slice(1)];
                }
                currentNode.children.set(key, newNode);
                currentNode = newNode;
            } else {
                currentNode = node;
            }
        }

        currentNode.route = comp;
        currentNode.paramKeys = paramKeys;
        currentNode.isLeaf = true;
    }

    /**
     * @param {string} uri
     * @param {RouteComponent} comp
     * @returns {Router}
     */
    register(uri, comp) {
        this._insertRoute(uri, comp);
        return this;
    }

    /**
     * @param {string} uri
     * @returns {void}
     */
    go(uri) {
        history.pushState({ path: uri }, "", uri);
        // @ts-ignore
        this.trigger();
    }

    /**
     * Search for route using radix tree
     * @param {string} path
     * @param {Record<string, string | undefined>} params
     * @returns {RouteComponent | null}
     */
    _findRoute(path, params = {}) {
        const segments = path.split("/").filter(Boolean);
        let currentNode = this.root;
        let matchedRoute = null;

        /**
         * @param {RadixNode} node
         * @param {number} index
         * @param {Record<string, string | undefined>} currentParams
         * @returns {boolean}
         */
        const search = (node, index, currentParams) => {
            if (index === segments.length) {
                if (node.route) {
                    matchedRoute = node.route;
                    Object.assign(params, currentParams);
                    return true;
                }
                return false;
            }

            const segment = segments[index];

            // Try exact match first
            if (node.children.has(segment)) {
                const childNode = node.children.get(segment);
                if (childNode && search(childNode, index + 1, currentParams)) {
                    return true;
                }
            }

            // Try parameter match
            for (let [childPath, childNode] of node.children) {
                if (childNode.isParam && childNode.paramKeys[0]) {
                    const newParams = { ...currentParams };
                    newParams[childNode.paramKeys[0]] = decodeURIComponent(segment);
                    if (search(childNode, index + 1, newParams)) {
                        return true;
                    }
                }
            }

            return false;
        };

        search(currentNode, 0, params);
        return matchedRoute;
    }

    /**
     * @param {object} [args={}]
     * @param {string} [path=location.pathname]
     * @returns {VNode | VNodeComponent | string | null}
     */
    routerView(args = {}, path = location.pathname) {
        let result = null;
        /** @type {Record<string, string|undefined>} */
        const params = {};

        this.cachePath = path;

        if (this.cache.remembered(path)) {
            console.log("Cache hit", path);
            result = this.cache.recall(path);
            this.params = result.params;
            if (this.option.titleEl && result.route.title) {
                this.option.titleEl.innerText = result.route.title;
            }
            return result.rendered;
        }

        console.log("Cache miss", path);

        const matchedRoute = this._findRoute(path, params);

        if (matchedRoute) {
            this.params = params;
            result = this._render(matchedRoute, {
                ...args,
                ...params,
            });
            this.cache.memorize(
                path,
                { rendered: result, params, route: matchedRoute },
                matchedRoute.cacheExp,
            );
            return result;
        }

        if (typeof this.option?.defaultRoute === "function") {
            return this.option.defaultRoute();
        }

        return result;
    }

    /**
     * @param {RouteComponent} route
     * @param {object} args
     * @returns {VNode | VNodeComponent | null}
     */
    _render(route, args) {
        if (this.option?.titleId && route?.title) {
            this.option.titleEl ??= document.getElementById(this.option.titleId);
            if (this.option.titleEl !== null) {
                this.option.titleEl.innerText = route.title;
            }
        }

        let component = route.component;

        if (route.static && route?.rendered) {
            return route.rendered;
        }

        try {
            if (isLazyComponent(component)) {
                if (component.importedFn) {
                    return comp(component.importedFn, args, route.setting);
                }
                this._scheduleFetchComponent(this.cachePath, route, args);
                if (this.placeholder) {
                    return comp(
                        this.placeholder,
                        {},
                        { name: "routerPlaceholder", remember: true, invalidAfter: 0 },
                    );
                }
                return null;
            } else {
                return comp(component, args, route.setting);
            }
        } catch (e) {
            return html.p(`Render error: ${e}`);
        }
    }

    /**
     * @param {string} path
     * @param {RouteComponent} route
     * @param {object} args
     * @returns {void}
     */
    _scheduleFetchComponent(path, route, args) {
        let lazyComponent = route.component;
        if (isLazyComponent(lazyComponent)) {
            pushJob(async () => {
                let realComponent = await lazyComponent.importFn();
                let rendered = comp(realComponent.default, args, route.setting);

                lazyComponent.importedFn = realComponent.default;
                this.cache.forget(path);
                this.cache.memorize(path, { rendered, params: args, route }, route.cacheExp);

                if (location.pathname === path) {
                    // @ts-ignore
                    this.trigger();
                }
            });
        } else {
            console.error(lazyComponent, "is VNodeFunction, not lazy component.");
        }
    }

    /**
     * @param {() => void} trigger Function to trigger reload
     * @returns {void}
     */
    use(trigger) {
        this.trigger = trigger;
    }
}

// Create router instance
const createRouter = Router.make;

export { Router, createRouter, lazyLoad };