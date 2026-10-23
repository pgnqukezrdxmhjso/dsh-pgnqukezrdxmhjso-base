# dsh-pgnqukezrdxmhjso-base 项目当前状态

## 简介

本插件仓库承载各 DSH 插件共用的开发基础件，自身不是可安装进 profile 的功能插件。目前有一份门禁汇总脚本，以及一个放通用运行时代码工具的 `common/` 目录。

## 宏观描述

仓库内是两个互不相干的部分：开发期的门禁脚本 `src/verify.ts`，与运行期的代码工具 `src/common/`（对象管理器、依赖注入容器、锁、原子写、纯对象工具）。没有编译产物，因此不参与 profile 的 bundle 组合。

`src/common/` 里那批文件只依赖 node 内置，内部只认相对 import，与 dsh 和任何具体插件都没有依赖关系。本包**只发布源码**：`exports` 指向 `.ts` 源文件，调用方按子路径引用，并在自己的构建里内联（调用方把它写进 `devDependencies` 即可，其打包器会把生产依赖之外的一切打进产物）。因此本包不需要 `main`/`lib`，也不维护编译输出。

门禁脚本 `src/verify.ts` 被 `packages/my/` 下各插件以 `pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify` 调用。

被校验的插件目录取自环境变量 `INIT_CWD`：经 pnpm 调用时工作目录会变成本 base 仓库，只有 `INIT_CWD` 保留发起调用的插件目录，两层 pnpm 嵌套下也不会被内层覆盖。直接运行脚本而没有该变量时回退到工作目录。

本仓库带一个 `tsconfig.json`：供 `pnpm typecheck`（`tsc --noEmit`，只检查不产出）与编辑器使用，同时满足 `verify-package-invariants` 对「包目录下须有该文件」的要求。它开启了 `allowImportingTsExtensions`，因为 `common/` 内的相对 import 带 `.ts` 后缀。

## todo

- `common/` 的导出没有 JSDoc，而 `verify-export-jsdoc` 管不到它们（该门禁经 `exports` 里指向 `lib/` 的目标解析公开面，本包指向 `.ts` 源码，算出的待查名单为空）。补一份构建产物或写上注释都能补上这个缺口。

## 功能

### 通用代码工具

#### 供各插件复用的运行时代码

- 功能描述：`src/common/` 提供对象管理器、依赖注入容器、锁、原子写文件、纯对象工具，供 `packages/my/` 下各插件按子路径引用。
- 实现文件位置：[ObjectManager.ts](../../src/common/ObjectManager.ts)、[BeanHelper.ts](../../src/common/BeanHelper.ts)、[Locks.ts](../../src/common/Locks.ts)、[AtomicWrite.ts](../../src/common/AtomicWrite.ts)、[Objects.ts](../../src/common/Objects.ts)。
- 解决方案：调用方写进 `devDependencies`，按 `dsh-pgnqukezrdxmhjso-base/common/<文件>.ts` 引用；打包时被内联进调用方产物，发布后不需要安装本包。
- 思路：本包只发布源码、不产出编译产物，是因为调用方的打包器按自身的依赖分区决定外置或内联——只要本包不在它的生产依赖里，源码就会被编译进它的产物，双方都不必维护一份中间产物。`BeanHelper` 与 `Locks` 都持有状态，但内联出的多份副本是正确的：两者都是每个调用方一份的实例私有机制，没有需要跨包共享的身份。

### 插件门禁汇总脚本

#### 汇总各门禁结果

- 功能描述：依次运行 harness 的各门禁脚本并汇总结果，供 `packages/my/` 下各插件的 `pnpm verify` 调用。
- 实现文件位置：[verify.ts](../../src/verify.ts)。
- 解决方案：各门禁以 harness 仓库根为工作目录运行、扫描范围是整个仓库，因此本脚本对每条违规按「报错路径是否落在插件共同目录 `packages/my/` 内」归属：树外的行既不展示、也不计入该门禁的成败，通过时打印被过滤的条数。被校验目录下没有 `src/` 时跳过 oxlint 并打印说明，因为 oxlint 在无可检查文件时退出码为 1。
- 思路：门禁的扫描根写死在 harness 仓库里（缺省取仓库根），插件无法收窄，因此过滤只能落在本仓自己的汇总脚本里；这样既保住插件自身的这几类检查，又让红色重新等于「本插件有问题」。判据收紧为「带路径的行非空且全部在树外」——若放宽成「输出里没有本插件的路径即通过」，门禁脚本崩溃、构建产物缺失这类不带路径的失败会被静默当成通过，比原来的假报更危险。
- 未纳入的门禁及其原因：见脚本内的注释。
