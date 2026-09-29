# 2026-09-24-1-fix-gate-checks-filter-errors-outside-the-plugin-directory

## Direct Cause

Running `pnpm verify` from a plugin under `packages/my/`, the `verify-export-jsdoc` check failed persistently, and it failed on 11 violations that had nothing to do with the plugin: they sat in `packages/session/session-persistence`, `packages/storage/storage`, `packages/storage/storage-domain` and `packages/workspace/workspace`, all of them untracked build residue (`src/**/*.d.ts`) belonging to the harness repository itself.

The cause is how these gate scripts run: [verify.mjs](../../verify.mjs) executes them with `process.execPath`, `cwd` pinned to the harness repository root, and each script hardcodes its scan root to that root (`globSync('packages/*/*/src/**/*.ts', { cwd: scanRoot })`, where `scanRoot` defaults to the repository root). So **whichever plugin calls them, they scan the whole repository and report violations belonging to other parts of it**; whether the plugin's own code is clean does not affect the outcome at all.

Every one of those is a **false report**: the plugin never touched those files and has no standing to change them. And the cost of a false report is real — the gate stays red forever, "this check fails" stops carrying information, and the plugin's own genuine violations drown in the same red.

## Solution

[verify.mjs](../../verify.mjs) gains a layer that attributes the output: only violations inside the **plugins' shared directory** (`packages/my/`, the parent of the directory this file lives in) belong to this plugin, and lines outside it are dropped from display and excluded from that gate's pass/fail.

Attribution compares resolved absolute paths (`resolve(root, path)` prefix-matched against `myRoot`) rather than doing a string containment test — otherwise a sibling `packages/myfoo` would be misread as being inside `packages/my`. A `:line` suffix is stripped before the test, because it says nothing about ownership and, on Windows, would make `resolve` treat the colon as following a drive letter.

Three attribution functions:

- `isInsideMy(reported)`: whether one reported path lies inside the directory tree.
- `pathsIn(line)`: every path captured from one line.
- `isOutsideOnly(line)`: whether a line references a **non-empty** set of paths that **all** lie outside the tree.

The pass/fail rule tightens accordingly: **when a gate fails, it counts as unrelated to this plugin only if the lines carrying paths are non-empty and all of them reference only outside paths**. Lines carrying no path are always kept and still fail the gate.

The checks also gain a `scoped` flag: only the `GATES` entries that scan the whole repository take the filter, while `oxlint` runs inside the plugin directory and its output concerns only this plugin, so it is not filtered.

## Approach

**Conclusion: move the criterion for "failure" from "non-zero exit code" to "non-zero exit code and the violations belong to this plugin", but tightened so that unattributable failures are never treated as passing.**

**Why filter rather than drop these entries from the gate list.** They are not always idle: `verify-export-jsdoc` checks whether **this plugin's** exports carry JSDoc, and `verify-md-links` and `verify-md-wrap` check **this plugin's** documentation — all checks this repository genuinely needs. Dropping them would abandon those checks for this plugin merely to stop them reporting other people's problems. Filtering keeps the checking power and discards only the conclusions that are not about here.

**Why the scan range cannot be narrowed by an argument or configuration.** The gate scripts hardcode their scan root (defaulting to the repository root) and take no "scan only this subdirectory" input; changing them would mean editing the harness repository, beyond this plugin repository's scope. Filtering happens inside **this repository's own** aggregation script, the only place reachable by changing nothing but our own code.

**Why not an allowlist, an ignore list, or simply ignoring exit codes.** An allowlist or ignore list would have to enumerate which paths may be disregarded, needing maintenance every time the repository gains another piece of build residue, while ignoring exit codes would discard genuine plugin violations along with them. Judging by **directory ownership** is a structural criterion: it does not care which files those are, only whether the conclusion is about our code, and so needs no maintenance.

**Why failures without a path must be kept.** This is the easiest place in the change to get wrong, and the most dangerous. Write the rule as "no path of ours in the output means pass" and three cases that **should fail** turn green: the gate script crashing (`ERR_MODULE_NOT_FOUND`), the script missing, and an early exit caused by missing build output. Those are unattributable outputs, and treating them as "not about me" would trade a false report for a silent pass — far worse than the original problem, because a false report is at least audible, whereas a silent pass lets a broken check go unnoticed indefinitely. The rule is therefore tightened to "has paths and all of them are outside", leaving pathless failures on the failing side.

**Why `oxlint` does not take the filter.** It runs inside the plugin directory (`pnpm exec oxlint src`, `cwd` being the plugin root), so its output can only concern this plugin; subjecting it to attribution would be meaningless and would add a layer that can itself go wrong.

**Why the filtered count is still printed.** Filtering turns a check from "FAIL" into "ok", and without saying why a reader would think the check never ran. Printing `(N violation line(s) outside packages/my filtered)` preserves how much was discarded and keeps "why did this pass" answerable.

## Additional Benefit

The filter turns "can this gate still find my problems" into a readable signal: red means it is this plugin's problem, and green still shows how many lines attribution discarded.

## Verification

- Running `pnpm verify` directly (invoked from `packages/my/dsh-llm-codebuddy-power`): all 11 checks pass, with `verify-export-jsdoc` showing `ok (11 violation line(s) outside packages/my filtered)`.
- **An inside violation still fails** (constructed, then reverted): appending an exported function without JSDoc to `src/constants.ts` made that gate **FAIL** and print `exported function 'tmpProbeVerifyFilter' (packages/my/dsh-llm-codebuddy-power/src/constants.ts:92) has no JSDoc.` — proving the filter does not discard this plugin's genuine violations. The planted code was reverted byte for byte.
- **A pathless failure still fails** (constructed, then reverted): adding `verify-nonexistent-probe` to `GATES` made that gate **FAIL** and print `ERR_MODULE_NOT_FOUND`, not swallowed into a pass. The probe was removed, after which the file matched the backup byte for byte.
- `node --check verify.mjs`: syntax passes.
- **Not verified**: no mixed sample carrying both inside and outside paths was constructed; that case takes the `kept` branch and retains the inside line, which is a conclusion read from the code.

## Files

- [verify.mjs](../../verify.mjs): adds `myRoot` and three attribution functions, a `scoped` flag on the checks, and attribution filtering for the failure rule and the display.
