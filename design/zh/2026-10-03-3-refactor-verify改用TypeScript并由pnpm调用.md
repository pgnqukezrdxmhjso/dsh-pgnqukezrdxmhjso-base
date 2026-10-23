# 2026-10-03-3-refactor-verify改用TypeScript并由pnpm调用

## 直接原因

用户要求：`verify` 改用 TypeScript 并放进 `src/`，改由调用它的插件用 pnpm 命令调用 base 的 script，以便 base 自己控制指令内容、插件侧不再随 base 内部结构变动而改动，并且不引入依赖。

## 解决方案

`verify.mjs` 改写为 `src/verify.ts`；base 的 `verify` 脚本改为 `node --import tsx/esm src/verify.ts`；四个插件与 `dsh-version-manager` 的 `verify` 指令改为 `pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify`；被校验插件目录改从 `INIT_CWD` 取，回退到工作目录；`tsconfig.json` 去掉 `checkJs` 并改为 `include src`；`package.json` 增加 `tsx` 开发依赖。

## 思路

- 目标是让插件侧的调用指令短、稳定，且 base 内部怎么改都不用通知插件。
- 不能用 `bin` 实现。`bin` 能让插件只写一个裸命令（如 `dsh-verify`），但它要求插件把 base 声明为依赖，pnpm 才会把 bin 链进插件的 `node_modules/.bin`——实测未声明依赖时隔壁的 `.bin` 里不会出现该命令。用户明确要求不引入依赖，因此这条路排除。
- 只能用 pnpm 命令调用，而这就带来 `cwd` 语义问题。实测三种调用方式（`pnpm -C`、`pnpm --filter`、从仓库根 `--filter`）下 `cwd` **都变成被执行 script 所属的包**（即 base），这是 pnpm 的设计语义。若继续读 `cwd`，本脚本会永远校验 base 自己，而且**看起来是绿的**，比红更危险。
- `INIT_CWD` 恰好解决这一点，且经实测确认内层 pnpm 不会覆盖它。实测链路「插件 `pnpm verify` → 内层 `pnpm -C base run verify`」下：`cwd` 为 base，`INIT_CWD` 为发起调用的插件。另用故障注入复核归属：在 `dsh-prompt-file-injector` 里放一个文件后，其 verify 打印的仍是 `verify: packages/my/dsh-prompt-file-injector`。
- 保留 `?? process.cwd()` 回退，使直接运行 `verify.ts`（不经 pnpm、没有该变量）仍然可用。
- 保留「无 `src/` 就跳过 oxlint」的分支。用户明确要求保留，以防将来又出现没有 `src/` 的仓库；oxlint 在无可检查文件时退出码为 1，去掉它会让这类仓库永远失败。
- 改写为 TS 后 `spawnSync` 的返回类型变得精确：`encoding: 'utf8'` 让 `stdout`/`stderr` 收窄为 `string`，原先 JS 版里的 `?? ''` 成了多余判断，被 oxlint 的 `no-unnecessary-condition` 报出 4 处。这属于「修改代码后导致无效、无用的代码禁止保留」，故删除；`status` 仍可能为 `null`，其 `?? 1` 保留。
- `tsconfig.json` 原先以 `allowJs` + `checkJs` 检查 `verify.mjs`，现在源码本身是 TS，这两个开关不再需要，改为 `include src/**/*.ts`。

## 验证

- 五个仓库各自 `pnpm verify` 均输出 `verify: 11 check(s) passed`、退出码 0：base、`dsh-version-manager`、`dsh-ui-fortifier`、`dsh-prompt-file-injector`、`dsh-llm-codebuddy-power`。
- 归属正确性（本次最关键的验证）：用故障注入复核，在 `dsh-prompt-file-injector` 内放文件后，其 verify 打印 `verify: packages/my/dsh-prompt-file-injector`，没有误报 base。
- 类型检查：base 的 `tsc --noEmit -p tsconfig.json` 报 0 errors。
- oxlint：base 从改前的 `skip oxlint (no src directory, skipped)` 变为 `ok oxlint`，因为它现在有了 `src/verify.ts`。
- 路径一致性：`verify-package-paths` 一度报出两份 README 仍指向已删除的 `verify.mjs`，改掉后通过。

## 涉及文件

- [src/verify.ts](../../src/verify.ts)：由根目录的 `verify.mjs` 改写而来
- [package.json](../../package.json)：`verify` 改用 tsx 运行 `src/verify.ts`，`files` 与开发依赖同步
- [tsconfig.json](../../tsconfig.json)：去掉 `allowJs`/`checkJs`，`include` 改为 `src/**/*.ts`
- [README.md](../../README.md)、[README.zh.md](../../README.zh.md)：调用方式、`INIT_CWD` 说明与二次开发示例
- [.gitignore](../../.gitignore)：忽略 `temp/`
- 项目状态文档（中文、英文各一份）：宏观描述与被校验插件目录的取值来源
- 另外四个插件仓库（跨仓库改动，不在此列链接）：`verify` 指令改为 `pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify`
- 另两个插件仓库的 `.gitignore` 增加 `temp/`
