type Fn<T = void> = () => T | PromiseLike<T>
type Resolve<T = void> = (value: T | PromiseLike<T>) => void

export interface Lock<T = void> {
  run(fn: Fn<T>): Promise<T>
  await(): Promise<void>
  running(): boolean
}

export class KeyedLocks<T = void> {
  private readonly locks = new Map<PropertyKey, Lock<T>>()

  constructor(private readonly create: () => Lock<T>) {}

  async run(key: PropertyKey, fn: Fn<T>): Promise<T> {
    let lock = this.locks.get(key)
    if (lock === undefined) {
      lock = this.create()
      this.locks.set(key, lock)
    }
    try {
      return await lock.run(fn)
    } finally {
      if (!lock.running()) this.locks.delete(key)
    }
  }

  async await(key: PropertyKey): Promise<void> {
    await this.locks.get(key)?.await()
  }

  running(key: PropertyKey): boolean {
    return this.locks.get(key)?.running() ?? false
  }
}

export class CoalesceLock<T = void> implements Lock<T> {
  private lock?: Promise<T>
  async run(fn: Fn<T>) {
    if (this.lock) {
      return this.lock
    }
    this.lock = Promise.resolve()
      .then(fn)
      .finally(() => delete this.lock)
    return this.lock
  }
  async await() {
    return this.lock?.then(() => undefined).catch(() => undefined)
  }
  running() {
    return !!this.lock
  }
}

export class TaskQueue<T = void> implements Lock<T> {
  waiting: Resolve[] = []
  ing?: Promise<void>
  ingRes?: Resolve

  async run(fn: Fn<T>) {
    if (!this.ing) {
      this.ing = new Promise((res) => {
        this.ingRes = res
      })
    } else {
      await new Promise((res) => {
        this.waiting.push(res)
      })
    }

    try {
      return await fn()
    } finally {
      if (this.waiting.length === 0) {
        this.ingRes?.()
        delete this.ing
        delete this.ingRes
      } else {
        this.waiting.shift()?.()
      }
    }
  }
  async await() {
    return this.ing
  }
  running() {
    return !!this.ing
  }
}

interface GroupConcurrencyLockInfo {
  runningMark: Map<symbol, true>
  running?: Promise<void>
  runningRes?: Resolve
  waiting?: Promise<void>
  waitingRes?: Resolve
}
export class GroupConcurrencyLock {
  private groups = new Map<PropertyKey, GroupConcurrencyLockInfo>()
  private waitings: GroupConcurrencyLockInfo[] = []
  private runnings: Map<PropertyKey, GroupConcurrencyLockInfo> = new Map()

  max: number
  constructor(max: number) {
    this.max = max
  }

  private getInfo(key: PropertyKey) {
    let info = this.groups.get(key)
    if (!info) {
      info = {
        runningMark: new Map(),
      }
      this.groups.set(key, info)
    }
    return info
  }

  wakeUp() {
    const wakeUps = this.waitings.splice(0, this.max - this.runnings.size)
    wakeUps.forEach((info) => {
      info.waitingRes?.()
      delete info.waiting
      delete info.waitingRes
    })
  }

  async run<T>(key: PropertyKey, fn: Fn<T>) {
    const info = this.getInfo(key)
    if (info.waiting) {
      await info.waiting
    }
    if (!this.runnings.has(key)) {
      if (this.runnings.size >= this.max) {
        info.waiting = new Promise((res) => {
          info.waitingRes = res
        })
        this.waitings.push(info)
        await info.waiting
      }
      info.running = new Promise((res) => {
        info.runningRes = res
      })
      this.runnings.set(key, info)
    }
    const symbol = Symbol('read')
    info.runningMark.set(symbol, true)
    try {
      return await fn()
    } finally {
      info.runningMark.delete(symbol)
      if (info.runningMark.size === 0) {
        info.runningRes?.()
        delete info.running
        delete info.runningRes
        this.runnings.delete(key)
        this.groups.delete(key)
        this.wakeUp()
      }
    }
  }

  async await(key: PropertyKey) {
    const info = this.groups.get(key)
    if (!info) {
      return
    }
    let w: Promise<void> | undefined = info.waiting
    while (w) {
      await w
      w = info.waiting
    }
    await info.running
  }

  running(key: PropertyKey) {
    const info = this.groups.get(key)
    return !!(info?.waiting || info?.running)
  }
}

interface TimeoutCoalesceEntity<T = void> {
  writing?: Promise<T>
  writingRes?: Resolve<T>
  writingRej?: (reason?: unknown) => void
  permit?: boolean
}
type TimeoutCoalesceType = 'window' | 'cooldown'
class TimeoutCoalesceLock<T = void> implements Lock<T> {
  ing?: Promise<void>
  ingRes?: Resolve

  timer?: NodeJS.Timeout
  lockdown?: Promise<void>
  lockdownRes?: Resolve
  next?: boolean
  currentBatch: TimeoutCoalesceEntity<T>[] = []
  type: TimeoutCoalesceType

  lastRunAt: number = 0
  lastStartAt: number = 0

  intervalMs!: number
  maxDelayMs!: number
  windowMs!: number
  constructor(type: TimeoutCoalesceType) {
    this.type = type
  }


  private runTimeout() {
    delete this.timer
    this.lockdown = new Promise((res) => {
      this.lockdownRes = res
    })
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const last = this.currentBatch[this.currentBatch.length - 1]!
    last.permit = true
    last.writingRes?.(0 as T)
  }

  async run(fn: Fn<T>) {
    if (this.lockdown) {
      this.next = true
      await this.lockdown
    }
    if (!this.ing) {
      this.ing = new Promise((res) => {
        this.ingRes = res
      })
    }

    const entity: TimeoutCoalesceEntity<T> = {}
    entity.writing = new Promise((res, rej) => {
      entity.writingRes = res
      entity.writingRej = rej
    })

    this.currentBatch.push(entity)


    switch (this.type) {
      case 'window': {
        if (!this.timer) {
          this.timer = setTimeout(() => { this.runTimeout() }, this.windowMs)
        }
        break
      }
      case 'cooldown': {
        clearTimeout(this.timer)
        const startAt = Date.now()
        const elapsed = startAt - this.lastRunAt
        let timeout = 0
        if (!this.timer) {
          this.lastStartAt = startAt
          timeout = elapsed >= this.intervalMs ? 0 : this.intervalMs - elapsed
        } else {
          timeout = Math.min(Math.max(this.maxDelayMs, this.intervalMs) - (startAt - this.lastStartAt), this.intervalMs)
        }
        if (timeout > 0) {
          this.timer = setTimeout(() => { this.runTimeout() }, timeout)
        } else {
          this.runTimeout()
        }
        break
      }
    }


    const res = await entity.writing
    if (!entity.permit) {
      return res
    }

    let obj: T
    let isError = false
    let err: unknown
    try {
      obj = await fn()
      return obj
    } catch (e) {
      isError = true
      err = e
      throw e
    } finally {
      if (this.type === 'cooldown') {
        this.lastRunAt = Date.now()
      }
      this.currentBatch.forEach((e) => {
        if (e.permit) return
        if (isError) {
          e.writingRej?.(err)
        } else {
          e.writingRes?.(obj)
        }
      })
      this.currentBatch = []
      this.lockdownRes?.()
      delete this.lockdown
      delete this.lockdownRes
      if (this.next) {
        this.next = false
      } else {
        this.ingRes?.()
        delete this.ing
        delete this.ingRes
      }
    }
  }

  async await() {
    return this.ing
  }

  running() {
    return !!this.ing
  }

}


export class WindowCoalesceLock<T = void> extends TimeoutCoalesceLock<T> {
  constructor(windowMs: number) {
    super('window')
    this.windowMs = windowMs
  }
}

export class CooldownCoalesceLock<T = void> extends TimeoutCoalesceLock<T> {
  constructor(intervalMs: number, maxDelayMs: number) {
    super('cooldown')
    this.intervalMs = intervalMs
    this.maxDelayMs = maxDelayMs
  }
}
