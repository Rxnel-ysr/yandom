/**
 * @typedef {Object} LazyComponent
 * @property {true} lazy
 * @property {() => Promise<{ default: VNodeFunction }>} importFn
 * @property {VNodeFunction | undefined} importedFn
 */

/**
 * @typedef {Object} RouteComponent
 * @property {LazyComponent | VNodeFunction} component
 * @property {string} [title]
 * @property {VNodeComponentSetting | null} [setting]
 * @property {boolean} [static]
 * @property {VNode | null} [rendered]
 * @property {number} [cacheExp]
 */

/**
 * @typedef {Object} Route
 * @property {string} uri
 * @property {LazyComponent | VNodeFunction} component
 * @property {VNodeComponentSetting | null} [cache]
 * @property {string} [title]
 * @property {VNode | null} [rendered]
 * @property {number} [cacheExp]
 * @property {boolean} [static]
 * @property {Route[]} [children]
 */

/**
 * @typedef {Object} RouterOptions
 * @property {string} [prefix]
 * @property {VNodeFunction | null} [defaultRoute]
 * @property {VNodeFunction | null} [placeholder]
 * @property {string} [titleId]
 * @property {number} [cacheExp]
 * @property {HTMLElement | null} [titleEl]
 * @property {Record<string, any>} [elementProps]
 * @property {string} [element]
 * @property {Route[]} [routes]
 * @property {number} [cleanUpInterval]
 */