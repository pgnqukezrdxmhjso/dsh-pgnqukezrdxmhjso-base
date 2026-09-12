#!/usr/bin/env node
/**
 * 插件门禁校验：依次运行 harness 的门禁脚本并汇总结果。
 * 由各插件 package.json 的 verify 脚本调用，工作目录即被校验的插件根目录。
 */
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** harness 仓库根：本文件位于 packages/my/<base>/ 下，上溯三级。 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** 被校验的插件根目录。 */
const plugin = process.cwd()

/**
 * 门禁清单：harness 的 scripts/<名>.ts，按执行顺序排列。
 * 名称以 harness 根 package.json 的 scripts 为准。
 *
 * 未纳入的门禁及原因（2026-09-11 逐个实测）：
 *
 * 空转——绿灯，但扫描范围不含 packages/my，纳入只会造成"已检查"的错觉：
 * - verify-doc-budgets：篇幅清单 scripts/doc-budgets.manifest.json 只列 8 个 harness 文档。
 * - verify-tsconfig-paths：只识别 @deepseek-ai/dsh-* 前缀的包，本插件包名不带 scope。
 * - verify-optional-dependency-imports：经根 tsconfig.host/client.json 聚合取文件，
 *   而这些聚合不引用 packages/my。
 * - verify-scoped-events：检查 packages/core/scope/src/scoped-events.generated.ts 是否为最新，
 *   该文件由 harness 核心 dsh-scope 的 scoped 事件声明生成，与插件无关。
 *
 * 属于 harness 仓自身的策略，插件无法满足：
 * - verify-package-dependencies：中央分类表 scripts/package-dependency-policy.ts 未登记
 *   本插件值导入的包；策略明文禁止 agent 添加条目，须 harness 人工评审。
 * - verify-translation-pairing：要求 README.i18n.yaml（harness 自己的双语机制）；
 *   本插件用 README.md + README.zh.md。
 *
 * README 结构要求——用户决定不采纳：
 * - verify-package-readme-model-experience：要求 ## Model Experience 节。
 * - verify-package-readme-summaries：要求 ## Summary 节。
 * - verify-package-readme-limitations：要求 ## Known Limitations and Deferred Work 节。
 *
 * 扫描范围不含 packages/my：
 * - verify-client-domain-graph：只扫 packages/client/*\/src/client/ 的域分层
 *   （contract → 各域 → apply/index），写死 CLIENT_DIR = packages/client。
 */
const GATES = [
  'verify-package-invariants',
  'verify-client-ui-i18n',
  'verify-md-links',
  'verify-md-wrap',
  'verify-package-paths',
  'verify-no-bare-dispatcher',
  'verify-runtime-closure',
  'verify-node-next-types',
  'verify-export-jsdoc',
  'verify-client-packages',
]

/**
 * 运行一个可执行文件并捕获输出（不经 shell，路径原样传递）。
 * @param {string} file 可执行文件。
 * @param {string[]} args 参数。
 * @param {string} cwd 工作目录。
 * @returns {{code: number, output: string}} 退出码与合并后的 stdout/stderr。
 */
function runFile(file, args, cwd) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) return { code: 1, output: String(result.error) }
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/**
 * 运行一条 shell 命令（pnpm 在 Windows 下是 .cmd，无法直接 spawn）。
 * @param {string} command 命令文本。
 * @param {string} cwd 工作目录。
 * @returns {{code: number, output: string}} 退出码与合并后的 stdout/stderr。
 */
function runShell(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8' })
  if (result.error !== undefined) return { code: 1, output: String(result.error) }
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** 汇总为待执行的检查项：oxlint 先行，其后是各门禁。 */
const checks = [
  { label: 'oxlint', run: () => runShell('pnpm exec oxlint src', plugin) },
  ...GATES.map(gate => ({
    label: gate,
    run: () => runFile(process.execPath, ['--import', 'tsx/esm', resolve(root, 'scripts', `${gate}.ts`)], root),
  })),
]

console.log(`verify: ${relative(root, plugin).replaceAll('\\', '/')}`)
console.log('')

const failures = []
for (const check of checks) {
  const { code, output } = check.run()
  if (code === 0) {
    console.log(`  ok    ${check.label}`)
    continue
  }
  console.log(`  FAIL  ${check.label}`)
  const trimmed = output.replace(/\n+$/, '')
  if (trimmed !== '') console.log(trimmed.split('\n').map(line => `    ${line}`).join('\n'))
  failures.push(check.label)
}

console.log('')
if (failures.length === 0) {
  console.log(`verify: ${checks.length} check(s) passed`)
  process.exit(0)
}
console.error(`verify: ${failures.length} of ${checks.length} check(s) failed — ${failures.join(', ')}`)
process.exit(1)
