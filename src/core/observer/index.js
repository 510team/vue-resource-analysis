/* @flow */

import Dep from "./dep";
import VNode from "../vdom/vnode";
import { arrayMethods } from "./array";
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from "../util/index";

const arrayKeys = Object.getOwnPropertyNames(arrayMethods);

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true;

export function toggleObserving(value: boolean) {
  shouldObserve = value;
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that has this object as root $data

  //value就是data，是对象或者数组
  constructor(value: any) {
    // 把自身赋值到observer实例
    this.value = value;
    // 生成一个dep对象
    this.dep = new Dep();

    this.vmCount = 0;

    //给自身添加一个__ob__属性，引用observer实例
    def(value, "__ob__", this);

    // 如果value是数组，就观测数组的每个元素
    if (Array.isArray(value)) {
      if (hasProto) {
        protoAugment(value, arrayMethods);
      } else {
        copyAugment(value, arrayMethods, arrayKeys);
      }
      this.observeArray(value);
    } else {
      // 如果value是对象,就遍历这个对象的属性
      this.walk(value);
    }
  }

  /**
   * Walk through each property and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   * 遍历对象的属性
   */
  walk(obj: Object) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i]);
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray(items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i]);
    }
  }
}

// helpers

/**
 * Augment an target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment(target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src;
  /* eslint-enable no-proto */
}

/**
 * Augment an target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment(target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i];
    def(target, key, src[key]);
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 * 开始观测对象或数组
 */
export function observe(value: any, asRootData: ?boolean): Observer | void {
  // data必须是对象或数组,否则不继续
  if (!isObject(value) || value instanceof VNode) {
    return;
  }
  let ob: Observer | void;
  // 如果data有__ob__属性,并且__ob__属性引用的是Observer的实例,则ob = value.__ob__
  if (hasOwn(value, "__ob__") && value.__ob__ instanceof Observer) {
    ob = value.__ob__;
  } else if (
    // 如果value是数组或普通对象且可继承，则用它来初始化一个Observer实例
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value);
  }
  if (asRootData && ob) {
    ob.vmCount++;
  }
  // 返回observer实例
  return ob;
}

/**
 * Define a reactive property on an Object.
 * 响应化一个属性
 */
export function defineReactive(
  obj: Object, // 对象
  key: string, // 对象的某个key
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // 生成一个dep实例，每个key都在get和set中引用了一个dep
  const dep = new Dep();

  // 获取属性原来的属性描述对象,若该属性为不可配置的，则不继续
  const property = Object.getOwnPropertyDescriptor(obj, key);
  if (property && property.configurable === false) {
    return;
  }

  // cater for pre-defined getter/setters
  // 获取属性已有的getter和setter方法
  const getter = property && property.get;
  const setter = property && property.set;

  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]; // 获取属性的值
  }

  // 观测属性的值
  let childOb = !shallow && observe(val);

  // 定义这个属性的get和set
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // 读取这个属性值的时候执行get
    get: function reactiveGetter() {
      // 这个属性若有原getter，则执行原getter读取值，否则直接读取属性的值
      const value = getter ? getter.call(obj) : val;
      // 如果有依赖，就收集依赖到这个属性的dep对象的subs里
      if (Dep.target) {
        dep.depend();
        // {
        //   person:[1,{name:2}]
        // }
        // 如果这个属性的值可观测（是对象或者数组才能被观测），就收集同样的依赖到这个属性值的observer实例的dep中
        if (childOb) {
          childOb.dep.depend();
          // 如果这个值是数组，且数组的项已被观测（是对象或者数组才能被观测），就收集同样的依赖到每个数组元素
          if (Array.isArray(value)) {
            dependArray(value);
          }
        }
      }
      // 返回属性的值
      return value;
    },
    // 改变这个属性值的时候执行set
    set: function reactiveSetter(newVal) {
      // 获取属性的值
      const value = getter ? getter.call(obj) : val;

      /* eslint-disable no-self-compare */
      // 如果属性的新值和旧值相等或者新值和旧值都是NaN，则不继续
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return;
      }
      /* eslint-enable no-self-compare */
      // 如果有自定义setter通过参数传入，则执行自定义的setter
      if (process.env.NODE_ENV !== "production" && customSetter) {
        customSetter();
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return;
      // 如果这个属性已有setter，则执行已有setter，否则将新值赋值给这个属性
      if (setter) {
        setter.call(obj, newVal);
      } else {
        val = newVal;
      }
      // 新值也要被观测
      childOb = !shallow && observe(newVal);
      // 触发此属性收集的依赖
      dep.notify();
    }
  });
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set(target: Array<any> | Object, key: any, val: any): any {
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key);
    target.splice(key, 1, val);
    return val;
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val;
    return val;
  }
  const ob = (target: any).__ob__;
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid adding reactive properties to a Vue instance or its root $data " +
          "at runtime - declare it upfront in the data option."
      );
    return val;
  }
  if (!ob) {
    target[key] = val;
    return val;
  }
  defineReactive(ob.value, key, val);
  ob.dep.notify();
  return val;
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del(target: Array<any> | Object, key: any) {
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1);
    return;
  }
  const ob = (target: any).__ob__;
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid deleting properties on a Vue instance or its root $data " +
          "- just set it to null."
      );
    return;
  }
  if (!hasOwn(target, key)) {
    return;
  }
  delete target[key];
  if (!ob) {
    return;
  }
  ob.dep.notify();
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray(value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i];
    e && e.__ob__ && e.__ob__.dep.depend();
    if (Array.isArray(e)) {
      dependArray(e);
    }
  }
}
