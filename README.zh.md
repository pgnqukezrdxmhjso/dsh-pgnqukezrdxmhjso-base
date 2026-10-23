# dsh-pgnqukezrdxmhjso-base

![AI-Crap](https://img.shields.io/badge/💩-AI_crap_code-5C4033?style=flat-square) [![npm](https://img.shields.io/npm/v/dsh-pgnqukezrdxmhjso-base?style=flat-square)](https://www.npmjs.com/package/dsh-pgnqukezrdxmhjso-base)

[English](./README.md)

DSH 插件的共用开发基础件：一个脚本，依次运行 harness 的各门禁脚本并汇总结果，供 `packages/my/` 下各插件的 `pnpm verify` 调用；外加一个 `common/` 文件夹，装那些插件共用的运行时代码工具。

详情见 [design/zh/current.md](design/zh/current.md)。

## 使用

`packages/my/` 下的各插件在自己的 `verify` 脚本里调用它：

```sh
pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify
```

门禁以 harness 仓库根为工作目录运行、扫描范围是整个仓库，因此本脚本对每条违规按「报错路径是否落在 `packages/my/` 内」归属：树外的行既不展示、也不计入该门禁的成败。被校验目录下没有 `src/` 时，oxlint 那一步会跳过并打印说明。

被校验的插件取自 `INIT_CWD`，即发起本次运行的那个目录：pnpm 会把工作目录切到 script 所属的包，只看工作目录会永远指向本 base 仓库。直接运行脚本而没有该变量时，回退到工作目录。

## 共用代码

`src/common/` 存放各插件复用的运行时工具：对象管理器、依赖注入容器、锁、原子写文件、纯对象工具。它们只依赖 node 内置。

把它加进 `devDependencies`，按子路径引用具体文件：

```json
{ "devDependencies": { "dsh-pgnqukezrdxmhjso-base": "workspace:^" } }
```

```ts
import { BeanHelper } from 'dsh-pgnqukezrdxmhjso-base/common/BeanHelper.ts'
```

本包只发布源码。写进 `devDependencies` 使调用方的发布依赖里不出现它，同时类型仍能解析；若调用方的打包器把生产依赖之外的一切都内联，这段代码就会被编译进它自己的产物。

## 已知限制与待办

`common/` 里的导出没有 JSDoc，而 `verify-export-jsdoc` 管不到它们：该门禁经由 `exports` 里指向 `lib/` 的目标解析一个包的公开面，而本包指向 `.ts` 源码，因此它算出的待查名单是空的。补一份构建产物或给这些导出写上注释都能补上这个缺口。

## 构建时使用的 dsh 版本

`0.1.7-rc.2`

## 二次开发说明

把本仓库克隆到 dsh workspace 的包目录，然后运行：

```sh
git clone https://github.com/pgnqukezrdxmhjso/dsh-pgnqukezrdxmhjso-base packages/my/dsh-pgnqukezrdxmhjso-base
pnpm install
pnpm -C packages/my/dsh-pgnqukezrdxmhjso-base run verify
```

---

没有发布 runtime invariant companion，因为本仓库是开发期门禁脚本，没有运行时注册，也没有需要独立校验的运行时关系。
