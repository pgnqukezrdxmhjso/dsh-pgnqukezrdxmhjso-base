# dsh-pgnqukezrdxmhjso-base 项目当前状态

## 简介

本插件仓库承载各 DSH 插件共用的开发基础件，自身不是可安装进 profile 的功能插件。

## 宏观描述

仓库内目前只有开发期脚本，没有 src 源码、没有编译产物，因此不参与 profile 的 bundle 组合。

## todo

- 无。

## 功能

### 编译版启动脚本

- 功能描述：启动位于 `D:\data\code\dsh` 的编译版 dsh，并把 Harness home 隔离到本插件目录下的 `.dsh`，使编译版与默认 `~/.dsh` 上的官方实例互不干扰。
- 实现位置：[start-dsh.mjs](../../start-dsh.mjs)
- 解决方案：脚本只对子进程设置 `DSH_HOME`，不改动调用者 shell 的环境变量；`cwd` 保持调用目录，使 workspace 根仍是用户当前所在目录；`stdio: 'inherit'` 让 dsh 的终端交互与退出码原样透传。不带参数时默认启动 `web --no-open --port 3082`。检出根目录与隔离 home 分别可由 `DSH_SOURCE_ROOT`、`DSH_ISOLATED_HOME` 覆盖。
- 思路：隔离是必需的而非可选，因为 `$DSH_HOME/profiles/node_modules` 是一份共享的模块后备目录，dsh 每次启动都会按「当前这次运行的安装」重建其中链接的指向（`packages/boot/app-boot/src/profile.ts` 的 `healProfilesModuleFallback`）。两份安装共用一个 home 会互相改写指向，只有各自独占 home 才能并存。端口取 3082 是因为 3080 与 3081 上已有实例在运行。
- 缺构建产物时的行为：检测到 `apps/cli/lib/bin.js` 不存在即退出并打印需要执行的 `pnpm install` 与 `pnpm run build`，不代用户安装或编译。
- 隔离 home 为全新空目录，不复制默认 home 的凭据与设置，首次使用需在 Web 设置页自行配置模型。

### 插件门禁汇总脚本

- 功能描述：依次运行 harness 的各门禁脚本并汇总结果，供 `packages/my/` 下各插件的 `pnpm verify` 调用。
- 实现位置：[verify.mjs](../../verify.mjs)
- 解决方案：各门禁以 harness 仓库根为工作目录运行、扫描范围是整个仓库，因此本脚本对每条违规按「报错路径是否落在插件共同目录 `packages/my/` 内」归属：树外的行既不展示、也不计入该门禁的成败，通过时打印被过滤的条数。
- 思路：门禁的扫描根写死在 harness 仓库里（缺省取仓库根），插件无法收窄，因此过滤只能落在本仓自己的汇总脚本里；这样既保住插件自身的这几类检查，又让红色重新等于「本插件有问题」。判据收紧为「带路径的行非空且全部在树外」——若放宽成「输出里没有本插件的路径即通过」，门禁脚本崩溃、构建产物缺失这类不带路径的失败会被静默当成通过，比原来的假报更危险。
- 未纳入的门禁及其原因：见脚本内的注释。
