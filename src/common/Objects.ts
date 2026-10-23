export namespace Objects {
  export type Null = null | undefined
  export type Empty = Null | Record<string, never> | []
  export type Enumerable<T = unknown> = { [s: string]: T } | ArrayLike<T>

  export function isNull(obj: unknown): obj is Null {
    return obj === null || obj === undefined
  }

  export function isNotNull<T>(obj: T): obj is Exclude<T, Null> {
    return !Objects.isNull(obj)
  }
  export function isEmpty(obj: unknown): obj is Empty {
    return (
      Objects.isNull(obj) ||
      (typeof obj === 'object' && Object.keys(obj).length < 1)
    )
  }
  export function isNotEmpty<T>(obj: T): obj is Exclude<T, Empty> {
    return !Objects.isEmpty(obj)
  }

  export async function deepForEach(
    obj: object,
    fn: (
      value: unknown,
      key: string,
      obj: object,
      parentPath: string[],
      root: object,
    ) => Promise<void | false> | void | false,
    {
      onObject = true,
      onValue = true,
      parentPath = [] as string[],
      root = obj,
    } = {},
  ) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        if (onObject) {
          if (await fn(value, key, obj, parentPath, root) === false) {
            return false
          }
        }
        if (await deepForEach(value as object, fn, {
          onObject,
          onValue,
          parentPath: [...parentPath, key],
          root,
        }) === false) {
          return false
        }
      }
      else if (onValue) {
        if (await fn(value, key, obj, parentPath, root) === false) {
          return false
        }
      }
    }
  }

  export async function clone<T>(
    sourceObj: T,
    filter?: (
      value: unknown,
      key: PropertyKey,
      obj: object,
    ) => boolean | Promise<boolean>,
    alreadyObjPool = new WeakMap<object, unknown>(),
  ): Promise<T> {
    if (sourceObj === null || typeof sourceObj !== 'object') {
      return sourceObj
    }

    if (alreadyObjPool.has(sourceObj)) {
      return alreadyObjPool.get(sourceObj) as T
    }

    if (Array.isArray(sourceObj)) {
      const list: unknown[] = []
      alreadyObjPool.set(sourceObj, list)
      for (let i = 0; i < sourceObj.length; i++) {
        const item = sourceObj[i] as unknown
        if (filter && !(await filter(item, i, sourceObj))) {
          continue
        }
        list.push(await Objects.clone(item, filter, alreadyObjPool))
      }
      return list as T
    }
    if (sourceObj.constructor === Object) {
      const obj: Record<PropertyKey, unknown> = {}
      alreadyObjPool.set(sourceObj, obj)
      for (const [key, item] of Object.entries(sourceObj)) {
        if (filter && !(await filter(item, key, sourceObj))) {
          continue
        }
        obj[key] = await Objects.clone(item, filter, alreadyObjPool)
      }
      return obj as T
    }
    return sourceObj
  }
  export function flatten(
    data: unknown,
    rootElements: unknown[] = [],
    alreadyObjPool = new WeakSet<object>(),
  ): unknown[] {
    if (Objects.isNull(data)) {
      return rootElements
    }
    if (typeof data === 'object') {
      if (alreadyObjPool.has(data)) {
        return rootElements
      }
      alreadyObjPool.add(data)
      for (const item of Object.values(data)) {
        Objects.flatten(item, rootElements, alreadyObjPool)
      }
    } else {
      rootElements.push(data)
    }
    return rootElements
  }
  export function parseKeyPath(keyPath: string) {
    // oxlint-disable-next-line @stylistic/max-len
    const r = /((?:\?\.)?\[(?:\d+|'(?:.(?:(?<=\\')|(?<!')))*?(?<!\\)'|"(?:.(?:(?<=\\")|(?<!")))*?(?<!\\)"|`(?:.(?:(?<=\\`)|(?<!`)))*?(?<!\\)`)?])|((?:\??\.|^)[^[\]?.'"`]+)|(.)/g
    const msa = [...keyPath.matchAll(r)]
    const keys: string[] = []
    const abnormal: string[] = []
    let inAbnormal = false
    for (const row of msa) {
      if (!row[3]) {
        inAbnormal = false
        keys.push(row[0])
        continue
      }
      if (!inAbnormal) {
        inAbnormal = true
        abnormal.push('')
      }
      abnormal[abnormal.length - 1] = (abnormal[abnormal.length - 1] || '') + row[0]
    }
    const rawKeys = [...keys]

    const regMap: Record < string , readonly [ RegExp , RegExp ]> = {
      "'": [/^\['|']$/g, /\\'/g],
      '"': [/^\["|"]$/g, /\\"/g],
      '`': [/^\[`|`]$/g, /\\`/g],
    }

    for (let i = 0; i < keys.length; i++) {
      let k = keys[i]
      if (!k) {
        continue
      }
      k = k.replace(/\??\./, '')
      if (k === '[]') {
        k = '__For_Each__'
      } else if (/^\[.+]$/.test(k)) {
        const s = k[1] || ''
        const reg = regMap[s]
        if (reg) {
          k = k.replace(reg[0], '').replace(reg[1], s)
        } else {
          k = k.replace(/^\[|]$/g, '')
        }
      }
      keys[i] = k
    }
    return {
      rawKeys,
      keys,
      abnormal,
    }
  }
  // oxlint-disable-next-line typescript/no-explicit-any
  export function getValuesByPath(obj: any, keyPath: string): unknown {
    const { keys } = Objects.parseKeyPath(keyPath)
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    let target = obj
    let forEach = false
    for (const key of keys) {
      if (!forEach) {
        if (key === '__For_Each__') {
          forEach = true
          // oxlint-disable-next-line typescript/no-unsafe-argument
          target = Object.values(target ?? [])
        } else {
          // oxlint-disable-next-line typescript/no-unsafe-assignment typescript/no-unsafe-member-access
          target = target?.[key]
        }
        continue
      }

      // oxlint-disable-next-line typescript/no-unsafe-member-access
      if (typeof target[Symbol.iterator] !== 'function') {
        break
      }

      const newTargets = []
      for (const item of target) {
        if (!(item instanceof Object)) {
          continue
        }
        if (key === '__For_Each__') {
          // oxlint-disable-next-line typescript/no-unsafe-argument
          newTargets.push(...Object.values(item ?? []))
        } else if (key in item) {
          // oxlint-disable-next-line typescript/no-unsafe-member-access
          newTargets.push(item[key])
        }
      }
      target = newTargets
    }
    return target
  }
}
