/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from "./vnode";
import config from "../config";
import { SSR_ATTR } from "shared/constants";
import { registerRef } from "./modules/ref";
import { traverse } from "../observer/traverse";
import { activeInstance } from "../instance/lifecycle";
import { isTextInputType } from "web/util/element";

import {
    warn,
    isDef,
    isUndef,
    isTrue,
    makeMap,
    isRegExp,
    isPrimitive
} from "../util/index";

export const emptyNode = new VNode("", {}, []);

const hooks = ["create", "activate", "update", "remove", "destroy"];

function childrenIgnored(vnode) {
    return (
        vnode &&
        vnode.data &&
        vnode.data.domProps &&
        (vnode.data.domProps.innerHTML || vnode.data.domProps.textContent)
    );
}
/*
  判断是否是同一个虚拟节点
  key相同
  tag（标签名）相同
  isComment（是否为注释节点）相同
  是否data（当前节点对应的对象，包含了具体的一些数据信息，是一个VNodeData类型，可以参考VNodeData类型中的数据信息）都有定义
  当标签是<input>的时候，type必须相同
*/
function sameVnode(a, b) {
    return (
        a.key === b.key &&
        ((a.tag === b.tag &&
            a.isComment === b.isComment &&
            isDef(a.data) === isDef(b.data) &&
            !childrenIgnored(a) &&
            !childrenIgnored(b) &&
            sameInputType(a, b)) ||
            (isTrue(a.isAsyncPlaceholder) &&
                a.asyncFactory === b.asyncFactory &&
                isUndef(b.asyncFactory.error)))
    );
}
/*
  判断当标签是<input>的时候，type是否相同
  某些浏览器不支持动态修改<input>类型，所以他们被视为不同类型
*/
function sameInputType(a, b) {
    if (a.tag !== "input") return true;
    let i;
    const typeA = isDef((i = a.data)) && isDef((i = i.attrs)) && i.type;
    const typeB = isDef((i = b.data)) && isDef((i = i.attrs)) && i.type;
    return (
        typeA === typeB || (isTextInputType(typeA) && isTextInputType(typeB))
    );
}
/*
  生成一个key与旧VNode的key对应的哈希表
  比如childre是这样的 [{xx: xx, key: 'key0'}, {xx: xx, key: 'key1'}, {xx: xx, key: 'key2'}]  beginIdx = 0   endIdx = 2  
  结果生成{key0: 0, key1: 1, key2: 2}
*/
function createKeyToOldIdx(children, beginIdx, endIdx) {
    let i, key;
    const map = {};
    for (i = beginIdx; i <= endIdx; ++i) {
        key = children[i].key;
        if (isDef(key)) map[key] = i;
    }
    return map;
}
/*创建patch方法*/
export function createPatchFunction(backend) {
    let i, j;
    const cbs = {};

    //modules, dom中方法的封装src/platforms/web/runtime/modules/index  +  vdom中方法的封装src/platforms/core/vdom/modules/index
    //nodeOps dom中对节点的各种操作，位置：src/platforms/web/runtime/node-ops
    const { modules, nodeOps } = backend;
    /*构建cbs回调函数/platforms/web/runtime/modules*/
    for (i = 0; i < hooks.length; ++i) {
        cbs[hooks[i]] = [];
        for (j = 0; j < modules.length; ++j) {
            if (isDef(modules[j][hooks[i]])) {
                cbs[hooks[i]].push(modules[j][hooks[i]]);
            }
        }
    }
    /*根据真实dom节点，创建空的虚拟节点*/
    function emptyNodeAt(elm) {
        return new VNode(
            nodeOps.tagName(elm).toLowerCase(),
            {},
            [],
            undefined,
            elm
        );
    }

    function createRmCb(childElm, listeners) {
        function remove() {
            if (--remove.listeners === 0) {
                removeNode(childElm);
            }
        }
        remove.listeners = listeners;
        return remove;
    }
    /*将某个el节点从文档中移除*/
    function removeNode(el) {
        const parent = nodeOps.parentNode(el);
        // element may have already been removed due to v-html / v-text
        if (isDef(parent)) {
            nodeOps.removeChild(parent, el);
        }
    }

    function isUnknownElement(vnode, inVPre) {
        return (
            !inVPre &&
            !vnode.ns &&
            !(
                config.ignoredElements.length &&
                config.ignoredElements.some(ignore => {
                    return isRegExp(ignore)
                        ? ignore.test(vnode.tag)
                        : ignore === vnode.tag;
                })
            ) &&
            config.isUnknownElement(vnode.tag)
        );
    }

    let creatingElmInVPre = 0;

    function createElm(
        vnode,
        insertedVnodeQueue,
        parentElm,
        refElm,
        nested,
        ownerArray,
        index
    ) {
        if (isDef(vnode.elm) && isDef(ownerArray)) {
            //这个VNODE用于以前的渲染！现在它被用作一个新节点，当它用作插入参考节点时，覆盖它的elm将导致潜在的补丁错误。相反，我们在为节点创建关联的DOM元素之前应该克隆该节点。
            // This vnode was used in a previous render!
            // now it's used as a new node, overwriting its elm would cause
            // potential patch errors down the road when it's used as an insertion
            // reference node. Instead, we clone the node on-demand before creating
            // associated DOM element for it.
            vnode = ownerArray[index] = cloneVNode(vnode);
        }

        vnode.isRootInsert = !nested; // for transition enter check
        if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
            return;
        }

        const data = vnode.data;
        const children = vnode.children;
        const tag = vnode.tag;
        if (isDef(tag)) {
            if (process.env.NODE_ENV !== "production") {
                if (data && data.pre) {
                    creatingElmInVPre++;
                }
                if (isUnknownElement(vnode, creatingElmInVPre)) {
                    warn(
                        "Unknown custom element: <" +
                            tag +
                            "> - did you " +
                            "register the component correctly? For recursive components, " +
                            'make sure to provide the "name" option.',
                        vnode.context
                    );
                }
            }

            vnode.elm = vnode.ns
                ? nodeOps.createElementNS(vnode.ns, tag) //创建一个具有指定的命名空间的元素。
                : nodeOps.createElement(tag, vnode);
            setScope(vnode);

            /* istanbul ignore if */
            if (__WEEX__) {
                // in Weex, the default insertion order is parent-first.
                // List items can be optimized to use children-first insertion
                // with append="tree".
                const appendAsTree = isDef(data) && isTrue(data.appendAsTree);
                if (!appendAsTree) {
                    if (isDef(data)) {
                        invokeCreateHooks(vnode, insertedVnodeQueue);
                    }
                    insert(parentElm, vnode.elm, refElm);
                }
                createChildren(vnode, children, insertedVnodeQueue);
                if (appendAsTree) {
                    if (isDef(data)) {
                        invokeCreateHooks(vnode, insertedVnodeQueue);
                    }
                    insert(parentElm, vnode.elm, refElm);
                }
            } else {
                createChildren(vnode, children, insertedVnodeQueue);
                if (isDef(data)) {
                    invokeCreateHooks(vnode, insertedVnodeQueue);
                }
                insert(parentElm, vnode.elm, refElm);
            }

            if (process.env.NODE_ENV !== "production" && data && data.pre) {
                creatingElmInVPre--;
            }
        } else if (isTrue(vnode.isComment)) {
            vnode.elm = nodeOps.createComment(vnode.text);
            insert(parentElm, vnode.elm, refElm);
        } else {
            vnode.elm = nodeOps.createTextNode(vnode.text);
            insert(parentElm, vnode.elm, refElm);
        }
    }

    function createComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
        let i = vnode.data;
        if (isDef(i)) {
            const isReactivated = isDef(vnode.componentInstance) && i.keepAlive;
            if (isDef((i = i.hook)) && isDef((i = i.init))) {
                i(vnode, false /* hydrating */);
            }
            // after calling the init hook, if the vnode is a child component
            // it should've created a child instance and mounted it. the child
            // component also has set the placeholder vnode's elm.
            // in that case we can just return the element and be done.
            if (isDef(vnode.componentInstance)) {
                initComponent(vnode, insertedVnodeQueue);
                insert(parentElm, vnode.elm, refElm);
                if (isTrue(isReactivated)) {
                    reactivateComponent(
                        vnode,
                        insertedVnodeQueue,
                        parentElm,
                        refElm
                    );
                }
                return true;
            }
        }
    }

    function initComponent(vnode, insertedVnodeQueue) {
        if (isDef(vnode.data.pendingInsert)) {
            insertedVnodeQueue.push.apply(
                insertedVnodeQueue,
                vnode.data.pendingInsert
            );
            vnode.data.pendingInsert = null;
        }
        vnode.elm = vnode.componentInstance.$el;
        if (isPatchable(vnode)) {
            invokeCreateHooks(vnode, insertedVnodeQueue);
            setScope(vnode);
        } else {
            // empty component root.
            // skip all element-related modules except for ref (#3455)
            registerRef(vnode);
            // make sure to invoke the insert hook
            insertedVnodeQueue.push(vnode);
        }
    }

    function reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
        let i;
        // hack for #4339: a reactivated component with inner transition
        // does not trigger because the inner node's created hooks are not called
        // again. It's not ideal to involve module-specific logic in here but
        // there doesn't seem to be a better way to do it.
        let innerNode = vnode;
        while (innerNode.componentInstance) {
            innerNode = innerNode.componentInstance._vnode;
            if (isDef((i = innerNode.data)) && isDef((i = i.transition))) {
                for (i = 0; i < cbs.activate.length; ++i) {
                    cbs.activate[i](emptyNode, innerNode);
                }
                insertedVnodeQueue.push(innerNode);
                break;
            }
        }
        // unlike a newly created component,
        // a reactivated keep-alive component doesn't insert itself
        insert(parentElm, vnode.elm, refElm);
    }

    /*插入Dom节点*/
    function insert(parent, elm, ref) {
        if (isDef(parent)) {
            if (isDef(ref)) {
                if (nodeOps.parentNode(ref) === parent) {
                    nodeOps.insertBefore(parent, elm, ref);
                }
            } else {
                nodeOps.appendChild(parent, elm);
            }
        }
    }

    function createChildren(vnode, children, insertedVnodeQueue) {
        if (Array.isArray(children)) {
            if (process.env.NODE_ENV !== "production") {
                checkDuplicateKeys(children);
            }
            for (let i = 0; i < children.length; ++i) {
                createElm(
                    children[i],
                    insertedVnodeQueue,
                    vnode.elm,
                    null,
                    true,
                    children,
                    i
                );
            }
        } else if (isPrimitive(vnode.text)) {
            nodeOps.appendChild(
                vnode.elm,
                nodeOps.createTextNode(String(vnode.text))
            );
        }
    }

    /** 是否可patch，检测tag是否定义*/
    function isPatchable(vnode) {
        while (vnode.componentInstance) {
            vnode = vnode.componentInstance._vnode;
        }
        return isDef(vnode.tag);
    }
    /**调用创建的钩子函数*/
    function invokeCreateHooks(vnode, insertedVnodeQueue) {
        for (let i = 0; i < cbs.create.length; ++i) {
            cbs.create[i](emptyNode, vnode);
        }
        i = vnode.data.hook; // Reuse variable
        if (isDef(i)) {
            if (isDef(i.create)) i.create(emptyNode, vnode);
            if (isDef(i.insert)) insertedVnodeQueue.push(vnode);
        }
    }

    // set scope id attribute for scoped CSS.
    // this is implemented as a special case to avoid the overhead
    // of going through the normal attribute patching process.
    /*为scoped CSS 设置scoped id*/
    function setScope(vnode) {
        let i;
        if (isDef((i = vnode.fnScopeId))) {
            nodeOps.setStyleScope(vnode.elm, i);
        } else {
            let ancestor = vnode;
            while (ancestor) {
                if (
                    isDef((i = ancestor.context)) &&
                    isDef((i = i.$options._scopeId))
                ) {
                    nodeOps.setStyleScope(vnode.elm, i);
                }
                ancestor = ancestor.parent;
            }
        }
        // for slot content they should also get the scopeId from the host instance.
        if (
            isDef((i = activeInstance)) &&
            i !== vnode.context &&
            i !== vnode.fnContext &&
            isDef((i = i.$options._scopeId))
        ) {
            nodeOps.setStyleScope(vnode.elm, i);
        }
    }
    /**添加虚节点 */
    function addVnodes(
        parentElm,
        refElm,
        vnodes,
        startIdx,
        endIdx,
        insertedVnodeQueue
    ) {
        for (; startIdx <= endIdx; ++startIdx) {
            createElm(
                vnodes[startIdx],
                insertedVnodeQueue,
                parentElm,
                refElm,
                false,
                vnodes,
                startIdx
            );
        }
    }
    /*调用销毁的钩子函数*/
    function invokeDestroyHook(vnode) {
        let i, j;
        const data = vnode.data;
        if (isDef(data)) {
            if (isDef((i = data.hook)) && isDef((i = i.destroy))) i(vnode);
            for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
        }
        if (isDef((i = vnode.children))) {
            for (j = 0; j < vnode.children.length; ++j) {
                invokeDestroyHook(vnode.children[j]);
            }
        }
    }
    /** 移除节点 */
    function removeVnodes(parentElm, vnodes, startIdx, endIdx) {
        for (; startIdx <= endIdx; ++startIdx) {
            const ch = vnodes[startIdx];
            if (isDef(ch)) {
                if (isDef(ch.tag)) {
                    removeAndInvokeRemoveHook(ch);
                    invokeDestroyHook(ch);
                } else {
                    // Text node
                    removeNode(ch.elm);
                }
            }
        }
    }

    function removeAndInvokeRemoveHook(vnode, rm) {
        if (isDef(rm) || isDef(vnode.data)) {
            let i;
            const listeners = cbs.remove.length + 1;
            if (isDef(rm)) {
                // we have a recursively passed down rm callback
                // increase the listeners count
                rm.listeners += listeners;
            } else {
                // directly removing
                rm = createRmCb(vnode.elm, listeners);
            }
            // recursively invoke hooks on child component root node
            if (
                isDef((i = vnode.componentInstance)) &&
                isDef((i = i._vnode)) &&
                isDef(i.data)
            ) {
                removeAndInvokeRemoveHook(i, rm);
            }
            for (i = 0; i < cbs.remove.length; ++i) {
                cbs.remove[i](vnode, rm);
            }
            if (isDef((i = vnode.data.hook)) && isDef((i = i.remove))) {
                i(vnode, rm);
            } else {
                rm();
            }
        } else {
            removeNode(vnode.elm);
        }
    }
    /** 更新子节点 diff 核心  */
    function updateChildren(
        parentElm, //父级Dom节点
        oldCh, //oldVNode chirdren
        newCh, //newVNode chirdren
        insertedVnodeQueue,
        removeOnly
    ) {
        let oldStartIdx = 0;
        let newStartIdx = 0;
        let oldEndIdx = oldCh.length - 1;
        let oldStartVnode = oldCh[0];
        let oldEndVnode = oldCh[oldEndIdx];
        let newEndIdx = newCh.length - 1;
        let newStartVnode = newCh[0];
        let newEndVnode = newCh[newEndIdx];
        let oldKeyToIdx, idxInOld, vnodeToMove, refElm;

        // removeOnly is a special flag used only by <transition-group>
        // to ensure removed elements stay in correct relative positions
        // during leaving transitions
        const canMove = !removeOnly;

        if (process.env.NODE_ENV !== "production") {
            checkDuplicateKeys(newCh);
        }

        while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
            if (isUndef(oldStartVnode)) {
                oldStartVnode = oldCh[++oldStartIdx]; // Vnode has been moved left
            } else if (isUndef(oldEndVnode)) {
                oldEndVnode = oldCh[--oldEndIdx];
            } else if (sameVnode(oldStartVnode, newStartVnode)) {
                patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
                oldStartVnode = oldCh[++oldStartIdx];
                newStartVnode = newCh[++newStartIdx];
            } else if (sameVnode(oldEndVnode, newEndVnode)) {
                patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);
                oldEndVnode = oldCh[--oldEndIdx];
                newEndVnode = newCh[--newEndIdx];
            } else if (sameVnode(oldStartVnode, newEndVnode)) {
                // Vnode moved right
                patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);
                canMove &&
                    nodeOps.insertBefore(
                        parentElm,
                        oldStartVnode.elm,
                        nodeOps.nextSibling(oldEndVnode.elm)
                    );
                oldStartVnode = oldCh[++oldStartIdx];
                newEndVnode = newCh[--newEndIdx];
            } else if (sameVnode(oldEndVnode, newStartVnode)) {
                // Vnode moved left
                patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
                canMove &&
                    nodeOps.insertBefore(
                        parentElm,
                        oldEndVnode.elm,
                        oldStartVnode.elm
                    );
                oldEndVnode = oldCh[--oldEndIdx];
                newStartVnode = newCh[++newStartIdx];
            } else {
                /*
          生成一个key与旧VNode的key对应的哈希表（只有第一次进来undefined的时候会生成，也为后面检测重复的key值做铺垫）
          比如childre是这样的 [{xx: xx, key: 'key0'}, {xx: xx, key: 'key1'}, {xx: xx, key: 'key2'}]  beginIdx = 0   endIdx = 2  
          结果生成{key0: 0, key1: 1, key2: 2}
        */
                if (isUndef(oldKeyToIdx))
                    oldKeyToIdx = createKeyToOldIdx(
                        oldCh,
                        oldStartIdx,
                        oldEndIdx
                    );
                /*如果newStartVnode新的VNode节点存在key并且这个key在oldVnode中能找到则返回这个节点的idxInOld（即第几个节点，下标）*/
                idxInOld = isDef(newStartVnode.key)
                    ? oldKeyToIdx[newStartVnode.key]
                    : findIdxInOld(
                          newStartVnode,
                          oldCh,
                          oldStartIdx,
                          oldEndIdx
                      );
                if (isUndef(idxInOld)) {
                    /*newStartVnode没有key或者是该key没有在老节点中找到则创建一个新的节点*/
                    // New element
                    createElm(
                        newStartVnode,
                        insertedVnodeQueue,
                        parentElm,
                        oldStartVnode.elm,
                        false,
                        newCh,
                        newStartIdx
                    );
                } else {
                    /*获取同key的老节点*/
                    vnodeToMove = oldCh[idxInOld];
                    if (sameVnode(vnodeToMove, newStartVnode)) {
                        patchVnode(
                            vnodeToMove,
                            newStartVnode,
                            insertedVnodeQueue
                        );
                        oldCh[idxInOld] = undefined;
                        canMove &&
                            nodeOps.insertBefore(
                                parentElm,
                                vnodeToMove.elm,
                                oldStartVnode.elm
                            );
                    } else {
                        // same key but different element. treat as new element
                        createElm(
                            newStartVnode,
                            insertedVnodeQueue,
                            parentElm,
                            oldStartVnode.elm,
                            false,
                            newCh,
                            newStartIdx
                        );
                    }
                }
                newStartVnode = newCh[++newStartIdx];
            }
        }
        if (oldStartIdx > oldEndIdx) {
            refElm = isUndef(newCh[newEndIdx + 1])
                ? null
                : newCh[newEndIdx + 1].elm;
            addVnodes(
                parentElm,
                refElm,
                newCh,
                newStartIdx,
                newEndIdx,
                insertedVnodeQueue
            );
        } else if (newStartIdx > newEndIdx) {
            removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
        }
    }

    function checkDuplicateKeys(children) {
        const seenKeys = {};
        for (let i = 0; i < children.length; i++) {
            const vnode = children[i];
            const key = vnode.key;
            if (isDef(key)) {
                if (seenKeys[key]) {
                    warn(
                        `Duplicate keys detected: '${key}'. This may cause an update error.`,
                        vnode.context
                    );
                } else {
                    seenKeys[key] = true;
                }
            }
        }
    }

    function findIdxInOld(node, oldCh, start, end) {
        for (let i = start; i < end; i++) {
            const c = oldCh[i];
            if (isDef(c) && sameVnode(node, c)) return i;
        }
    }

    /**
     * 总结：
     * 1.如果新旧VNode都是静态的，同时它们的key相同（代表同一节点），并且新的VNode是clone或者是标记了once（标记v-once属性，只渲染一次），那么只需要替换elm以及componentInstance即可。
     * 2.新老节点均有children子节点，则对子节点进行diff操作，调用updateChildren，这个updateChildren也是diff的核心。
     * 3.如果老节点没有子节点而新节点存在子节点，先清空老节点DOM的文本内容，然后为当前DOM节点加入子节点。
     * 4.当新节点没有子节点而老节点有子节点的时候，则移除该DOM节点的所有子节点。
     * 5.当新老节点都无子节点的时候，只是文本的替换。
     *
     */
    function patchVnode(oldVnode, vnode, insertedVnodeQueue, removeOnly) {
        if (oldVnode === vnode) {
            return;
        }

        const elm = (vnode.elm = oldVnode.elm);

        if (isTrue(oldVnode.isAsyncPlaceholder)) {
            if (isDef(vnode.asyncFactory.resolved)) {
                hydrate(oldVnode.elm, vnode, insertedVnodeQueue);
            } else {
                vnode.isAsyncPlaceholder = true;
            }
            return;
        }

        // reuse element for static trees.
        // note we only do this if the vnode is cloned -
        // if the new node is not cloned it means the render functions have been
        // reset by the hot-reload-api and we need to do a proper re-render.
        /*
      如果新旧VNode都是静态的，同时它们的key相同（代表同一节点），
      并且新的VNode是clone或者是标记了once（标记v-once属性，只渲染一次），
      那么只需要替换elm以及componentInstance即可。
    */
        if (
            isTrue(vnode.isStatic) &&
            isTrue(oldVnode.isStatic) &&
            vnode.key === oldVnode.key &&
            (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
        ) {
            vnode.componentInstance = oldVnode.componentInstance;
            return;
        }

        let i;
        const data = vnode.data;
        if (isDef(data) && isDef((i = data.hook)) && isDef((i = i.prepatch))) {
            i(oldVnode, vnode);
        }

        const oldCh = oldVnode.children;
        const ch = vnode.children;
        if (isDef(data) && isPatchable(vnode)) {
            /*调用update回调以及update钩子*/
            for (i = 0; i < cbs.update.length; ++i)
                cbs.update[i](oldVnode, vnode);
            if (isDef((i = data.hook)) && isDef((i = i.update)))
                i(oldVnode, vnode);
        }
        /*如果这个VNode节点没有text文本时*/
        if (isUndef(vnode.text)) {
            if (isDef(oldCh) && isDef(ch)) {
                /*新老节点均有children子节点，则对子节点进行diff操作，调用updateChildren */
                if (oldCh !== ch)
                    updateChildren(
                        elm,
                        oldCh,
                        ch,
                        insertedVnodeQueue,
                        removeOnly
                    );
            } else if (isDef(ch)) {
                /*如果老节点没有子节点而新节点存在子节点，先清空elm的文本内容，然后为当前节点加入子节点*/
                if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, "");
                addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
            } else if (isDef(oldCh)) {
                /*当新节点没有子节点而老节点有子节点的时候，则移除所有ele的子节点*/
                removeVnodes(elm, oldCh, 0, oldCh.length - 1);
            } else if (isDef(oldVnode.text)) {
                /*当新老节点都无子节点的时候，只是文本的替换，所以直接去除ele的文本*/
                nodeOps.setTextContent(elm, "");
            }
        } else if (oldVnode.text !== vnode.text) {
            /*当新老节点text不一样时，直接替换这段文本*/
            nodeOps.setTextContent(elm, vnode.text);
        }
        /*调用postpatch钩子*/
        if (isDef(data)) {
            if (isDef((i = data.hook)) && isDef((i = i.postpatch)))
                i(oldVnode, vnode);
        }
    }

    function invokeInsertHook(vnode, queue, initial) {
        // delay insert hooks for component root nodes, invoke them after the
        // element is really inserted
        if (isTrue(initial) && isDef(vnode.parent)) {
            vnode.parent.data.pendingInsert = queue;
        } else {
            for (let i = 0; i < queue.length; ++i) {
                queue[i].data.hook.insert(queue[i]);
            }
        }
    }

    let hydrationBailed = false;
    // list of modules that can skip create hook during hydration because they
    // are already rendered on the client or has no need for initialization
    // Note: style is excluded because it relies on initial clone for future
    // deep updates (#7063).
    const isRenderedModule = makeMap("attrs,class,staticClass,staticStyle,key");

    // Note: this is a browser-only function so we can assume elms are DOM nodes.
    function hydrate(elm, vnode, insertedVnodeQueue, inVPre) {
        let i;
        const { tag, data, children } = vnode;
        inVPre = inVPre || (data && data.pre);
        vnode.elm = elm;

        if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
            vnode.isAsyncPlaceholder = true;
            return true;
        }
        // assert node match
        if (process.env.NODE_ENV !== "production") {
            if (!assertNodeMatch(elm, vnode, inVPre)) {
                return false;
            }
        }
        if (isDef(data)) {
            if (isDef((i = data.hook)) && isDef((i = i.init)))
                i(vnode, true /* hydrating */);
            if (isDef((i = vnode.componentInstance))) {
                // child component. it should have hydrated its own tree.
                initComponent(vnode, insertedVnodeQueue);
                return true;
            }
        }
        if (isDef(tag)) {
            if (isDef(children)) {
                // empty element, allow client to pick up and populate children
                if (!elm.hasChildNodes()) {
                    createChildren(vnode, children, insertedVnodeQueue);
                } else {
                    // v-html and domProps: innerHTML
                    if (
                        isDef((i = data)) &&
                        isDef((i = i.domProps)) &&
                        isDef((i = i.innerHTML))
                    ) {
                        if (i !== elm.innerHTML) {
                            /* istanbul ignore if */
                            if (
                                process.env.NODE_ENV !== "production" &&
                                typeof console !== "undefined" &&
                                !hydrationBailed
                            ) {
                                hydrationBailed = true;
                                console.warn("Parent: ", elm);
                                console.warn("server innerHTML: ", i);
                                console.warn(
                                    "client innerHTML: ",
                                    elm.innerHTML
                                );
                            }
                            return false;
                        }
                    } else {
                        // iterate and compare children lists
                        let childrenMatch = true;
                        let childNode = elm.firstChild;
                        for (let i = 0; i < children.length; i++) {
                            if (
                                !childNode ||
                                !hydrate(
                                    childNode,
                                    children[i],
                                    insertedVnodeQueue,
                                    inVPre
                                )
                            ) {
                                childrenMatch = false;
                                break;
                            }
                            childNode = childNode.nextSibling;
                        }
                        // if childNode is not null, it means the actual childNodes list is
                        // longer than the virtual children list.
                        if (!childrenMatch || childNode) {
                            /* istanbul ignore if */
                            if (
                                process.env.NODE_ENV !== "production" &&
                                typeof console !== "undefined" &&
                                !hydrationBailed
                            ) {
                                hydrationBailed = true;
                                console.warn("Parent: ", elm);
                                console.warn(
                                    "Mismatching childNodes vs. VNodes: ",
                                    elm.childNodes,
                                    children
                                );
                            }
                            return false;
                        }
                    }
                }
            }
            if (isDef(data)) {
                let fullInvoke = false;
                for (const key in data) {
                    if (!isRenderedModule(key)) {
                        fullInvoke = true;
                        invokeCreateHooks(vnode, insertedVnodeQueue);
                        break;
                    }
                }
                if (!fullInvoke && data["class"]) {
                    // ensure collecting deps for deep class bindings for future updates
                    traverse(data["class"]);
                }
            }
        } else if (elm.data !== vnode.text) {
            elm.data = vnode.text;
        }
        return true;
    }

    function assertNodeMatch(node, vnode, inVPre) {
        if (isDef(vnode.tag)) {
            return (
                vnode.tag.indexOf("vue-component") === 0 ||
                (!isUnknownElement(vnode, inVPre) &&
                    vnode.tag.toLowerCase() ===
                        (node.tagName && node.tagName.toLowerCase()))
            );
        } else {
            return node.nodeType === (vnode.isComment ? 8 : 3);
        }
    }
    /**
     * 总结：
     * 当oldVnode与vnode在sameVnode的时候才会进行patchVnode，也就是新旧VNode节点判定为同一节点的时候才会进行patchVnode这个过程，否则就是创建新的DOM，移除旧的DOM。
     * */
    return function patch(oldVnode, vnode, hydrating, removeOnly) {
        /*vnode不存在则直接调用销毁钩子*/
        if (isUndef(vnode)) {
            if (isDef(oldVnode)) invokeDestroyHook(oldVnode);
            return;
        }

        let isInitialPatch = false;
        const insertedVnodeQueue = [];

        if (isUndef(oldVnode)) {
            /*oldVnode未定义的时候，创建一个新的节点*/
            // empty mount (likely as component), create new root element
            isInitialPatch = true;
            createElm(vnode, insertedVnodeQueue);
        } else {
            /*标记旧的VNode是否有nodeType*/
            const isRealElement = isDef(oldVnode.nodeType);
            /*是同一个节点的时候直接修改现有的节点*/
            if (!isRealElement && sameVnode(oldVnode, vnode)) {
                // patch existing root node
                patchVnode(oldVnode, vnode, insertedVnodeQueue, removeOnly);
            } else {
                if (isRealElement) {
                    // mounting to a real element
                    // check if this is server-rendered content and if we can perform
                    // a successful hydration.
                    if (
                        oldVnode.nodeType === 1 &&
                        oldVnode.hasAttribute(SSR_ATTR)
                    ) {
                        /*当旧的VNode是服务端渲染的元素，hydrating记为true*/
                        oldVnode.removeAttribute(SSR_ATTR);
                        hydrating = true;
                    }
                    if (isTrue(hydrating)) {
                        /*需要合并到真实DOM上*/
                        if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
                            invokeInsertHook(vnode, insertedVnodeQueue, true);
                            return oldVnode;
                        } else if (process.env.NODE_ENV !== "production") {
                            warn(
                                "The client-side rendered virtual DOM tree is not matching " +
                                    "server-rendered content. This is likely caused by incorrect " +
                                    "HTML markup, for example nesting block-level elements inside " +
                                    "<p>, or missing <tbody>. Bailing hydration and performing " +
                                    "full client-side render."
                            );
                        }
                    }
                    // either not server-rendered, or hydration failed.
                    // create an empty node and replace it
                    /*如果不是服务端渲染或者合并到真实DOM失败，则创建一个空的VNode节点替换它*/
                    oldVnode = emptyNodeAt(oldVnode);
                }

                // replacing existing element
                const oldElm = oldVnode.elm;
                const parentElm = nodeOps.parentNode(oldElm);

                // create new node
                createElm(
                    vnode,
                    insertedVnodeQueue,
                    // extremely rare edge case: do not insert if old element is in a
                    // leaving transition. Only happens when combining transition +
                    // keep-alive + HOCs. (#4590)
                    oldElm._leaveCb ? null : parentElm,
                    nodeOps.nextSibling(oldElm)
                );

                // update parent placeholder node element, recursively
                if (isDef(vnode.parent)) {
                    /*组件根节点被替换，遍历更新父节点element*/
                    let ancestor = vnode.parent;
                    const patchable = isPatchable(vnode);
                    while (ancestor) {
                        for (let i = 0; i < cbs.destroy.length; ++i) {
                            cbs.destroy[i](ancestor);
                        }
                        ancestor.elm = vnode.elm;
                        if (patchable) {
                            for (let i = 0; i < cbs.create.length; ++i) {
                                cbs.create[i](emptyNode, ancestor);
                            }
                            // #6513
                            // invoke insert hooks that may have been merged by create hooks.
                            // e.g. for directives that uses the "inserted" hook.
                            const insert = ancestor.data.hook.insert;
                            if (insert.merged) {
                                // start at index 1 to avoid re-invoking component mounted hook
                                for (let i = 1; i < insert.fns.length; i++) {
                                    insert.fns[i]();
                                }
                            }
                        } else {
                            registerRef(ancestor);
                        }
                        ancestor = ancestor.parent;
                    }
                }

                // destroy old node
                if (isDef(parentElm)) {
                    /*移除老节点*/
                    removeVnodes(parentElm, [oldVnode], 0, 0);
                } else if (isDef(oldVnode.tag)) {
                    /*调用destroy钩子*/
                    invokeDestroyHook(oldVnode);
                }
            }
        }
        /*调用insert钩子*/
        invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch);
        return vnode.elm;
    };
}
