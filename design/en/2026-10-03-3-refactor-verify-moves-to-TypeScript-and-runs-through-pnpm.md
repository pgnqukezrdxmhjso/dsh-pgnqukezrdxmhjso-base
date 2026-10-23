# 2026-10-03-3-refactor-verify-moves-to-TypeScript-and-runs-through-pnpm

## Direct cause

The user asked for `verify` to be rewritten in TypeScript under `src/`, invoked by the calling plugins through a pnpm command that runs a script in base, so that base owns the command's contents and the plugin side stops changing whenever base's internals move — all without adding a dependency.

## Solution

Rewrite `verify.mjs` as `src/verify.ts`; change base's `verify` script to `node --import tsx/esm src/verify.ts`; change the `verify` command in the four plugins and in `dsh-version-manager` to `pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify`; take the plugin under check from `INIT_CWD` with a fallback to the working directory; drop `checkJs` from `tsconfig.json` and set `include` to `src`; add `tsx` to the development dependencies.

## Reasoning

- The goal is for the plugin-side command to be short and stable, so that base can change internally without notifying any plugin.
- `bin` cannot be used. It would let a plugin write a bare command (`dsh-verify`), but it requires the plugin to declare base as a dependency so pnpm links the bin into the plugin's `node_modules/.bin` — measured, without that declaration the neighbouring `.bin` never receives the command. The user explicitly ruled out adding a dependency, so that path is closed.
- That leaves invoking through a pnpm command, which brings the `cwd` semantics with it. Measured across three call forms (`pnpm -C`, `pnpm --filter`, and `--filter` from the repository root), `cwd` **becomes the package owning the executed script** — base — in every one of them, by pnpm's design. Reading `cwd` would make this script check base itself forever, and it would **look green**, which is worse than red.
- `INIT_CWD` solves exactly that, and measurement confirmed a nested inner pnpm does not overwrite it. On the real path — a plugin's `pnpm verify` calling the inner `pnpm -C base run verify` — `cwd` was base and `INIT_CWD` was the calling plugin. Attribution was then cross-checked by fault injection: with a file dropped into `dsh-prompt-file-injector`, its verify still printed `verify: packages/my/dsh-prompt-file-injector`.
- The `?? process.cwd()` fallback is kept so that running `verify.ts` directly, without pnpm and therefore without that variable, still works.
- The "skip oxlint when there is no `src/`" branch is kept. The user asked for it explicitly, in case a repository without `src/` appears again; oxlint exits with code 1 when it finds no files, so removing it would make such a repository fail forever.
- Converting to TypeScript sharpened `spawnSync`'s return type: `encoding: 'utf8'` narrows `stdout`/`stderr` to `string`, so the `?? ''` guards from the JS version became unnecessary and were reported as 4 findings by oxlint's `no-unnecessary-condition`. That falls under "code left invalid or useless after a change must not be kept", so they were removed; `status` can still be `null`, and its `?? 1` stays.
- `tsconfig.json` had used `allowJs` + `checkJs` to type-check `verify.mjs`; now that the source is TS itself, neither switch is needed, and `include` becomes `src/**/*.ts`.

## Verification

- `pnpm verify` in all five repositories prints `verify: 11 check(s) passed` with exit code 0: base, `dsh-version-manager`, `dsh-ui-fortifier`, `dsh-prompt-file-injector` and `dsh-llm-codebuddy-power`.
- Attribution (the key check this round): cross-checked by fault injection — after dropping a file into `dsh-prompt-file-injector`, its verify printed `verify: packages/my/dsh-prompt-file-injector`, with no misreport of base.
- Type checking: `tsc --noEmit -p tsconfig.json` in base reports 0 errors.
- oxlint: base changed from `skip oxlint (no src directory, skipped)` to `ok oxlint`, since it now has `src/verify.ts`.
- Path consistency: `verify-package-paths` briefly reported that both READMEs still pointed at the deleted `verify.mjs`; they pass after the fix.

## Files involved

- [src/verify.ts](../../src/verify.ts): rewritten from the `verify.mjs` at the repository root
- [package.json](../../package.json): `verify` runs `src/verify.ts` through tsx, with `files` and development dependencies updated
- [tsconfig.json](../../tsconfig.json): `allowJs`/`checkJs` dropped, `include` set to `src/**/*.ts`
- [README.md](../../README.md), [README.zh.md](../../README.zh.md): the invocation, the `INIT_CWD` note and the secondary-development example
- [.gitignore](../../.gitignore): ignores `temp/`
- Project state docs (one Chinese, one English): the overview and where the plugin under check comes from
- The four other plugin repositories (cross-repository changes, not linked from here): their `verify` command becomes `pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify`
- Two further plugin repositories gain `temp/` in `.gitignore`
