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
 * @property {string|null} [title]
 * @property {LazyComponent | VNodeFunction} component
 * @property {VNodeComponentSetting} [setting]  // Changed from 'comp' to 'setting' for consistency
 * @property {number} [cacheExp] 
 * @property {boolean} [static]
 * @property {Object|null} [renderedSetting]  // Renamed from 'setting' to avoid conflict
 * @property {Array<Route>} [children]
 */

/**
 * Router option type declaration
 * @typedef {Object} RouterOptions
 * @property {string|null} [prefix]
 * @property {Function|null} [defaultRoute]  // Changed from 'default' (reserved word)
 * @property {string} [titleId] 
 * @property {number} [cacheExp] 
 * @property {HTMLElement|null} [titleEl] 
 * @property {Object} [elementProps]
 * @property {string|null} [element]
 * @property {Array<Route>} routes
 */
