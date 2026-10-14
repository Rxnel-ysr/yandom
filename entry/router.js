import {
    Router,
    lazyLoad
} from "../src/router.js"

import {
    hooks,
    vdom
} from "./core.js"

/**
 * 
 * @param {RouterOptions} [option] 
 * @returns {Router}
 */
function createRouter(option = {}) {
    return Router.make(vdom, hooks, option);
}

export {
    Router,
    lazyLoad,
    createRouter
}


