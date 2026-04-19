/** 
 * @typedef {VNode | VNodeComponent | string | number | boolean | null | (VNode | VNodeComponent | null | boolean)[] } PrimitiveChild
 * @typedef {PrimitiveChild | PrimitiveChild[]} VNodeChild
 * @typedef {(args?: any) => VNode} VNodeFunction
 */

/**
 * @typedef {{
 *   mount: (el: Element, selector: string, scope?: ParentNode) => void,
 *   push: (el: Element, selector: string, scope?: ParentNode) => void,
 *   mountShadow: (el: Element, selector: string, scope?: ParentNode) => ShadowRoot,
 *   $: (...children: VNodeChild[]) => VNode,
 *   vdom: typeof RenderVDOM,
 *   _: typeof __
 * }  & Record<string, (props?: Record<string, any>|string, ...children: VNodeChild[]) => VNode> } HTMLProxy
 */

/**
 * @typedef {Object} VNode
 * @property {boolean} isComp
 * @property {string} tag
 * @property {VNodeChild[]} children
 */

/**
 * @typedef {{
 *   render: () => VNode,
 *   isComp: true,
 *   compHooks: number,
 *   stringified: string,
 *   remember: boolean,
 *   recompute: boolean,
 *   invalidAfter: number
 * }} VNodeComponent
 */

/**
 * @typedef {Object} VNodeComponentSetting
 * @property {string} name
 * @property {number} hook
 * @property {boolean} recompute
 * @property {number} invalidAfter
 * @property {boolean} remember
 */
