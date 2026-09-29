#!/usr/bin/env node
/**
 * 启动编译版 dsh，并把 Harness home 隔离到本插件目录下的 .dsh。
 * 用法：node start-dsh.mjs [dsh 参数...]
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 由脚本自身位置推导，因此该脚本可从任意目录调用。 */
const pluginRoot = dirname(fileURLToPath(import.meta.url))

/** 编译版 dsh 的检出根目录，默认 D:\data\code\dsh，可用 DSH_SOURCE_ROOT 覆盖。 */
const sourceRoot = process.env.DSH_SOURCE_ROOT ?? 'D:\\data\\code\\dsh'

/** 默认本插件目录下的 .dsh，可用 DSH_ISOLATED_HOME 覆盖。 */
const home = process.env.DSH_ISOLATED_HOME ?? join(pluginRoot, '.dsh')

/** 编译版 CLI 入口，来自 pnpm run build；缺失即表示尚未安装依赖或尚未编译。 */
const cliEntry = join(sourceRoot, 'apps', 'cli', 'lib', 'bin.js')

if (!existsSync(cliEntry)) {
  console.error(`未找到编译产物：${cliEntry}`)
  console.error('请先在该检出根目录依次执行：')
  console.error('  pnpm install')
  console.error('  pnpm run build')
  process.exit(1)
}

// 不带参数时启动 Web；端口避开 3080 与 3081 上可能已在运行的实例。
const args = process.argv.slice(2)
if (args.length === 0) args.push('web', '--no-open', '--port', '3082')

// 只覆盖 DSH_HOME：编译版与默认 home 的 profiles/node_modules 会互相改写指向，必须各占一个。
const result = spawnSync(process.execPath, [cliEntry, ...args], {
  env: { ...process.env, DSH_HOME: home },
  stdio: 'inherit',
})

if (result.error) {
  console.error(`启动失败：${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
