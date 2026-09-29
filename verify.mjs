#!/usr/bin/env node
/**
 * 插件门禁校验：依次运行 harness 的门禁脚本并汇总结果。
 * 由各插件 package.json 的 verify 脚本调用，工作目录即被校验的插件根目录。
 *
 * 门禁脚本在 harness 仓库根运行，会扫描整个仓库并报出仓库其它部分的违规。落在
 * {@link myRoot}（本文件所在目录的父目录，即全部插件的共同目录）之外的违规与本插件
 * 无关，展示时逐行滤掉，也不计入该门禁的成败。
 */
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** harness 仓库根：本文件位于 packages/my/<base>/ 下，上溯三级。 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** 全部插件的共同目录：本文件所在目录的父目录。只有报在这里的违规才属于被校验的插件。 */
const myRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
 * 门禁输出里指认文件的一条仓库相对路径；这些门禁都写成 `packages/<组>/...` 形态，
 * 可能带 `:行号` 后缀，分隔符在 Windows 上可能是反斜杠。
 */
const GATE_PATH_PATTERN = /packages[\\/][^\s()'",;`]+/g

/** 同上，但不带全局标志：全局正则的 `test` 会保留 `lastIndex`，跨行复用会漏判。 */
const GATE_PATH_TEST = /packages[\\/][^\s()'",;`]+/

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

/**
 * 一条门禁报出的路径是否落在 {@link myRoot} 之内。
 * 行号后缀（`foo.ts:11`）先剥掉：它对归属判断没有意义，留着的 `:` 在 Windows 上
 * 还会让 `resolve` 把它当成盘符之后的字符。
 * @param {string} reported 门禁输出里截取的 `packages/...` 路径。
 * @returns {boolean} 落在该目录树内时为 true。
 */
function isInsideMy(reported) {
  const path = reported.replace(/:\d+(?::\d+)?$/, '')
  const absolute = resolve(root, path)
  return absolute === myRoot || absolute.startsWith(`${myRoot}${sep}`)
}

/** 一行里截取到的全部路径。 */
function pathsIn(line) {
  return line.match(GATE_PATH_PATTERN) ?? []
}

/**
 * 一行是否**只**引用了 {@link myRoot} 之外的路径。
 *
 * 没有引用任何路径的行返回 false：无法归属到任何目录的失败不能算作"与本插件无关"，
 * 否则门禁自身崩溃、构建产物缺失这类输出会被静默当成通过。
 * @param {string} line 门禁输出的一行。
 * @returns {boolean} 该行引用的路径非空且全部在目录树之外时为 true。
 */
function isOutsideOnly(line) {
  const paths = pathsIn(line)
  if (paths.length === 0) return false
  return paths.every(path => !isInsideMy(path))
}

/** 汇总为待执行的检查项：oxlint 先行，其后是各门禁。
 *  `scoped` 标记该检查会扫全仓库、需要按目录归属过滤输出。 */
const checks = [
  { label: 'oxlint', scoped: false, run: () => runShell('pnpm exec oxlint src', plugin) },
  ...GATES.map(gate => ({
    label: gate,
    scoped: true,
    run: () => runFile(process.execPath, ['--import', 'tsx/esm', resolve(root, 'scripts', `${gate}.ts`)], root),
  })),
]

const myLabel = relative(root, myRoot).replaceAll('\\', '/')

console.log(`verify: ${relative(root, plugin).replaceAll('\\', '/')}`)
console.log('')

const failures = []
for (const check of checks) {
  const result = check.run()
  const output = result.output.replace(/\n+$/, '')
  const lines = output.split('\n')
  // 引用路径的行才是违规行；标题与统计行不带路径，不参与归属判断。
  const refLines = lines.filter(line => GATE_PATH_TEST.test(line))
  const outsideOnly = refLines.filter(isOutsideOnly)
  if (result.code === 0) {
    console.log(`  ok    ${check.label}`)
    continue
  }
  if (check.scoped && refLines.length > 0 && outsideOnly.length === refLines.length) {
    console.log(`  ok    ${check.label} (${outsideOnly.length} violation line(s) outside ${myLabel} filtered)`)
    continue
  }
  console.log(`  FAIL  ${check.label}`)
  // 树外的违规行滤掉；不带路径的行（标题、汇总、无法归属的失败）一律保留。
  const kept = check.scoped ? lines.filter(line => !isOutsideOnly(line)) : lines
  if (output !== '') console.log(kept.map(line => `    ${line}`).join('\n'))
  failures.push(check.label)
}

console.log('')
if (failures.length === 0) {
  console.log(`verify: ${checks.length} check(s) passed`)
  process.exit(0)
}
console.error(`verify: ${failures.length} of ${checks.length} check(s) failed — ${failures.join(', ')}`)
process.exit(1)
