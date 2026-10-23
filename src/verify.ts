#!/usr/bin/env node
/**
 * 插件门禁校验：依次运行 harness 的门禁脚本并汇总结果。
 *
 * 由各插件 package.json 的 verify 脚本经 pnpm 调用，被校验的插件目录由
 * {@link plugin} 决定。
 *
 * 门禁脚本在 harness 仓库根运行，会扫描整个仓库并报出仓库其它部分的违规。落在
 * {@link myRoot}（全部插件的共同目录）之外的违规与被校验的插件无关，展示时逐行滤掉，
 * 也不计入该门禁的成败。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** harness 仓库根：本文件位于 packages/my/<base>/src/ 下，上溯四级。 */
const root = resolve(import.meta.dirname, '..', '..', '..', '..')

/** 全部插件的共同目录：本文件所在目录上溯两级。只有报在这里的违规才属于被校验的插件。 */
const myRoot = resolve(import.meta.dirname, '..', '..')

/**
 * 被校验的插件根目录。
 *
 * 优先取 `INIT_CWD` 而不是 `process.cwd()`：经 pnpm 的 `-C` 或 `--filter` 调用时，pnpm 会把
 * 工作目录切到 script 所属的包（即本脚本所在的 base），而 `INIT_CWD` 保留发起调用的目录、
 * 也就是真正要校验的那个插件，且两层 pnpm 嵌套下不会被内层覆盖。直接运行本文件时没有这个
 * 变量，此时回退到工作目录。
 */
const plugin = process.env.INIT_CWD ?? process.cwd()

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

/** 一次检查的执行结果。 */
interface CheckResult {
  /** 进程退出码。 */
  code: number
  /** 合并后的标准输出与标准错误。 */
  output: string
}

/** 一个待执行的检查项。 */
interface Check {
  /** 检查项名称，即门禁脚本名。 */
  label: string
  /** 该检查是否扫全仓库、需要按目录归属过滤输出。 */
  scoped: boolean
  /** 返回跳过原因；返回 undefined 表示照常执行。 */
  skip?: () => string | undefined
  /** 执行该检查。 */
  run: () => CheckResult
}

/**
 * 运行一个可执行文件并捕获输出（不经 shell，路径原样传递）。
 * @param file 可执行文件。
 * @param args 参数。
 * @param cwd 工作目录。
 * @returns 退出码与合并后的标准输出、标准错误。
 */
function runFile(file: string, args: string[], cwd: string): CheckResult {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) return { code: 1, output: String(result.error) }
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * 运行一条 shell 命令（pnpm 在 Windows 下是 .cmd，无法直接 spawn）。
 * @param command 命令文本。
 * @param cwd 工作目录。
 * @returns 退出码与合并后的标准输出、标准错误。
 */
function runShell(command: string, cwd: string): CheckResult {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8' })
  if (result.error !== undefined) return { code: 1, output: String(result.error) }
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * 一条门禁报出的路径是否落在 {@link myRoot} 之内。
 *
 * 行号后缀（`foo.ts:11`）先剥掉：它对归属判断没有意义，留着的 `:` 在 Windows 上
 * 还会让 `resolve` 把它当成盘符之后的字符。
 * @param reported 门禁输出里截取的 `packages/...` 路径。
 * @returns 落在该目录树内时为 true。
 */
function isInsideMy(reported: string): boolean {
  const path = reported.replace(/:\d+(?::\d+)?$/, '')
  const absolute = resolve(root, path)
  return absolute === myRoot || absolute.startsWith(`${myRoot}${sep}`)
}

/**
 * 一行里截取到的全部路径。
 * @param line 门禁输出的一行。
 * @returns 该行里出现的 `packages/...` 路径。
 */
function pathsIn(line: string): string[] {
  return line.match(GATE_PATH_PATTERN) ?? []
}

/**
 * 一行是否**只**引用了 {@link myRoot} 之外的路径。
 *
 * 没有引用任何路径的行返回 false：无法归属到任何目录的失败不能算作"与本插件无关"，
 * 否则门禁自身崩溃、构建产物缺失这类输出会被静默当成通过。
 * @param line 门禁输出的一行。
 * @returns 该行引用的路径非空且全部在目录树之外时为 true。
 */
function isOutsideOnly(line: string): boolean {
  const paths = pathsIn(line)
  if (paths.length === 0) return false
  return paths.every(path => !isInsideMy(path))
}

/** 汇总为待执行的检查项：oxlint 先行，其后是各门禁。 */
const checks: Check[] = [
  {
    label: 'oxlint',
    scoped: false,
    // 没有 src 的仓库（如纯脚本的插件）不跑 oxlint：oxlint 在无可检查文件时退出码为 1，
    // 会把这个仓库的 verify 变成永远失败。跳过时打印说明，避免读的人以为它跑过了。
    skip: () => (existsSync(join(plugin, 'src')) ? undefined : 'no src directory, skipped'),
    run: () => runShell('pnpm exec oxlint src', plugin),
  },
  ...GATES.map(gate => ({
    label: gate,
    scoped: true,
    run: (): CheckResult =>
      runFile(process.execPath, ['--import', 'tsx/esm', resolve(root, 'scripts', `${gate}.ts`)], root),
  })),
]

const myLabel = relative(root, myRoot).replaceAll('\\', '/')

console.log(`verify: ${relative(root, plugin).replaceAll('\\', '/')}`)
console.log('')

const failures: string[] = []
for (const check of checks) {
  const skipReason = check.skip?.()
  if (skipReason !== undefined) {
    console.log(`  skip  ${check.label} (${skipReason})`)
    continue
  }
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
