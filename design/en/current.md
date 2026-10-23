# dsh-pgnqukezrdxmhjso-base Current State

## Introduction

This plugin repository hosts the shared development base for the DSH plugins; it is not itself a feature plugin installable into a profile. It holds a gate aggregation script and a `common/` directory of reusable runtime code tools.

## Overview

The repository holds two unrelated parts: the development-time gate script `src/verify.ts`, and the runtime code tools under `src/common/` (object manager, dependency-injection container, locks, atomic writing, plain object helpers). There is no build output, so it takes part in no profile's bundle composition.

The files under `src/common/` depend only on Node built-ins and import nothing but relative paths; they have no dependency on dsh or on any particular plugin. This package **publishes source only**: `exports` points at `.ts` sources, a consumer imports them by subpath, and inlines them in its own build (listing this package in `devDependencies` suffices — its bundler compiles everything outside its production dependency sections into the artifact). This package therefore needs no `main`/`lib` and maintains no compiled output.

Plugins under `packages/my/` invoke the gate script as `pnpm -C ../dsh-pgnqukezrdxmhjso-base run verify`.

The plugin under check comes from the `INIT_CWD` environment variable: under pnpm the working directory becomes this base repository, and only `INIT_CWD` retains the directory that started the run, nor is it overwritten by a nested inner pnpm. Running the script directly without that variable falls back to the working directory.

This repository carries a `tsconfig.json` for `pnpm typecheck` (`tsc --noEmit`, checking only, emitting nothing) and for the editor, and at the same time it satisfies `verify-package-invariants`' requirement that the file exists in a package directory. It enables `allowImportingTsExtensions` because relative imports inside `common/` carry a `.ts` extension.

## todo

- The `common/` exports carry no JSDoc, and `verify-export-jsdoc` does not reach them (the gate resolves a package's public surface through `exports` targets under `lib/`, while this package points at `.ts` sources, so the scanned name set comes out empty). A build output or written comments would close the gap.

## Features

### Shared code tools

#### Runtime code reused by the plugins

- Description: `src/common/` provides an object manager, a dependency-injection container, locks, atomic file writing, and plain object helpers for the plugins under `packages/my/` to import by subpath.
- Files: [ObjectManager.ts](../../src/common/ObjectManager.ts), [BeanHelper.ts](../../src/common/BeanHelper.ts), [Locks.ts](../../src/common/Locks.ts), [AtomicWrite.ts](../../src/common/AtomicWrite.ts), [Objects.ts](../../src/common/Objects.ts).
- Solution: A consumer lists this package in `devDependencies` and imports `dsh-pgnqukezrdxmhjso-base/common/<file>.ts`; bundling inlines it into the consumer's artifact, so this package need not be installed after publication.
- Approach: This package ships source only and produces no build output because a consumer's bundler decides externality from its own dependency sections — as long as this package is not among its production dependencies, the sources are compiled into its artifact, and neither side maintains an intermediate output. `BeanHelper` and `Locks` both hold state, but the copies inlining produces are correct: each is a per-caller, instance-private mechanism with no identity that must cross packages.

### Plugin gate aggregation script

#### Summarise the gate results

- Description: Runs the harness gate scripts in order and summarises the results, for the `pnpm verify` of every plugin under `packages/my/`.
- Files: [verify.ts](../../src/verify.ts).
- Solution: Each gate runs with the harness repository root as its working directory and scans the whole repository, so this script attributes every violation by whether its reported path falls inside the plugins' shared directory `packages/my/`: lines outside it are neither displayed nor counted toward that gate's pass/fail, and a pass prints how many were filtered. When the directory under check has no `src/`, oxlint is skipped with a printed note, because oxlint exits with code 1 when it finds no files to lint.
- Approach:
  - A gate's scan root is hardcoded in the harness repository (defaulting to its root) and a plugin cannot narrow it, so the filtering can only live in this repository's own aggregation script; that keeps these kinds of checks for the plugin while making red mean "this plugin has a problem" again.
  - The rule is tightened to "the lines carrying paths are non-empty and all of them are outside" — relaxing it to "no path of ours in the output means pass" would silently pass a gate script crashing or missing build output, which is more dangerous than the false reports it replaced.
- Gates left out and why: see the comments inside the script.
