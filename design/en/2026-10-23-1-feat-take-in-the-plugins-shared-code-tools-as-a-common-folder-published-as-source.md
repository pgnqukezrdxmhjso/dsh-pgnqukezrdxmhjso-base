# Take in the plugin's shared code tools as a `common/` folder published as source

## Direct cause

`dsh-llm-codebuddy-power` had five files totalling 1325 lines under its `src/common/`: an object manager, locks, atomic writing, a dependency-injection container, and plain object helpers. They know nothing about the CodeBuddy service and nothing about dsh — only Node built-ins — so they were always meant to be reused outside that plugin, and keeping them inside it cost three things:

- they ship inside the plugin's own artifact, so anyone else needing them must copy
- a copy across repositories drifts, and a fix lands in one place only
- they sit in the same source tree as the plugin's business code, so reading anything there starts with judging which layer the directory belongs to

## Solution

Add `src/common/` to this package with those five files, and adjust the package metadata so they can be imported by subpath.

| File | Contents |
|---|---|
| `src/common/ObjectManager.ts` | Managed object: one in-memory truth plus persistence and change-notification outlets |
| `src/common/BeanHelper.ts` | Dependency-injection container |
| `src/common/Locks.ts` | Key-grouped locks, coalescing locks, a task queue, concurrency budgets |
| `src/common/AtomicWrite.ts` | Atomic replacement plus per-path serialization |
| `src/common/Objects.ts` | Null checks, deep clone, flattening, key-path parsing |

Filenames are capitalized. `atomicFile.ts` also became `AtomicWrite.ts`: the old name juxtaposed "atomic" with "file", while the module performs an atomic **write**, and its second half named the thing written rather than the job done.

Three metadata changes:

```jsonc
// exports: callers take the sources by subpath
"exports": {
  "./common/*": "./src/common/*",
  "./package.json": "./package.json"
},
// files: the old pattern matched one level under src and could not reach common/
"files": ["src/**/*", ...],
// tsconfig: relative imports inside common/ carry a .ts extension
"allowImportingTsExtensions": true
```

## Reasoning

**Conclusion: this package ships source only and produces no build output, letting each consumer inline it during its own build.**

`dsh-llm-codebuddy-power`'s tsdown preset decides externality from the package.json dependency sections: only names in `dependencies`/`peerDependencies`/`optionalDependencies` survive as imports, and everything else is inlined. So a consumer only has to list this package in `devDependencies` — type resolution finds the sources, the artifact does not contain it, and nothing needs installing after publish. This package therefore needs no `main`/`lib` and no compiled output to maintain.

That path costs gate visibility, recorded under the README's known limitations.

**The five files import only relative paths and Node built-ins, with no edge into the plugin or into dsh.** That is the precondition for moving them wholesale, and it was confirmed file by file beforehand.

`BeanHelper` and `Locks` both hold state, but the multiple copies inlining produces are **correct**: each is a per-caller, instance-private mechanism with no identity that must cross packages. `ObjectManager` is the same.

## Additional benefit

Changing `files` from `src/*` to `src/**/*` fixed a long-standing problem: the old pattern matched only first-level files under `src`, so no subdirectory ever entered the published package.
