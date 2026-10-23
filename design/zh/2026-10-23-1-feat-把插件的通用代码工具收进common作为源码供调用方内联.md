# 把插件的通用代码工具收进本包的 common/,作为源码供调用方内联

## 直接原因

`dsh-llm-codebuddy-power` 的 `src/common/` 里有 5 个文件共 1325 行:对象管理器、锁、原子写入、依赖注入容器、纯对象工具。它们与 CodeBuddy 服务无关,也与 dsh 无关,只依赖 node 内置,因此一直想放在插件之外重复使用,而放在插件里有三个代价:

- 插件发布时把这些文件一起打进去,别处要用只能复制
- 跨仓库复制之后会分叉,修一处不修另一处
- 这批文件与插件业务同处一棵源码树,读代码时先要按目录判断它在哪一层

## 解决方案

在本包新增 `src/common/`,收下这 5 个文件,并调整包元数据使其可被按子路径引用。

| 文件 | 内容 |
|---|---|
| `src/common/ObjectManager.ts` | 受管理对象:内存唯一真值 + 持久化与通知两条出口 |
| `src/common/BeanHelper.ts` | 依赖注入容器 |
| `src/common/Locks.ts` | 按 key 分组的锁、合并锁、任务队列、并发额度 |
| `src/common/AtomicWrite.ts` | 原子替换 + 按路径串行化的写入底座 |
| `src/common/Objects.ts` | 空值判断、深拷贝、扁平化、键路径解析 |

文件名统一为大写开头。`atomicFile.ts` 一并改名为 `AtomicWrite.ts` —— 旧名只是把"原子"和"文件"并置,而它做的是原子**写**,名字后半段说的是被写入的对象而非它的职责。

元数据三处改动:

```jsonc
// exports:调用方按子路径取源码
"exports": {
  "./common/*": "./src/common/*",
  "./package.json": "./package.json"
},
// files:原来只匹配 src 下一层,收不进 common/
"files": ["src/**/*", ...],
// tsconfig:common/ 内的相对 import 带 .ts 后缀
"allowImportingTsExtensions": true
```

## 思路

**结论:本包只发布源码、不产出编译产物,让调用方在自己的构建里内联。**

`dsh-llm-codebuddy-power` 的 tsdown 预设按 package.json 的依赖分区决定外置还是内联:只有写进 `dependencies`/`peerDependencies`/`optionalDependencies` 的包名保持 import,其余全部内联。因此调用方把它写进 `devDependencies` 就够了 —— 类型解析拿得到源码,产物里没有它,发布后也不需要安装它。本包不必有 `main`/`lib`,也因此不必维护一套编译输出。

这条路径的代价是门禁的可见性,已记在 README 的已知限制里。

**这 5 个文件的内部只认相对 import 与 node 内置,没有任何一条指向插件或 dsh**,这是它们能整份搬走的先决条件,搬迁前逐文件确认过。

`BeanHelper` 与 `Locks` 都持有状态,但内联产生的多份副本是**正确的**:两者都是"每个调用方一份"的实例私有机制,不存在需要跨包共享的身份。`ObjectManager` 同理。

## 额外收益

`files` 从 `src/*` 改成 `src/**/*` 修好了一个一直存在的问题:旧写法只匹配 `src` 下第一层文件,任何子目录都不会进入发布包。
