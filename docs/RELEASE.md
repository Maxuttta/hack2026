# Release guide

The Git repository contains source and documentation. The [v0.6.0 release](https://github.com/Maxuttta/hack2026/releases/tag/v0.6.0) carries the Windows installer. Generated JDK images, installers, local app profiles, collaboration keys and server data stay outside Git.

## Create the Windows package

Follow the [source build instructions](../README.md#build-from-source), then run:

```powershell
pnpm dist
pnpm smoke
pnpm acceptance:large
pnpm acceptance:collaboration
pnpm acceptance:collaboration-desktop
Get-FileHash 'dist/Java Blueprints Setup 0.6.0.exe' -Algorithm SHA256
```

Confirm the version in `package.json` and use the corresponding installer filename. The CI workflow creates a downloadable build artifact on successful pushes to `main` and pull requests. A GitHub Release can attach the installer and record its SHA-256 hash; do not commit the `.exe` itself.

## Suggested release description

**Java Blueprints for Windows x64**

- Java 17 compiler and runtime included.
- Linked Java source and editable graph with AST-backed structure and diagnostics.
- 1,000-line case demo with a guarded `HashMap` optimization and decomposition.
- Before/after console behavior comparison, automatic regression detection and counterexample search.
- Live collaboration with editor/viewer invitations and disk-backed rooms.

The installer is unsigned. Windows may display a publisher warning. Java programs execute locally with the user's permissions. Behavior checks cover selected console inputs rather than every possible execution.

## Publication hygiene

Before any public push, review `git diff --cached --name-only`, check that `runtime/`, `dist/`, `node_modules/`, `analyzer/bin/`, profiles, server data and secrets are absent, and scan source for accidental credentials. Publish no private invitation URL: it contains a capability token in the fragment.
