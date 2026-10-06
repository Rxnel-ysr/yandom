"use strict";
import VDOM from "../src/vdom.js";
import { Hooks, Root } from "../src/hooks.js";
import Memory from "../src/memory.js";

/**
 * Create a setup with initialized Root
 * @overload
 * @param {string} selector
 * @returns {[Root, VDOM, Hooks]}
 */

/**
 * Create a setup without Root
 * @overload
 * @param {null} [selector]
 * @returns {[VDOM, Hooks]}
 */

/**
 * @param {string|null} [selector]
 * @returns {[Root, VDOM, Hooks] | [VDOM, Hooks]}
 */
function createSetup(selector = null) {
    const vdom = new VDOM(new Memory());
    const hooks = new Hooks(vdom);

    vdom.setHooks(hooks);

    if (typeof selector === "string") {
        return [hooks.createRoot(selector), vdom, hooks];
    }

    return [vdom, hooks];
}

const [vdom, hooks] = createSetup();

const html = vdom.html;
const vnode = vdom.vnode.bind(vdom);
const getTarget = vdom.getTarget.bind(vdom);
const getKey = vdom.getKey.bind(vdom);
const updateProps = vdom.updateProps.bind(vdom);
const createVNode = vdom.createVNode.bind(vdom);
const renderVNode = vdom.renderVNode.bind(vdom);
const cleanupVNode = vdom.cleanupVNode.bind(vdom);
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

export * from '../src/helper.js';
export { Root } from  '../src/hooks.js'
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
    // setup    
    createSetup
}
