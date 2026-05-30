/**
 * @typedef {Object} LazyComponent
 * @property {true} lazy
 * @property {() => Promise<{ default: VNodeFunction }>} importFn
 * @property {VNodeFunction | undefined} importedFn
 */

/**
 * @typedef {Object} RouteComponent
 * @property {LazyComponent | VNodeFunction} component
 * @property {string|null} [title]
 * @property {VNodeComponentSetting} [setting]
 * @property {boolean} [static]
 * @property {Object|null} [rendered]
 * @property {number} [cacheExp] 
 */

/**
 * @typedef {Object} Route
 * @property {string} uri
 * @property {LazyComponent | VNodeFunction} component
 * @property {VNodeComponentSetting} [cache]
 * @property {string|null} [title]
 * @property {number} [cacheExp] 
 * @property {boolean} [static]
 * @property {Array<Route>} [children]
 */

/**
 * Router option type declaration
 * @typedef {Object} RouterOptions
 * @property {string|null} [prefix]
 * @property {Function|null} [defaultRoute]
 * @property {string} [titleId] 
 * @property {number} [cacheExp] 
 * @property {HTMLElement|null} [titleEl] 
 * @property {Record<string, any>} [elementProps]
 * @property {string|null} [element]
 * @property {Array<Route>} [routes]
 * @property {number} [cleanUpInterval]
 */
