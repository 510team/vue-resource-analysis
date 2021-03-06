/* @flow */

import config from "../config";
import { initProxy } from "./proxy";
import { initState } from "./state";
import { initRender } from "./render";
import { initEvents } from "./events";
import { mark, measure } from "../util/perf";
import { initLifecycle, callHook } from "./lifecycle";
import { initProvide, initInjections } from "./inject";
import { extend, mergeOptions, formatComponentName } from "../util/index";

let uid = 0;

export function initMixin(Vue: Class<Component>) {
    // options==={el:'#app,data:{a:1,b:[1,2,3]}}
    Vue.prototype._init = function(options?: Object) {
        const vm: Component = this;
        // a uid
        vm._uid = uid++;

        let startTag, endTag;
        /* istanbul ignore if */
        if (
            process.env.NODE_ENV !== "production" &&
            config.performance &&
            mark
        ) {
            startTag = `vue-perf-start:${vm._uid}`;
            endTag = `vue-perf-end:${vm._uid}`;
            mark(startTag);
        }

        // a flag to avoid this being observed
        vm._isVue = true;
        // merge options
        if (options && options._isComponent) {
            // optimize internal component instantiation 优化内部组件实例
            // since dynamic options merging is pretty slow, and none of the
            // internal component options needs special treatment.
            initInternalComponent(vm, options);
        } else {
            vm.$options = mergeOptions(
                resolveConstructorOptions(vm.constructor),
                options || {},
                vm
            );
        }
        /* istanbul ignore else */
        if (process.env.NODE_ENV !== "production") {
            initProxy(vm);
        } else {
            vm._renderProxy = vm;
        }
        // expose real self
        vm._self = vm;
        initLifecycle(vm); //初始化生命周期
        initEvents(vm); //初始化事件
        initRender(vm); //初始化渲染
        callHook(vm, "beforeCreate");
        initInjections(vm); // resolve injections before data/props
        initState(vm); //vm的状态初始化，prop/data/computed/method/watch都在这里完成初始化
        initProvide(vm); // resolve provide after data/props
        callHook(vm, "created");

        /* istanbul ignore if */
        if (
            process.env.NODE_ENV !== "production" &&
            config.performance &&
            mark
        ) {
            vm._name = formatComponentName(vm, false);
            mark(endTag);
            measure(`vue ${vm._name} init`, startTag, endTag);
        }

        // 将vm实例挂载到dom上（将组件渲染，并且构造 DOM 元素然后塞入页面的过程称为组件的挂载）
        // // options==={el:'#app,data:{a:1,b:[1,2,3]}}
        if (vm.$options.el) {
            // Vue.prototype.$mount = function (
            //     el,
            //     hydrating
            //   ) {
            //     return mountComponent(
            //       this,
            //       el && query(el, this.$document),
            //       hydrating
            //     )
            //   };
            /*src/core/instance/lifecycle.js中的mountComponent方法，*/
            vm.$mount(vm.$options.el);
        }
    };
}

export function initInternalComponent(
    vm: Component,
    options: InternalComponentOptions
) {
    const opts = (vm.$options = Object.create(vm.constructor.options));
    // doing this because it's faster than dynamic enumeration.
    const parentVnode = options._parentVnode;
    opts.parent = options.parent;
    opts._parentVnode = parentVnode;

    const vnodeComponentOptions = parentVnode.componentOptions;
    opts.propsData = vnodeComponentOptions.propsData;
    opts._parentListeners = vnodeComponentOptions.listeners;
    opts._renderChildren = vnodeComponentOptions.children;
    opts._componentTag = vnodeComponentOptions.tag;

    if (options.render) {
        opts.render = options.render;
        opts.staticRenderFns = options.staticRenderFns;
    }
}

export function resolveConstructorOptions(Ctor: Class<Component>) {
    //Vue.options = {
    //   components: {},
    //   directives: {},
    //   filters: {},
    //   _base: Vue
    // }
    let options = Ctor.options;
    if (Ctor.super) {
        const superOptions = resolveConstructorOptions(Ctor.super);
        const cachedSuperOptions = Ctor.superOptions;
        if (superOptions !== cachedSuperOptions) {
            // super option changed,
            // need to resolve new options.
            Ctor.superOptions = superOptions;
            // check if there are any late-modified/attached options (#4976)
            const modifiedOptions = resolveModifiedOptions(Ctor);
            // update base extend options
            if (modifiedOptions) {
                extend(Ctor.extendOptions, modifiedOptions);
            }
            options = Ctor.options = mergeOptions(
                superOptions,
                Ctor.extendOptions
            );
            if (options.name) {
                options.components[options.name] = Ctor;
            }
        }
    }
    return options;
}

function resolveModifiedOptions(Ctor: Class<Component>): ?Object {
    let modified;
    const latest = Ctor.options;
    const extended = Ctor.extendOptions;
    const sealed = Ctor.sealedOptions;
    for (const key in latest) {
        if (latest[key] !== sealed[key]) {
            if (!modified) modified = {};
            modified[key] = dedupe(latest[key], extended[key], sealed[key]);
        }
    }
    return modified;
}

function dedupe(latest, extended, sealed) {
    // compare latest and sealed to ensure lifecycle hooks won't be duplicated
    // between merges
    if (Array.isArray(latest)) {
        const res = [];
        sealed = Array.isArray(sealed) ? sealed : [sealed];
        extended = Array.isArray(extended) ? extended : [extended];
        for (let i = 0; i < latest.length; i++) {
            // push original options and not sealed options to exclude duplicated options
            if (
                extended.indexOf(latest[i]) >= 0 ||
                sealed.indexOf(latest[i]) < 0
            ) {
                res.push(latest[i]);
            }
        }
        return res;
    } else {
        return latest;
    }
}
