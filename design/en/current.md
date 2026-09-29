# dsh-pgnqukezrdxmhjso-base Current State

## Introduction

This plugin repository hosts the shared development base for the DSH plugins; it is not itself a feature plugin installable into a profile.

## Overview

The repository currently contains only development-time scripts: no `src` sources and no build output, so it takes part in no profile's bundle composition.

## todo

- None.

## Features

### Compiled-version launcher

- Description: Starts the compiled dsh at `D:\data\code\dsh` and isolates the Harness home into a `.dsh` under this plugin directory, so the compiled version and the official instance on the default `~/.dsh` never interfere with each other.
- Files: [start-dsh.mjs](../../start-dsh.mjs)
- Solution: The script sets `DSH_HOME` for the child process only, leaving the caller's shell environment untouched; `cwd` stays the invoking directory so the workspace root remains wherever the user is; `stdio: 'inherit'` passes dsh's terminal interaction and exit code through unchanged. With no arguments it starts `web --no-open --port 3082`. `DSH_SOURCE_ROOT` and `DSH_ISOLATED_HOME` override the checkout root and the isolated home.
- Approach: Isolation is required rather than optional, because `$DSH_HOME/profiles/node_modules` is one shared module-fallback directory whose links dsh rebuilds on every launch to point at the installation currently running (`healProfilesModuleFallback` in `packages/boot/app-boot/src/profile.ts`). Two installations sharing one home would rewrite each other's targets; only a home each owns exclusively lets them coexist. The port is 3082 because instances already run on 3080 and 3081.
- Missing build output: when `apps/cli/lib/bin.js` is absent the script exits and prints the `pnpm install` and `pnpm run build` commands to run, rather than installing or building on the user's behalf.
- The isolated home starts empty: the default home's credentials and settings are not copied, so the models must be configured in the Web Settings page on first use.

### Plugin gate aggregation script

- Description: Runs the harness gate scripts in order and summarises the results, for the `pnpm verify` of every plugin under `packages/my/`.
- Files: [verify.mjs](../../verify.mjs)
- Solution: Each gate runs with the harness repository root as its working directory and scans the whole repository, so this script attributes every violation by whether its reported path falls inside the plugins' shared directory `packages/my/`: lines outside it are neither displayed nor counted toward that gate's pass/fail, and a pass prints how many were filtered.
- Approach: A gate's scan root is hardcoded in the harness repository (defaulting to its root) and a plugin cannot narrow it, so the filtering can only live in this repository's own aggregation script; that keeps these kinds of checks for the plugin while making red mean "this plugin has a problem" again. The rule is tightened to "the lines carrying paths are non-empty and all of them are outside" — relaxing it to "no path of ours in the output means pass" would silently pass a gate script crashing or missing build output, which is more dangerous than the false reports it replaced.
- Gates left out and why: see the comments inside the script.
