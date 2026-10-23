# 2026-10-03-2-feat-add-tsconfig-and-README-so-the-gate-passes

## Direct cause

`verify-package-invariants` kept failing for this repository: reading the `tsconfig.json` in this repository's directory found no such file and threw ENOENT outright. The user asked for it to be supplied and for an invariants sentence to be added at the end of the README after a horizontal rule.

## Solution

Add a `tsconfig.json` (type-checking `verify.mjs` through `checkJs` while satisfying the gate's file-existence requirement); fill the README out from a single heading into a complete English and Chinese pair with a trailing rule and the invariants sentence; give `verify.mjs` a `@typedef` and parameter types; and add a `typecheck` script plus `files` entries to `package.json`.

## Reasoning

- The goal was to turn this gate green without adding a decorative file that does nothing.
- The nature of the failure needs stating: the gate does not judge this repository in violation, it **crashes**. It scans `packages/*/*/package.json` — every package in the whole harness repository — and `checkBuild` reads `${package directory}/tsconfig.json` without first checking that the file exists, so any package missing it makes the gate throw ENOENT. This repository was the first package it hit; once fixed, it immediately moved on to the next (`dsh-version-manager`), so both repositories need one.
- Since the file must exist, it may as well do real work instead of holding an empty object. This repository's code is JS, so `allowJs` and `checkJs` are enabled to have `tsc` check `verify.mjs`. It immediately reported 4 problems, one of them a genuine defect: `skip` exists only on the oxlint entry of the `checks` array, so reading `check.skip` did not hold up in the type system — adding a `Check` `@typedef` resolved it. That inconsistency came from the previous round's work to skip oxlint in repositories without `src/`.
- The gate has one further requirement for `tsconfig.json`: that `references` does **not** contain `runtime-diagnostics/invariants` (this repository has no `src/invariant.ts`, hence no companion). The config has no `references` field and therefore satisfies it.
- The README had to be filled out. It previously held a single heading, while the rules require at least the project name, the badge area, a link to the other language, a summary, a link to `current.md`, installation and a feature list. It was written to match how the other plugins under `packages/my/` are organised.
- The invariants sentence has to pass the gate's regular expression `No (?:(?:runtime )?invariant )?companion is published(?: because|[.:;—])\s+\S`: real content must follow `because`, and the sentence must genuinely be present in the file. Placing it at the end after a `---` matches the sibling plugins.

## Verification

- Gate turns green: running `node --import tsx/esm scripts/verify-package-invariants.ts` at the harness repository root prints `verify-package-invariants: 38 hand-owned package companion(s) conform.` instead of throwing ENOENT.
- Full verify for this repository: `node verify.mjs` prints `verify: 11 check(s) passed` with exit code 0, and `verify-package-invariants` reads `ok` (it was FAIL before the change).
- Type checking: `tsc --noEmit -p tsconfig.json` reports 0 errors (4 before the change).
- Syntax: `node --check verify.mjs` passes.
- The config carries no `references`, satisfying the gate's requirement for a package without a companion.

## Files involved

- [tsconfig.json](../../tsconfig.json): new, `checkJs` over `verify.mjs`
- [README.md](../../README.md): filled out from a single heading, with a trailing rule and the invariants sentence
- [README.zh.md](../../README.zh.md): new
- [verify.mjs](../../verify.mjs): a parameter type for `pathsIn` and a `Check` `@typedef` for `checks`
- [package.json](../../package.json): a `typecheck` script, and `tsconfig.json` plus `README.zh.md` in `files`
- Project state docs (one Chinese, one English): the overview now records what this config file does
