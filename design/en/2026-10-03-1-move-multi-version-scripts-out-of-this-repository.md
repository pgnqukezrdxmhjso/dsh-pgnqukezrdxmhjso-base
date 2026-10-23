# 2026-10-03-1-move-multi-version-scripts-out-of-this-repository

## Direct cause

The multi-version management scripts share no code with this repository's gate aggregation script, and the user asked for those scripts and their change records to move into a separate repository, `dsh-version-manager`.

## Solution

Move the whole `scripts/dsh-versions/` directory out, along with the 20 change-record pairs for `2026-10-02-*` and `2026-10-03-*`; drop the `versions` script, the `scripts/*` packaging entry and the two now-unused dependencies from this repository's `package.json`; and remove the entire multi-version management section from both the Chinese and English project state documents, leaving only the gate aggregation script.

## Reasoning

- The goal is for this repository to keep only its own responsibility: aggregating gate results for the plugins under `packages/my/`.
- `verify.mjs` has to stay. Three plugins outside `dsh-pgnqukezrdxmhjso-base` invoke it as `node ../dsh-pgnqukezrdxmhjso-base/verify.mjs`, so moving it would break all of their `pnpm verify` runs; and two repositories with that dependency should not be split in the first place.
- The project state documents were rewritten rather than trimmed. The overview read "the repository currently holds two mutually independent development-time scripts", which stops being true once a section is deleted, along with the feature sections; rewriting around "one script remains" keeps the description matching the facts better than a local deletion.
- Three things in `package.json` had to be synchronised: the `versions` script pointed at the moved entry point, the `scripts/*` entry in `files` had no matching directory left, and `@inquirer/prompts` and `semver` were used only by the moved scripts. Leaving any of them behind would mean configuration with no corresponding entity.
- A `verify` script pointing at this repository's own `verify.mjs` was added at the same time, so this repository can self-check with `pnpm verify` like the other plugins.
- A pre-existing defect in the aggregation script was fixed along the way: its oxlint step exits with code 1 on a directory without `src/` (`No files found to lint`), and this repository is exactly such a repository, so its `pnpm verify` was bound to fail. The step is now skipped with a printed `skip` note when no `src/` is found, leaving plugins that do have `src/` unchanged.

## Verification

- Move confirmed: the `scripts/` directory no longer exists; only `2026-09-23-1` and `2026-09-24-1` (one Chinese and one English each) remain under this repository's `design/`, and they describe this repository's own changes and are already pushed, so the rules forbid modifying them.
- Aggregation script change: running `verify.mjs` in this repository prints `skip oxlint (no src directory, skipped)`, while running the same script under `dsh-ui-fortifier` still prints `ok oxlint`, confirming plugins with `src/` are unchanged.
- Syntax and oxlint: `node --check` passes for `verify.mjs`; oxlint reports 0 warnings and 0 errors under 137 rules.
- Packed contents: the `files` field in `package.json` matches the repository's actual contents and no longer references the moved directory.

## Files involved

- `scripts/dsh-versions/`: moved out in full to `dsh-version-manager` (that extra level was later dropped in the new repository, where the files sit directly under `scripts/`)
- [package.json](../../package.json): drops the `versions` script, the `scripts/*` packaging entry and the two dependencies, and adds a `verify` script
- [verify.mjs](../../verify.mjs): skips the oxlint step with a printed note when `src/` does not exist
- Project state docs (one Chinese, one English): the multi-version management section removed and the overview rewritten around a single script
- 20 change-record pairs: moved out to `dsh-version-manager`
