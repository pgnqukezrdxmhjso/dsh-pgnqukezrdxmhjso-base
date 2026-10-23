# 2026-10-03-2-feat-补齐tsconfig与README使门禁通过

## 直接原因

`verify-package-invariants` 对本仓库一直失败：它读本仓库目录下的 `tsconfig.json` 时文件不存在，直接抛 ENOENT。用户要求补齐它，并在 README 末尾用分割线加上 invariants 声明。

## 解决方案

新增 `tsconfig.json`（以 `checkJs` 对 `verify.mjs` 做类型检查，同时满足门禁对文件存在的要求）；README 由一行标题补齐为中英两份完整文档，末尾加分割线与 invariants 声明；`verify.mjs` 补上 `@typedef` 与参数类型，`package.json` 增加 `typecheck` 脚本与 `files` 项。

## 思路

- 目标是让这个门禁转绿，同时不做无意义的摆设文件。
- 门禁失败的性质要说清：它并非判定本仓库违规，而是**自身崩溃**。它扫 `packages/*/*/package.json`（整个 dsh 仓库的每个包），在 `checkBuild` 里读 `${包目录}/tsconfig.json` 而未先判断文件存在，于是任何一个缺该文件的包都会让它抛 ENOENT。本仓库此前正是第一个撞上的包，补好后它立刻转向下一个（`dsh-version-manager`），两个仓库因此都得有。
- 既然必须加这个文件，就让它真的干活，而不是放一个空对象。本仓库的代码是 JS，因此打开 `allowJs` 与 `checkJs` 让 `tsc` 检查 `verify.mjs`。它立刻报出 4 处问题，其中一处是真实缺陷：`checks` 数组里 `skip` 只存在于 oxlint 那一项，读取 `check.skip` 在类型上不成立——补 `Check` 的 `@typedef` 后消除。这处不一致是上一轮为跳过无 `src/` 仓库的 oxlint 而引入的。
- 门禁对 `tsconfig.json` 还有一项要求：`references` 里**不含** `runtime-diagnostics/invariants`（本仓库没有 `src/invariant.ts`，即没有 companion）。配置里没有 `references` 字段，因此满足。
- README 必须补齐。它此前只有一行标题，而规则要求至少包含项目名称、徽章区、其他语言链接、简介、`current.md` 链接、安装方法与功能列表。补齐时按 `packages/my/` 下其它插件的结构组织。
- invariants 声明句的措辞要能通过门禁的正则 `No (?:(?:runtime )?invariant )?companion is published(?: because|[.:;—])\s+\S`：`because` 之后必须紧跟实质内容，且整句要在文件里真实存在。放在末尾并用 `---` 分隔，与兄弟插件一致。

## 验证

- 门禁转绿：在 harness 仓库根运行 `node --import tsx/esm scripts/verify-package-invariants.ts`，输出 `verify-package-invariants: 38 hand-owned package companion(s) conform.`，不再抛 ENOENT。
- 本仓库完整 verify：`node verify.mjs` 输出 `verify: 11 check(s) passed`、退出码 0，其中 `verify-package-invariants` 为 `ok`（改动前为 FAIL）。
- 类型检查：`tsc --noEmit -p tsconfig.json` 报 0 errors（改动前 4 errors）。
- 语法：`node --check verify.mjs` 通过。
- 配置不含 `references`，符合门禁对无 companion 包的要求。

## 涉及文件

- [tsconfig.json](../../tsconfig.json)：新增，`checkJs` 检查 `verify.mjs`
- [README.md](../../README.md)：由一行标题补齐为完整文档，末尾加分割线与 invariants 声明
- [README.zh.md](../../README.zh.md)：新增
- [verify.mjs](../../verify.mjs)：`pathsIn` 补参数类型，`checks` 补 `Check` 的 `@typedef`
- [package.json](../../package.json)：增加 `typecheck` 脚本，`files` 增加 `tsconfig.json` 与 `README.zh.md`
- 项目状态文档（中文、英文各一份）：宏观描述补上该配置文件的作用
