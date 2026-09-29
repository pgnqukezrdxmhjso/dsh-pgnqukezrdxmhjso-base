# 2026-09-23-1-feat-compiled-dsh-launcher-and-home-isolation

## Direct Cause

Running the compiled dsh on the same machine contends with the official instance on the default `~/.dsh` over one shared module-fallback directory, so a fixed, reusable launch path was needed to separate the two.

## Solution

Added `start-dsh.mjs` to the plugin repository: it sets `DSH_HOME` for the child process only, pointing at a `.dsh` under this plugin directory, forwards arguments unchanged to `apps/cli/lib/bin.js` built from `D:\data\code\dsh`, and defaults to `web --no-open --port 3082` with no arguments. `DSH_SOURCE_ROOT` and `DSH_ISOLATED_HOME` override the checkout root and the isolated home; when build output is missing the script errors and prints the commands to run. `.dsh/` joins this repository's git ignore list.

## Approach

**Conclusion**: isolation is achieved through a child-process environment variable, not by mutating the user's shell environment or copying directories; missing build output is reported rather than built.

Causal chain:

- The goal is to let the compiled version and the instance on the default home run at the same time. One instance already runs on each of 3080 and 3081, so the port is not the bottleneck; the real conflict is `$DSH_HOME/profiles/node_modules`, one shared module-fallback directory whose links `healProfilesModuleFallback` rebuilds on every launch to point at the installation currently running. Each installation therefore needs its own home.
- Setting `DSH_HOME` for the child process only keeps the variable scoped to this launch and leaves no side effect in the user's shell. Setting it machine-wide or in a shell profile would also drag the installed dsh along, which exceeds the goal of launching the compiled version.
- Placing the isolated home under the plugin directory is the user's choice; the `.gitignore` entry follows from it, since runtime data would otherwise enter this plugin repository's commit surface.
- Erroring instead of running `pnpm install && pnpm run build` is the user's choice: building is slow and writes the checkout, and the script's job is only to launch.
- Not copying credentials and settings from the default home is the user's choice: the cleanest starting point, at the cost of configuring models in the Web Settings page on first use.
- The default port is 3082 because instances already listen on 3080 (`dsh web`) and 3081 (`--profile pkgtest --port 3081`), and that port was measured free.
- The script is `.mjs` rather than `.ts`: the sibling `verify.mjs` is already plain Node, and this repository has no `package.json` and no build step, so `node start-dsh.mjs` runs directly without a tsx dependency.
- `spawnSync` with `stdio: 'inherit'`: dsh is a long-lived interactive process, and inheriting the standard streams passes terminal output and keyboard input through while returning the exit code unchanged.

## Files

- [start-dsh.mjs](../../start-dsh.mjs): the new launcher.
- [.gitignore](../../.gitignore): new, ignoring the isolated home `.dsh/`.
- The project-state documents (one Chinese, one English): new.
