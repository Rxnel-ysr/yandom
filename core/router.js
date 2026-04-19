// @ts-check
/// <reference path="../@types/router.js" />
"use strict";
import { currentUri, ltrim } from "../helper/helper.js";
import { comp, triggerRerender } from "./vdom.hooks.js";
import { createVNode, html, pushJob, registerVdom } from "./vdom.js";
import Memory from "./memory-class.js";

let gParams = null;

function useParam() {
    return gParams;
}

/**
 * @param {any} v
 * @returns {v is LazyComponent}
 */
function isLazy(v) {
    return v !== null && typeof v === 'object' && v.lazy === true;
}

/**
 * 
 * @param {() => Promise<{ default: VNodeFunction }>} importFn 
 * @returns {LazyComponent}
 */
function lazyLoad(importFn) {
    return {
        lazy: true,
        importFn,
        importedFn: undefined
    }
}

class Router {
    /** @type {Record<string, RouteComponent>} */
    routes = {};

    /** @type {Function} */
    trigger;
    errors = {};
    element = 'a';
    cache = new Memory(1000);
    elementProps = {};
    cachePath = '';
    /**
     * @type {RouterOptions}
     */
    option;

    prepare() {
        this.use(triggerRerender)
        // setInterval(() => {
        //     console.log(this.cache.getStats(), this.cache.getInternalState())
        // }, 5000)
    }
    /**
     * @param {RouterOptions} option
     */
    static make(option) {
        return new Router(option);
    };

    /**
     *
     * @param {string} hash
     * @returns
     */
    scrollToHash(hash) {
        const el = document.querySelector(hash);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", hash);
    };

    /**
     * @param {RouterOptions} option
     */
    constructor(option) {
        this.option = option;
        if (Array.isArray(option?.routes)) {
            option.routes.forEach((route) => {
                this.register(route.uri, {
                    component: route.component,
                    title: route?.title,
                    setting: route?.setting,
                    static: route?.static,
                    cacheExp: route?.cacheExp || this.option.cacheExp || 0
                });

                if (route.children) {
                    route.children.forEach(subroute => {
                        this.register(`${route.uri}/${ltrim(subroute.uri, '/')}`, {
                            component: subroute.component,
                            title: subroute?.title,
                            setting: subroute?.setting,  // Changed from subroute?.comp
                            static: subroute?.static,
                            cacheExp: subroute?.cacheExp || this.option.cacheExp || 0
                        })
                    })
                }
            });
        }

        if (option?.element) {
            this.element = option.element
        }


        registerVdom('routerLink', (props = {}, ...children) => {
            let destination = props?.to || ''
            let scroll = props?.scrollTo || ''
            let finalDestination = props.href = `${destination}${scroll}`

            delete props.to
            delete props.scrollTo

            return createVNode(this.element, {
                ...this.elementProps, ...props, onclick: (e) => {
                    e.preventDefault()
                    let different = currentUri() !== destination;
                    // console.log("hm");

                    if (different) {
                        // console.log("hm a");
                        this.go(finalDestination);
                    }
                    // console.log(to.lastIndexOf('#'));
                    if (scroll) {
                        if (different) {
                            pushJob(() => {
                                // console.log("hm b");
                                this.scrollToHash(scroll);
                            })
                        } else {
                            this.scrollToHash(scroll);
                        }
                    }
                }
            }, children)
        })
    }

    /**
     *
     * @param {string} uri
     * @param {RouteComponent} comp
     * @returns {Router}
     */
    register(uri, comp) {
        if (this.option?.prefix) {
            uri = `${this.option?.prefix}${uri}`;
        }
        this.routes[uri] = comp;
        return this;
    };

    /**
     *
     * @param {string} uri
     */
    go(uri) {
        // if (uri !== location.pathname) {
        // console.log("called")
        history.pushState({ path: uri }, "", uri);
        this.trigger();
        // }
    };

    /**
     *
     * @param {object} [args={}]
     * @param {string} [path=location.pathname]
     * @returns {VNode | VNodeComponent | string |  null } 
     */
    routerView(args = {}, path = location.pathname) {
        let result = null;

        this.cachePath = path

        if (this.cache.remembered(path)) {
            console.log('Cache hit', path);
            return this.cache.recall(path);
        }

        console.log('Cache miss', path);


        if (this.routes[path] || false) {
            result = this._render(this.routes[path], args);
            this.cache.memorize(path, result, this.routes[path].cacheExp)
            return result;
        }

        const pathSegs = path.split('/').filter(Boolean);

        for (const routePath in this.routes) {
            const routeSegs = routePath.split('/').filter(Boolean);
            if (routeSegs.length !== pathSegs.length) continue;

            const params = {};
            let matched = true;

            for (let i = 0; i < routeSegs.length; i++) {
                const r = routeSegs[i];
                const p = pathSegs[i];

                if (r.startsWith(':')) {
                    params[r.slice(1)] = decodeURIComponent(p);
                } else if (r !== p) {
                    matched = false;
                    break;
                }
            }

            if (matched) {
                gParams = params
                result = this._render(this.routes[routePath], {
                    ...args,
                    ...params
                });
                this.cache.memorize(path, result, this.routes[routePath].cacheExp)
                return result;
            }
        }

        if (typeof this.option?.defaultRoute === 'function') {  // Changed from option.default
            return this.option.defaultRoute();
        }

        return result;
    };

    /**
     * 
     * @param {RouteComponent} route
     * @param {object} args 
     * @returns {VNode | string | VNodeComponent}
     */
    _render(route, args) {
        if (this.option?.titleId && route?.title) {
            this.option.titleEl ??= document.getElementById(this.option.titleId);
            if (this.option.titleEl !== null) {
                this.option.titleEl.innerText = route.title;
            }
        }

        let component = route.component

        if (route.static) {
            try {
                if (isLazy(component)) {
                    if (component.importedFn) {
                        return comp(component.importedFn, args, route.setting)
                    }
                    this._scheduleFetchComponent(this.cachePath, route, args);
                    return '';
                } else {
                    return route.rendered = comp(component, args, route.setting);
                }
            } catch (e) {
                return html.p(`Static render error: ${e}`);
            }
        }

        try {
            if (isLazy(component)) {
                if (component.importedFn) {
                    return comp(component.importedFn, args, route.setting)
                }
                this._scheduleFetchComponent(this.cachePath, route, args);
                return '';
            } else {
                return comp(component, args, route.setting);
            }
        } catch (e) {
            return html.p(`Render error: ${e}`);
        }
    }

    /**
     * 
     * @param {string} path 
     * @param {RouteComponent} route
     * @param {object} args 
     */
    _scheduleFetchComponent(path, route, args) {
        let lazyComponent = route.component;
        if (isLazy(lazyComponent)) {
            pushJob(async () => {
                let realComponent = await lazyComponent.importFn();
                let rendered = comp(realComponent.default, args, route.setting);

                lazyComponent.importedFn = realComponent.default;
                this.cache.forget(path);
                this.cache.memorize(path, rendered, route.cacheExp)
                if (location.pathname === path) {
                    this.trigger()
                }
            })
        } else {
            console.error(lazyComponent, ' is VNode component, not lazy component.');
        }
    }


    /**
     *
     * @param {Function} trigger Function to trigger reload
     */
    use(trigger) {
        // console.log(trigger);
        this.trigger = trigger;
    };
}

// console.log("HI");

const create = Router.make;

export { Router, create, useParam, lazyLoad };