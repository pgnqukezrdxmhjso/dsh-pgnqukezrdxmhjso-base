# dsh-pgnqukezrdxmhjso-base

![AI-Crap](https://img.shields.io/badge/💩-AI_crap_code-5C4033?style=flat-square) [![npm](https://img.shields.io/npm/v/dsh-pgnqukezrdxmhjso-base?style=flat-square)](https://www.npmjs.com/package/dsh-pgnqukezrdxmhjso-base)

[中文](./README.zh.md)

The shared development base for the DSH plugins: a script that runs the harness gate scripts in order and summarises the results, for the `pnpm verify` of every plugin under `packages/my/`, plus a `common/` folder of runtime code tools those plugins share.

See [design/en/current.md](design/en/current.md) for details.

## Usage

Each plugin under `packages/my/` calls this script from its own `verify` script:

```sh
pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify
```

The gates run with the harness repository root as their working directory and scan the whole repository, so this script attributes every violation by whether its reported path falls inside `packages/my/`: lines outside it are neither displayed nor counted toward that gate's pass/fail. When a directory under check has no `src/`, the oxlint step is skipped with a printed note.

The plugin under check is taken from `INIT_CWD`, the directory that started the run: pnpm sets the working directory to the package owning the script, so the working directory alone would always name this base repository. Running the script directly without that variable falls back to the working directory.

## Shared code

`src/common/` holds runtime tools the plugins reuse: an object manager, a dependency-injection container, locks, atomic file writing, and plain object helpers. They depend only on Node built-ins.

Add this package to `devDependencies` and import the files by subpath:

```json
{ "devDependencies": { "dsh-pgnqukezrdxmhjso-base": "workspace:^" } }
```

```ts
import { BeanHelper } from 'dsh-pgnqukezrdxmhjso-base/common/BeanHelper.ts'
```

This package publishes source only. Declaring it in `devDependencies` keeps it out of a consumer's published dependency set while still resolving types; a consumer whose bundler inlines anything outside its production dependency sections ends up with the code compiled into its own artifact.

## Known Limitations and Deferred Work

`common/` exports carry no JSDoc, and `verify-export-jsdoc` does not reach them: the gate resolves a package's public surface through `exports` targets under `lib/`, while this package points at `.ts` sources, so the scanned name set comes out empty. Adding a build output or documenting the exports would close the gap.

## Built with dsh `0.1.7-rc.2`

## Secondary development

Clone this repository into a dsh workspace package directory, then run it:

```sh
git clone https://github.com/pgnqukezrdxmhjso/dsh-pgnqukezrdxmhjso-base packages/my/dsh-pgnqukezrdxmhjso-base
pnpm install
pnpm -C packages/my/dsh-pgnqukezrdxmhjso-base run verify
```

---

No runtime invariant companion is published because this repository is a development-time gate script with no runtime registration and no independent runtime relation to check.
