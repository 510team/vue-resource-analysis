/* @flow */

export default class VNode {
    tag: string | void;
    data: VNodeData | void; //当前节点对应的对象，包含了具体的一些数据信息，是一个VNodeData类型
    children: ?Array<VNode>;
    text: string | void;
    elm: Node | void; //当前虚拟节点对应的真实dom节点
    ns: string | void; //当前节点的名字空间
    context: Component | void; // rendered in this component's scope  编译作用域
    key: string | number | void; //被当作节点的标志，在diff过程中可以提高diff的效率
    componentOptions: VNodeComponentOptions | void; //组件的option选项
    componentInstance: Component | void; // component instance
    parent: VNode | void; // component placeholder node

    // strictly internal
    raw: boolean; // contains raw HTML? (server only)
    isStatic: boolean; // hoisted static node  是否是静态节点
    isRootInsert: boolean; // necessary for enter transition check 是否作为跟节点插入
    isComment: boolean; // empty comment placeholder?
    isCloned: boolean; // is a cloned node?
    isOnce: boolean; // is a v-once node?   是否有v-once指令
    asyncFactory: Function | void; // async component factory function
    asyncMeta: Object | void;
    isAsyncPlaceholder: boolean;
    ssrContext: Object | void;
    fnContext: Component | void; // real context vm for functional nodes
    fnOptions: ?ComponentOptions; // for SSR caching
    fnScopeId: ?string; // functional scope id support

    constructor(
        tag?: string,
        data?: VNodeData,
        children?: ?Array<VNode>,
        text?: string,
        elm?: Node,
        context?: Component,
        componentOptions?: VNodeComponentOptions,
        asyncFactory?: Function
    ) {
        this.tag = tag;
        this.data = data;
        this.children = children;
        this.text = text;
        this.elm = elm;
        this.ns = undefined;
        this.context = context;
        this.fnContext = undefined;
        this.fnOptions = undefined;
        this.fnScopeId = undefined;
        this.key = data && data.key;
        this.componentOptions = componentOptions;
        this.componentInstance = undefined;
        this.parent = undefined;
        this.raw = false;
        this.isStatic = false;
        this.isRootInsert = true;
        this.isComment = false;
        this.isCloned = false;
        this.isOnce = false;
        this.asyncFactory = asyncFactory;
        this.asyncMeta = undefined;
        this.isAsyncPlaceholder = false;
    }

    // DEPRECATED: alias for componentInstance for backwards compat.
    /* istanbul ignore next */
    get child(): Component | void {
        return this.componentInstance;
    }
}
/*创建一个空VNode节点*/
export const createEmptyVNode = (text: string = "") => {
    const node = new VNode();
    node.text = text;
    node.isComment = true;
    return node;
};
/*创建一个文本节点*/
export function createTextVNode(val: string | number) {
    return new VNode(undefined, undefined, undefined, String(val));
}
/*克隆一个VNode节点*/
// optimized shallow clone
// used for static nodes and slot nodes because they may be reused across
// multiple renders, cloning them avoids errors when DOM manipulations rely
// on their elm reference.
export function cloneVNode(vnode: VNode): VNode {
    const cloned = new VNode(
        vnode.tag,
        vnode.data,
        vnode.children,
        vnode.text,
        vnode.elm,
        vnode.context,
        vnode.componentOptions,
        vnode.asyncFactory
    );
    cloned.ns = vnode.ns;
    cloned.isStatic = vnode.isStatic;
    cloned.key = vnode.key;
    cloned.isComment = vnode.isComment;
    cloned.fnContext = vnode.fnContext;
    cloned.fnOptions = vnode.fnOptions;
    cloned.fnScopeId = vnode.fnScopeId;
    cloned.asyncMeta = vnode.asyncMeta;
    cloned.isCloned = true;
    return cloned;
}
