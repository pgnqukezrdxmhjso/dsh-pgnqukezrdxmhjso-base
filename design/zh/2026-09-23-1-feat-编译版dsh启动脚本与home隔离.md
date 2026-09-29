# 2026-09-23-1-feat-编译版dsh启动脚本与home隔离

## 直接原因

在同一台机器上运行编译版 dsh 会与默认 `~/.dsh` 上的官方实例争用同一份共享模块后备目录，需要一份固定、可复用的启动方式把两者隔开。

## 解决方案

在插件仓库新增 `start-dsh.mjs`：只对子进程设置 `DSH_HOME` 指向本插件目录下的 `.dsh`，参数原样转发给 `D:\data\code\dsh` 编译出的 `apps/cli/lib/bin.js`，不带参数时默认 `web --no-open --port 3082`。检出根目录与隔离 home 可由 `DSH_SOURCE_ROOT`、`DSH_ISOLATED_HOME` 覆盖；缺少编译产物时报错并打印需要执行的命令。`.dsh/` 加入本仓 git 忽略列表。

## 思路

**结论**：隔离通过子进程环境变量实现，而非改动用户 shell 环境或复制目录；缺少编译产物时只报错不代建。

因果链：

- 目标是让编译版与默认 home 上的实例能同时运行。两者已在 3080 与 3081 上各跑一个实例，说明端口不是瓶颈，真正的冲突在 `$DSH_HOME/profiles/node_modules`：它是一份共享的模块后备目录，`healProfilesModuleFallback` 每次启动都按「当前这次运行的安装」重建其中链接的指向。故必须让两份安装各占一个 home。
- 只给子进程设 `DSH_HOME`：该变量只影响本次启动，不给用户的 shell 留副作用；若改为在脚本里 `setx` 或写 shell 配置，安装版 dsh 也会被带偏，超出「启动编译版」这一目标。
- 隔离 home 放在插件目录下，是用户的选择；随之需要 `.gitignore` 条目，否则运行数据会进这个插件仓库的提交面。
- 缺产物时报错而非自动 `pnpm install && pnpm run build`，是用户的选择：编译耗时长且会写检出目录，脚本只负责启动。
- 隔离 home 不从默认 home 复制凭据与设置，是用户的选择：最干净的起点，代价是首次需在 Web 设置页自行配置模型。
- 默认端口取 3082，因为 3080（`dsh web`）与 3081（`--profile pkgtest --port 3081`）上已有实例在监听，且已实测该端口空闲。
- 脚本写成 `.mjs` 而非 `.ts`：同目录的 `verify.mjs` 已是纯 Node 脚本，且本仓无 `package.json`、无构建步骤，`node start-dsh.mjs` 即可运行，省去 tsx 依赖。
- 用 `spawnSync` 且 `stdio: 'inherit'`：dsh 是长驻交互进程，继承标准流才能让终端输出与键盘输入直通，同时退出码可原样返回。

## 涉及文件

- [start-dsh.mjs](../../start-dsh.mjs)：新增启动脚本。
- [.gitignore](../../.gitignore)：新增，忽略隔离 home `.dsh/`。
- 项目状态文档（中文、英文各一份）：新增。
