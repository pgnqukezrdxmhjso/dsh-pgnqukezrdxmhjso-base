
import { Objects } from './Objects.ts'

// oxlint-disable-next-line typescript/no-explicit-any
type Constructor<T = any> = new (...args: any[]) => T
type FxxkTs = Record<PropertyKey, unknown>
type FxxkTsFn = Record<PropertyKey, (...args: unknown[]) => unknown>

export class BeanHelper {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  static buildLazyProxyHandler<T extends object>(
    getObj: () => T,
    options?: BeanHelper.ProxyOptions,
  ) {
    const handlerMap: Record<PropertyKey, (target: FxxkTs, ...args: unknown[]) => unknown> = {}
    let needInit = true
    Reflect.ownKeys(Reflect).forEach((key) => {
      handlerMap[key] = (target: FxxkTs, ...args: unknown[]): unknown => {
        const obj = getObj()
        if (Objects.isNull(obj)) {
          return obj
        }
        if (needInit) {
          needInit = false
          Reflect.ownKeys(obj).forEach(k => (target[k] = (obj as FxxkTs)[k]))
          Reflect.setPrototypeOf(target, Reflect.getPrototypeOf(obj))
          target[BeanHelper.PlaceholderObject] = true
        }
        if (key === 'set') {
          Reflect.set(target, args[0] as PropertyKey, args[1])
        } else if (key === 'deleteProperty') {
          Reflect.deleteProperty(target, args[0] as PropertyKey)
        }
        let res: unknown
        if (key === 'get') {
          res = options?.hooks?.get
            ? options.hooks.get(obj, args[0] as PropertyKey)
            : Reflect[key].apply(Reflect, [obj, args[0] as PropertyKey])
          if (typeof res === 'function' && !options?.notBind) {
            res = res.bind(options?.bindOriginal ? obj : args[1])
          }
        } else {
          res = (Reflect as FxxkTsFn)[key]?.apply(Reflect, [obj, ...args])
        }
        return res
      }
    })
    return handlerMap
  }

  static buildLazyProxy<T extends object>(
    getObj: () => T,
    options?: BeanHelper.ProxyOptions,
  ) {
    return new Proxy<T>(
      {} as T,
      BeanHelper.buildLazyProxyHandler<T>(getObj, options),
    )
  }

  private classPool: BeanHelper.ClassInfo<object>[] = []

  private touchAll() {
    let i = 0
    let len = 0
    while (len != this.classPool.length && i++ < 99999) {
      len = this.classPool.length
      this.classPool.forEach((classInfo) => {
        if (classInfo.proxy) {
          Reflect.get(classInfo.proxy, '__')
        }
      })
    }
  }

  async start() {
    this.touchAll()
    for (const classInfo of this.classPool) {
      if (classInfo.proxy instanceof BeanHelper.BeanType) {
        await classInfo.proxy.start()
      }
    }
  }

  async destroy() {
    for (const classInfo of this.classPool) {
      if (classInfo.proxy instanceof BeanHelper.BeanType) {
        await classInfo.proxy.destroy()
      }
    }
    this.classPool.length = 0
  }

  instance<T extends BeanHelper.BeanType>(
    clazz: Constructor<T>,
    options?: BeanHelper.ProxyOptions,
  ): T {
    let classInfo = this.classPool.find(
      classInfo => classInfo.class === clazz && !!classInfo.proxy,
    )
    if (classInfo) {
      return classInfo.proxy as T
    }
    classInfo = {
      name: clazz.name,
      class: clazz,
    }

    classInfo.proxy = BeanHelper.buildLazyProxy(() => {
      if (!classInfo.instance && classInfo.class) {
        classInfo.instance = new classInfo.class(this)
      }
      return classInfo.instance as T
    }, options)

    this.classPool.push(classInfo)
    return classInfo.proxy as T
  }

  proxy<T extends object>(
    getObj: () => T,
    name: string,
    options?: BeanHelper.ProxyOptions,
  ) {
    const proxy = BeanHelper.buildLazyProxy(getObj, options)
    const classInfo: BeanHelper.ClassInfo<T> = {
      name,
      proxy,
    }

    this.classPool.push(classInfo)
    return classInfo.proxy
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  getByName<T>(name: string) {
    const classInfo = this.classPool.find(
      classInfo => classInfo.name === name,
    )
    return (classInfo?.proxy || classInfo?.instance) as T
  }

  put<T extends object>(instance: T, name?: string, clazz?: Constructor<T>) {
    if (!clazz) {
      clazz = instance.constructor as Constructor<T>
    }
    if (!name) {
      name = clazz.name
    }
    this.classPool.push({
      name: name,
      class: clazz,
      instance: instance,
    })
    return instance
  }
}

export namespace BeanHelper {
  export const PlaceholderObject = Symbol('PlaceholderObject')
  export abstract class BeanType {
    constructor(protected beanHelper: BeanHelper) {
      return this
    }

    start(): void | Promise<void> { }
    destroy(): void | Promise<void> { }
  }
  export interface ClassInfo<T extends object> {
    name: string
    class?: Constructor<T>
    instance?: T
    proxy?: T
  }

  export interface ProxyOptions {
    notBind?: boolean
    bindOriginal?: boolean
    hooks?: {
      get: (obj: unknown, prop: PropertyKey) => unknown
    }
  }
}
