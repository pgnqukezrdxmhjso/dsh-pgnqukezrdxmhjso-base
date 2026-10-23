/**
 * 受管理对象:内存里的一份真值,配上"持久化"与"通知变化"两条出口。
 *
 * 一个对象在这里只有一份副本,而它的每次变化都必须经过 `write`(要持久化)、`update`
 * (不持久化)或 `refresh`(去别处取回最新值)。`read()` 交出的是 {@link DeepReadonly} 视图,
 * 改成新的版本只能靠构造一个新对象 —— 就地修改在这里编译不过,而绕过管理器的修改会让通知与
 * 持久化悄悄漏掉,那正是这个模块存在的理由。
 *
 * 本模块**不含任何业务**:它不知道被管理的对象具体是什么,只提供"对象怎么被写、
 * 怎么被读、怎么被监控"这三件事的骨架,具体行为由注册进来的钩子提供。"变化之后要做什么"
 * 同样是业务 —— 其中最常见的一种是通知观察方,因此也由钩子注册,模块自己不持有任何
 * 通知手段的概念。
 *
 * ## 只读由谁保证
 *
 * 由**本模块**保证,不靠调用方自觉:{@link ObjectManager} 的构造函数只接受纯 JSON 对象
 * (见 {@link Jsonify}),而纯 JSON 里不存在 `Date`、`Map`、`Set`、函数这些"深只读会
 * 破坏其语义"的类型,因此简单的逐层只读映射在这些对象上不会漏判任何一层。换成业务方
 * 各自 declare 只读类型是另一回事 —— 那要业务方配合,写漏一处就失效。
 *
 * ## 并发控制
 *
 * 全部交给 {@link GroupConcurrencyLock}、{@link WindowCoalesceLock} 与
 * {@link CooldownCoalesceLock} 三个现成的锁,本模块自己不再实现窗口、排队或节流:
 *
 * - **`GroupConcurrencyLock(1)`**:同一个对象上,用 `'r'`、`'w'`、`'u'` 三个组名把刷新、
 *   写入与 {@link ObjectManager.update} 三条路径两两隔开,于是三者互斥;不同对象各有各的
 *   实例,互不牵连。
 * - **`WindowCoalesceLock`**:窗口内到达的连写并成一次持久化,**最后到达**的那一版的
 *   `fn` 被执行,先到的等它的结果 —— 于是一串连写只产生一次持久化,且写的是最新值。
 * - **`CooldownCoalesceLock`**:刷新的合并与节流;冷却期内到达的并成一次取数,空闲后首次
 *   调用立即开始,运行期间到达的等它结束再走一遍。
 *
 * 三条路径都在**整对象级别**替换 `this.value`,因此必须两两互斥:任何两条并行都会让后应用的
 * 那一版盖掉前一条的改动,而两者的调用方都会收到成功。
 *
 * 内容没有变化的写入直接返回:此时尚未进入任何一处并发控制,不需要唤醒谁。
 *
 * ## 变化通知的合并
 *
 * 通知**排在持久化之前**(落在到达 `write` 的那一刻,不等窗口关闭、更不等持久化完成):同一个
 * 同步块内的多次变化只通知一次,通知的是**那一刻**的对象(不是发起变化时的值)。
 * 同理,与上一次**真正送出去**的那一版内容相同时也跳过 —— 各条路径各自比较,先后到达同一个
 * 值时观察方不该被叫醒两次。持久化失败也不影响这次通知 —— 它表达的是"内存变了",
 * 而持久化保证由本次调用的 promise 说。真正防止无谓通知的是**内容比较**:
 * 从外部取回的同一份内容,绝大多数轮次并不变化,相同就不通知。
 * 通知回调抛出的错误**不由本模块接住**(它不在任何 promise 上),实现方需自行兜住,
 * 详见 {@link ChangeHook}。
 *
 * ## 主动刷新
 *
 * 真值在本模块之外的对象的取数时机由注册方安排:变化驱动的靠监控,周期驱动的靠定时器,而"有没
 * 有人在看"这类判断也归注册方。本模块只提供 `refresh()`(合并与节流)与 {@link RefreshHook}
 * 这个"怎么取"的钩子,自身不持有任何触发源。多个刷新钩子串成折叠链,全部跑完后由本模块
 * **一次性**应用,因此一次刷新只通知一次、失败也不会留下半更新的对象。事件驱动的取数顺序
 * **被收窄到同一条路径**:注册方在 `onInit` 里不直接写对象,而是触发刷新,于是两类触发源
 * 不会各自写一次值而互相覆盖。
 *
 * @module dsh-pgnqukezrdxmhjso-base/common/ObjectManager
 */

import { CooldownCoalesceLock, GroupConcurrencyLock, WindowCoalesceLock } from './Locks.ts'

/**
 * 持久化合并窗口的时长(毫秒)。
 *
 * 窗口要把"几乎同时"发生的写入并成一次持久化。取 50ms:它得长到能吸进同一批调用(一次外部
 * 变化往往连发几个事件,相隔是毫秒级),又要短到用户察觉不到 —— 窗口推迟的只是持久化,
 * 而等它的调用方本来就该等这次持久化完成。
 */
const PERSIST_WINDOW_MS = 50

/**
 * 同一个对象上区分三条发生变化路径的组名。
 *
 * {@link GroupConcurrencyLock} 按组名共享并发额度,**同组名不互斥、不同组名才互斥**,因此三者
 * 必须互不相同:复用同一个名字等于让两条路径并行,而它们都在整对象级别替换 `this.value`,
 * 并行就会互相盖掉 —— 刷新能穿过正在持久化的写入读到旧内容,写入也能被刷新的结果顶掉。
 *
 * `'u'` 这条路只是"把一版不持久化的内容放上去",它同样替换整个对象,因此也必须与另外两条互斥。
 */
const REFRESH_GROUP = 'r'
const WRITE_GROUP = 'w'
const UPDATE_GROUP = 'u'

/**
 * 两次刷新之间至少相隔的时长(毫秒)。
 *
 * 取 50ms:它与持久化窗口同量级,刚好吸掉"一次外部变化连发几个事件"的那一串,又不至于
 * 让用户察觉。小于它时连续触发会各取一次数,大于它则每次变化都要多等一会儿。
 */
const REFRESH_COOLDOWN_MS = 50

/**
 * 一次刷新最多被后续到达推迟多久(毫秒)。
 *
 * 没有它,持续到达可以把刷新无限推迟。取 200ms:要长到能容纳一串连发事件,又要短到
 * "外部变了"这件事不会久到用户看得出来。必须 ≥ {@link REFRESH_COOLDOWN_MS},见
 * {@link CooldownCoalesceLock} 的不变式。
 */
const REFRESH_MAX_DELAY_MS = 200

/**
 * 一批受管理对象的工厂。
 *
 * **一个插件一个实例**。这层之所以存在,是因为本模块可能被拆成基座包供多个插件共用:
 * 若把"已创建的全部管理器"记在模块级的表里,而两个插件又共享同一个模块实例(打包时
 * 外部化而不是各自内联),那么其中一个卸载时调用一次销毁,就会把**另一个插件的对象
 * 一起拆掉** —— 而那两个对象与它毫无关系。
 *
 * 拿一个实例就有一座独立的登记表,因此"销毁我这一批"永远只影响我这一批。业务代码
 * 通过 `managerFactory.create` 造对象,不直接 `new ObjectManager` —— 那样造出来的
 * 对象不属于任何一批,也就没有统一的销毁。
 */
export class ManagerFactory {
  /** 本批已创建的全部管理器;只记销毁入口,不记业务类型。 */
  private readonly created = new Set<Pick<ObjectManager<Record<string, never>>, 'destroy'>>()
  /** 本批是否已销毁;销毁后再造对象属于用法错误,直接拒绝。 */
  private destroyed = false

  /**
   * 造一个受本批管理的对象。
   * @param initial - 初始对象;必须是纯 JSON,见 {@link Jsonify}。
   * @typeParam T - 被管理的对象类型。
   * @typeParam E - 额外数据类型,见 {@link ObjectManager}。
   * @returns 新对象,已登记进本批。
   */
  create<T, E = unknown>(initial: T & Pure<T>): ObjectManager<T, E> {
    if (this.destroyed) {
      throw new Error('ManagerFactory: cannot create an object after the factory was destroyed')
    }
    const manager = new ObjectManager<T, E>(initial)
    this.created.add(manager)
    return manager
  }

  /**
   * 销毁本批的全部对象。
   *
   * 只影响本实例造出来的那些 —— 别的插件用它们自己的实例,因此互不相干。重复调用是
   * 安全的:表已清空时什么都不做。
   *
   * 销毁之后本批不再接受新的 {@link ManagerFactory#create},因为那会造出一个永远没人
   * 负责拆的对象。
   */
  destroyAll(): void {
    this.destroyed = true
    const all = [...this.created]
    // 先清空再遍历:被销毁的管理器不该在遍历过程中再被登记进来。
    this.created.clear()
    for (const manager of all) manager.destroy()
  }
}

/**
 * 逐层只读的 T。
 *
 * 顶层与每一个嵌套层都只读,数组变成只读数组(于是 `push`、下标赋值都不可用)。
 * 只读映射沿途保留可选修饰与只读修饰,因此可选字段仍是可选的。
 *
 * `{ ...value }` 仍可用:展开产生的是新的普通对象,它**顶层**可写(那正是"派生新版本"需要的),
 * 而每个属性的值照搬引用、类型照搬,所以**嵌套层依旧只读** —— 就地改共享的嵌套对象仍然
 * 编译不过,那正是最危险的一种改法。
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T

/**
 * 对象上带方法的键;一个方法都没有时为 `never`。
 *
 * 用它把"带方法的类型"整体判死,而不是逐个方法映射成 `never` 再指望整体失败:后者虽然也能
 * 拦住,但类型会显示成 `{ toString: never; getTime: never; ... 38 more }` —— 一串无意义的
 * 方法名。整体判死之后同一个位置直接是 `never`。
 */
type MethodKeys<T> =
  { [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T]

/**
 * 把 T 逐层映射成它的 JSON 版本;不能放进 JSON 的类型在该位置变成 `never`。
 *
 * 非 JSON 的值有两种落法,合起来覆盖全部情况:函数直接变 `never`;带方法的对象(`Date`、
 * `RegExp`、`Map`、`Set`、`Error`、`Promise`、`URL` 与任何类实例)经 {@link MethodKeys}
 * 判定后整体变 `never`;其它非原语值(`symbol`、`bigint`、`undefined` 等)落到最后一个分支。
 * 因此这些类型都不需要逐一点名。
 *
 * 它只在**出问题的那个位置**留下 `never`,所以报错能一路指到具体字段。
 */
export type Jsonify<T> =
  T extends (...args: never[]) => unknown ? never
    : T extends string | number | boolean | null ? T
      : T extends readonly (infer U)[] ? Jsonify<U>[]
        : T extends object
          ? ([MethodKeys<T>] extends [never] ? { [K in keyof T]: Jsonify<T[K]> } : never)
          : never

/**
 * T 里不是纯 JSON 的键;全部合格时为 `never`。
 *
 * 逐键判定,因此结果是一组字段名,而不是一个笼统的失败。
 *
 * `-?` 是必须的:可选字段(`lastUid?: string`)在映射类型里会保留 `?`,而保留可选就让每个
 * 标记都沾上 `undefined`,全部合格时结果成了 `undefined` 而不是 `never` —— `Pure<T>` 于是
 * 永远走不到 `T` 那一支。去掉可选修饰后,合格时干净返回 `never`。
 *
 * `| undefined` 也是必须的:{@link Jsonify} 会把 `string | undefined` 分发成 `string`,于是
 * `(string | undefined) extends string` 不成立,所有可选字段都会被误判成"非 JSON"。
 */
type InvalidKeys<T> =
  { [K in keyof T]-?: T[K] extends Jsonify<T[K]> | undefined ? never : K }[keyof T]

/**
 * 纯 JSON 的 T 原样返回;否则换成"把每个违规字段标成 `'not a JSON field'`"的类型,
 * 于是编译错误直接点名那些字段(`C & { c: 'not a JSON field'; }`)。
 *
 * 这里必须是"整体判定"而不是让 {@link Jsonify} 直接交叉进参数:只有整体判定才拦得住
 * **显式写出泛型**的情形(`new ObjectManager<T>` 时字面量可以省掉可选的非 JSON 字段,
 * 而这一步仍要拒绝)。失败分支不能是 `never` —— 那样错误里只剩一个干巴巴的 `never`;
 * 也不能写成 `{ invalidFields: InvalidKeys<T> }`,因为 `InvalidKeys<T>` 是个联合,
 * TypeScript 不会在错误信息里展开它,反而会提示"缺少属性 invalidFields",把人引到错的方向。
 * 换成映射类型,键才会被展开成真实字段名。
 */
type Pure<T> = [InvalidKeys<T>] extends [never] ? T : { [K in InvalidKeys<T>]: 'not a JSON field' }

/**
 * 初始化钩子;返回值是销毁器,没有需要清理的东西时不返回。
 *
 * 拿得到管理器本身(`this`),因为它正是"安排取数时机"的那一方:装变化监控、装定时器、
 * 首次装载时调 `refresh()`。它与刷新钩子的区别就在于此 —— 后者只负责"怎么取",够不到管理器。
 *
 * 允许返回 promise:初始化要做的事里,取数通常是异步的,把它排除在外会让每个钩子都只好自己
 * 往 `then` 里塞。
 */
export type InitHook<T> = (this: ObjectManager<T>) => void | (() => void) | Promise<void | (() => void)>

/**
 * 持久化写入钩子,收到**要持久化的对象本身**。
 *
 * 刻意不给 `this`:写入器在执行期间再调一次 `write`,会等一把由它自己持有的写入锁 ——
 * 那是必然的死锁。而写入器本来只需要读对象,所以把管理器整个收走即可从根上排除这种可能,
 * 不必再靠重入检测。
 */
export type WriteHook<T> = (value: DeepReadonly<T>) => void | Promise<void>

/**
 * 对象变化通知,收到**变化之后的那个对象**。
 *
 * 只在内容真的变化时触发(比较与去重都在管理器里做过了),因此实现方不必自己判断"这次变化
 * 值不值得说出去"。同一个同步块内的多次变化会被并成一次通知。
 *
 * 与 {@link WriteHook} 一样只收对象、不给 `this`:通知的职责是把事实说出去,不是改对象,
 * 而收回管理器会让它能在通知期间再写一次。
 *
 * **失败由实现方自己兜住。** 本模块**不**接住回调抛出的错误,也不替它记录:调用它时没有
 * 任何人在等(它不是 `write` 的 promise 的一部分),所以抛出去会一路冒到进程级并被 dsh 的
 * `installFailLoud` 记成 fatal、带着堆栈退出宿主。要不要把某个失败降级成日志、哪些失败该
 * 让整轮停下,都是通知方自己的语义 —— 例如"一次对外发送失败"该被吞掉而不该影响其余接收者,
 * 这只有通知方知道。
 *
 * 该回调**不接收 promise**:内部启动的异步操作若失败,错误不经过本模块,自然也只能由实现方
 * 自己处理。
 */
export type ChangeHook<T> = (value: DeepReadonly<T>) => void

/**
 * 刷新钩子:按当前对象算出**取回最新值之后的对象**,交给下一个钩子。
 *
 * 它只回答"怎么取",不回答"何时取" —— 定时器、文件监控、任何外部触发,全部由注册方
 * 在 `onInit` 里自行安排。本模块不持有任何触发源。
 *
 * 多个钩子构成一条**折叠链**:第一个收到当前对象,每个钩子的返回值交给下一个,全部跑完之后由
 * 管理器**一次性**应用。这样定下三件事:
 *
 * - **顺序是显式的**:后面的钩子看到的是前面已经取回的结果,因此"先取一个、再按它取另一个"这类
 *   依赖能自然表达,不必靠猜谁先跑。
 * - **一次刷新只通知一次**:中间那些版本从不进入对象,观察方看到的是最终的那一版,而不是每个
 *   钩子各通知一次。
 * - **失败不留半更新的对象**:任何钩子抛出时,前面算出来的版本还没有被应用,对象保持原样。
 *
 * 没有要改的地方就**原样返回收到的对象**,内容比较会把它当作没有变化。
 *
 * 钩子拿不到管理器,因此够不到 `write` 也够不到 `refresh`:前者会把刚取回的东西写回它来的地方
 * (取回的值本就在别处),后者等的是它自己所在的那一轮 —— 必然死锁。这与 {@link WriteHook} 不给
 * `this` 是同一条理由。
 *
 * **失败由实现方自己兜住**,与 {@link ChangeHook} 同:**本模块不接住它抛出的错误**,只会在它抛出时
 * 让 `refresh()` 拒绝并放弃这次的结果。
 *
 * 刷新受**合并与节流**约束,见 {@link ObjectManager.refresh}。
 */
export type RefreshHook<T> = (current: DeepReadonly<T>) => DeepReadonly<T> | Promise<DeepReadonly<T>>

/**
 * 一个被统一管理的对象。
 *
 * @typeParam T - 被管理的对象类型,必须是纯 JSON。
 * @typeParam E - {@link ObjectManager.attachExtra} 携带的额外数据类型。默认 `unknown`:
 * 不放额外数据的使用方不必为它写第二个类型实参,而要用的使用方给一个具体类型后,
 * `attachExtra` 与 `takeExtra` 就在编译期对上,不必在钩子里再做类型断言。
 */
export class ObjectManager<T, E = unknown> {
  private value: DeepReadonly<T>
  private readonly initHooks: InitHook<T>[] = []
  private readonly writeHooks: WriteHook<T>[] = []
  private readonly changeHooks: ChangeHook<T>[] = []
  private readonly refreshHooks: RefreshHook<T>[] = []
  private readonly disposers: (() => void)[] = []
  /**
   * 让刷新与写入互斥。
   *
   * `max = 1` 表示"同时只允许一个组在跑":刷新用 `'r'`、写入用 `'w'`,两者因此互相等待,
   * 刷新不会在持久化途中读到尚未写出的旧内容。**每个对象必须各有一个实例** —— `max` 是实例级的,
   * 共用一个实例会让毫无关系的两个对象互相挡住。
   */
  private readonly group = new GroupConcurrencyLock(1)
  /**
   * 把窗口内到达的连写并成一次持久化。
   *
   * 窗口关闭时执行**最后到达**的那一版的 `fn`,先到的等它的结果,因此一串连写只持久化一次、
   * 且写的是最新值。持久化闭包捕获的是发起者自己交出来的那一版,不是当下对象;而窗口整体在写入
   * 组内,另两条路径此时进不来,那一版因此就是本轮该持久化的值。
   */
  private readonly window = new WindowCoalesceLock(PERSIST_WINDOW_MS)
  /** 刷新的合并与节流:冷却期内到达的合并成一次,只跑最后到达者。 */
  private readonly coalesce = new CooldownCoalesceLock(REFRESH_COOLDOWN_MS, REFRESH_MAX_DELAY_MS)
  private started = false
  /** 已排队但尚未送出的通知;它把同一个微任务里的多次变化并成一次。 */
  private notifyQueued = false
  /**
   * 最近一次真正送出去的那一版,用来跨路径去重。
   *
   * 写入与 `update` 是两条各自比较、各自排队的路径,先后走到**同一个值**时会各发一次通知。
   * 观察方收到两次就会各自再读一次,而内容并没有变。比较用结构相等而不是引用:两条路径各自
   * 构造新对象。
   *
   * `undefined` 兼作"还没送过任何一次"的标记 —— 对象永远是纯 JSON,而 `undefined` 不是合法的
   * 纯 JSON 值,因此不会与真实取值混淆。
   */
  private lastNotified: DeepReadonly<T> | undefined

  /**
   * 一次操作附带的额外数据,由调用方在调用前写入、在钩子里取走。
   *
   * **不参与本模块任何判断**:不去重、不比较、不持久化,内容与生命周期全由使用者决定。
   * 它只是一条"随对象一起携带、由本次操作取用"的通道,用于传递那些没法只靠对象本身
   * 表达的上下文。
   */
  private extra: E | undefined

  /**
   * 造一个对象。
   *
   * **不要直接调用**:那样造出来的对象不属于任何 {@link ManagerFactory},也就没有统一的
   * 销毁。业务代码应当走 `managerFactory.create(初始值)`。
   * @param initial - 初始对象;必须是纯 JSON,见 {@link Jsonify}。它只是起点 —— 初始化钩子
   * 跑完之后通常会被从别处取回的内容替换,而那次替换走的是 {@link ObjectManager.refresh},
   * 因此会照常触发已注册的变化通知。
   */
  constructor(initial: T & Pure<T>) {
    // 只读映射只改类型、不改对象,而初始对象来自本进程构造或外部解析,里面没有共享的
    // 可变引用需要担心。此后每次替换交进来的也已是只读视图。
    this.value = initial as DeepReadonly<T>
  }

  /**
   * 当前对象。
   *
   * 交出的视图逐层只读:改写它不会经过本模块,变化通知与持久化都会漏掉。改对象有三条路:
   * {@link ObjectManager.write}(要持久化)、{@link ObjectManager.update}(不持久化)与
   * {@link ObjectManager.refresh}(去把别处的最新值取回来,由本模块应用)。
   * @returns 当前内存对象。
   */
  read(): DeepReadonly<T> {
    return this.value
  }

  /**
   * 往额外数据槽里放一份数据,供下一次钩子执行时使用。
   *
   * 调用方在触发操作(通常是 `refresh`)之前把这次操作需要的上下文放进去,钩子用
   * {@link ObjectManager.takeExtra} 取走 —— 取走即清空,因此它天然只作用一次,不会
   * 残留到下一次操作里。放进去与取出来的类型由 {@link ObjectManager} 的第二个类型参数
   * 约定,两边在编译期就对得上。
   * @param value - 这次操作要携带的数据。
   */
  attachExtra(value: E): void {
    this.extra = value
  }

  /**
   * 取走额外数据槽里的东西,并**当场清空**。
   *
   * 由钩子在执行期间调用。取走即清空是它唯一的语义:那份数据属于"这一次操作",用完
   * 就不该再被下一次读到 —— 否则一次残留的上下文会让之后每次刷新都按它行事。
   * @returns 调用方放进来的数据;这一次没有附带时为 `undefined`。
   */
  takeExtra(): E | undefined {
    const value = this.extra
    this.extra = undefined
    return value
  }

  /**
   * 写入一个需要持久化的新对象。
   *
   * 解决时表示该值**已经持久化**(连写时是被并进的那一次),失败时以写入器的错误拒绝。
   * 内容与当前对象相同时立刻解决,不持久化也不通知。
   *
   * 写下去的**就是调用方交出来的那一版**:本方法不做读-改-写,因此不存在"把一个决定应用到
   * 一个调用方没见过的状态上"这种情形。代价是 `read()` 到本调用之间若让出过执行权,期间
   * 的改动会被这一版盖掉 —— 需要基于最新状态改的调用方应在同一个同步块里读改写。
   * @param next - 新对象;通常由 `read()` 的结果派生。
   * @returns 持久化完成的结果。
   */
  async write(next: DeepReadonly<T>): Promise<void> {
    // 内容不变就直接出去:此刻既没入组也没进窗口,没有等待者需要唤醒。
    if (sameValue(this.value, next)) return
    // 入组、赋值、进窗口。赋值夹在两道锁之间:在组**内**是为了让它晚于已经在跑的另两条路径
    // (它们都整对象替换 `this.value`,若本方法在组外先赋值,那一轮刷新随后算出的结果就会把
    // 刚赋的值盖掉 —— 持久化介质上是新的、内存是旧的);在窗口**外**是因为窗口只执行最后到达
    // 者的 `fn`,赋值放进去就只有那一个调用会写内存,先到的调用等于什么都没做。
    await this.group.run(WRITE_GROUP, async () => {
      this.value = next
      // **通知排在持久化之前**:内存此刻已是新值,通知说的就是这个事实,没有理由让观察方
      // 再等 50ms 的合并窗口加一次持久化。
      this.scheduleChange()
      await this.window.run(() => this.flushWrites(next))
    })
  }

  /**
   * 写入一个**不需要持久化**的新对象,与另外两条路径互斥。
   *
   * 供对象里那些来源在别处的字段使用:它照常通知变化,但不经过写入器。
   *
   * 与 {@link ObjectManager.write} 的分工是**改哪类字段**:这个只改不持久化的字段,对应地
   * 写入器只处理需要持久化的字段,因此同一个对象上两者可以并存而互不覆盖。
   * @param next - 新对象。
   * @returns 应用完成的结果。
   */
  async update(next: DeepReadonly<T>): Promise<void> {
    // 这里**不先比一次内容**:那次比较省下的只是一次空载进锁(约 0.6µs),而它在内容真的变了时
    // 会变成实打实的重复深比较(一份两百来项的内容约 65µs,是进锁的约 107 倍),因此让锁内的
    // {@link ObjectManager.applyValue} 独自承担比较。代价是内容相同时也要排一次队。
    await this.group.run(UPDATE_GROUP, () => { this.applyValue(next) })
  }

  /**
   * 把一版内容放进内存并排通知;内容与当前相同时什么都不做。
   *
   * **自身不取任何锁**,因此调用方负责保证互斥:{@link ObjectManager.update} 在 `'u'` 组内调它,
   * 而 {@link ObjectManager.runRefresh} 已经在 `'r'` 组内。这也意味着它**不能**去抢 `'u'`——
   * 刷新那条路径正持有 `'r'`,再抢 `'u'` 就是等另一条路径放行,而 `runRefresh` 排在它后面,
   * 形成死锁。
   * @param next - 要应用的新对象。
   */
  private applyValue(next: DeepReadonly<T>): void {
    if (sameValue(this.value, next)) return
    this.value = next
    this.scheduleChange()
  }

  /**
   * 注册初始化钩子,按注册顺序执行。
   *
   * 装变化监控、装定时器、首次装载都写在这里;返回值是销毁器,由 {@link ObjectManager.destroy}
   * 调用。这里**不直接往对象里写值**,而是调 {@link ObjectManager.refresh},使两类触发源都
   * 走同一条取数路径。
   * @param hook - 初始化钩子。
   */
  onInit(hook: InitHook<T>): void {
    this.initHooks.push(hook)
  }

  /**
   * 注册持久化写入钩子,按注册顺序执行。
   * @param hook - 写入钩子;收到要持久化的对象。
   */
  onWrite(hook: WriteHook<T>): void {
    this.writeHooks.push(hook)
  }

  /**
   * 注册对象变化通知,按注册顺序执行,每次内容真的变化时调用一次。
   *
   * 通知观察方、写日志、刷新派生数据都挂在这里。与另外两组钩子一样按注册顺序执行,因此
   * 需要先于他人看到变化的实现可以放在前面注册。
   *
   * 与 {@link ObjectManager.onWrite} 不同,这个回调不在任何 promise 上:没人等它,因此它抛出
   * 的错误不会被本模块接住。实现方需要自己把可预期的失败兜住,详见 {@link ChangeHook}。
   * @param hook - 变化通知。
   */
  onChange(hook: ChangeHook<T>): void {
    this.changeHooks.push(hook)
  }

  /**
   * 注册刷新钩子:按当前对象算出取回最新值之后的对象。
   *
   * 多个钩子按注册顺序串成一条折叠链,最后一个的输出由本管理器一次性应用,因此一次刷新只通知
   * 一次、失败也不会留下改了一半的对象。触发时机完全由注册方安排(装定时器、装变化监控、
   * 任何外部原因),本模块不持有触发源。详见 {@link RefreshHook}。
   * @param hook - 刷新钩子。
   */
  onRefresh(hook: RefreshHook<T>): void {
    this.refreshHooks.push(hook)
  }

  /**
   * 主动取一次最新值,按注册顺序跑全部刷新钩子。
   *
   * **合并与节流**(由 {@link CooldownCoalesceLock} 提供):冷却期内到达的调用并成一次取数,
   * 只跑最后到达者的那一轮并共享其结果,因此并发刷新既不重复对外取数、也不重复读同一处来源。
   * 空闲后首次调用立即开始,不会白等一个冷却期。
   *
   * **已在运行的那一轮不会被并进**:运行期间到达的调用等它结束后再走一遍完整流程。这条是
   * "改动总能被读到"的依据 —— 变化监控在变化**发生完之后**才触发,而它触发的那一轮从自己的
   * 时刻重新取数,因此不会拿到"改动之前开始的那次读取"的结果。
   *
   * **与写入互斥**(由 {@link GroupConcurrencyLock} 提供):取数期间不会有持久化在跑,因此读到的
   * 外部来源的内容不会落后于一次已经发起的写入。
   *
   * 某个刷新钩子抛出时照常拒绝调用方(与写入器一致),锁随即释放,下一次刷新能重试。
   * @returns 本次刷新完成(或失败)的结果。
   */
  async refresh(): Promise<void> {
    await this.group.run(REFRESH_GROUP, () => this.coalesce.run(() => this.runRefresh()))
  }

  /**
   * 执行全部初始化钩子;重复调用只生效一次。
   *
   * 与注册分开是必须的:钩子在创建之后才注册,而初始化必须在注册齐了之后才跑。
   * @returns 全部初始化钩子完成的结果。
   */
  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const hook of this.initHooks) {
      const disposer = await hook.call(this)
      if (typeof disposer === 'function') this.disposers.push(disposer)
    }
  }

  /** 撤销全部初始化钩子安装的东西。 */
  destroy(): void {
    for (const disposer of this.disposers.splice(0)) disposer()
  }

  /**
   * 依次执行全部刷新钩子,把它们串成一条折叠链,最后应用一次。
   *
   * 逐个 `await`:每个钩子看到的是前一个的返回值,因此"后一个依赖前一个取回的东西"能自然表达
   * (并行只会让谁先谁后变成不确定,而刷新本来就不在热路径上,串起来的代价可以接受)。
   *
   * **只在全部成功之后才应用到对象**。中途抛出时前面算出来的版本还没有进对象,调用方收到拒绝
   * 而对象保持原样 —— 不会留下"改了一半"的状态,中间那些版本也不会被通知出去。
   *
   * 应用走 {@link ObjectManager.applyValue},它不取锁:本函数已经在刷新组内,而写入与
   * {@link ObjectManager.update} 各自在另外两组,三组互斥,因此取数期间**没有**任何人能改到
   * `this.value`,折叠链的种子与它应用到的对象必然是同一版。
   */
  private async runRefresh(): Promise<void> {
    let next: DeepReadonly<T> = this.value
    for (const hook of this.refreshHooks) next = await hook(next)
    this.applyValue(next)
  }

  /**
   * 把某一版交给全部写入器持久化。
   *
   * 收**发起者自己交出来的那一版**,不现读 `this.value`。本函数整个跑在写入组内,另两条路径
   * 此时进不来,因此两者眼下是同一个值;传参而不是现读,是为了让"本轮写入器写同一版"成为
   * 结构性的:某个写入器 `await` 期间即使有别的路径换掉了对象,后面的写入器仍写这一版。
   * @param snapshot - 本轮要持久化的那一版。
   */
  private async flushWrites(snapshot: DeepReadonly<T>): Promise<void> {
    for (const hook of this.writeHooks) await hook(snapshot)
  }

  /** 把一个通知排进微任务,使同一个同步块里的多次变化只通知一次。 */
  private scheduleChange(): void {
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      // 通知是"这一刻的对象",不是发起变化时的值:三条路径都在整对象级别替换 `this.value`,
      // 取一次引用再逐个调用,使同一轮的通知者看到同一个对象。
      const value = this.value
      // 与上一次真正送出去的比较:不同路径先后到达同一个值时,观察方不该被叫醒两次。
      if (this.lastNotified !== undefined && sameValue(this.lastNotified, value)) return
      this.lastNotified = value
      for (const hook of this.changeHooks) hook(value)
    })
  }
}

/**
 * 两个值是否描述同一份内容。
 *
 * 按结构逐层比较而不是比引用:对象每次写入都换新引用(调用方构造的),按引用比等于永远
 * "变过",去重就无从谈起 —— 而从外部定期取回的内容在绝大多数轮次里是同一份,那正是最
 * 需要去重的地方。
 * @param left - 一份内容。
 * @param right - 另一份内容。
 * @returns 结构与值都相同时为 true。
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => sameValue(item, right[index]))
  }
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}
