# Environment discovery and installation

```sh
node <skill>/scripts/aiyoupu.mjs doctor <project>
node <skill>/scripts/aiyoupu.mjs install --project <project> --plan
```

Configure an existing Python/Verovio/MuseScore installation through `AIYOUPU_PYTHON`, `AIYOUPU_VEROVIO`, and `AIYOUPU_MUSESCORE` (or an explicit browser path via `AIYOUPU_BROWSER`). No author-machine path is assumed.

Repeat authorized-project/python arguments when appropriate. Discovery checks exact baseline versions, actual module/CLI usability, project/authorized venvs, launchers, PATH and bounded standard Windows locations. It does not scan every user project. Package-manager probes avoid Corepack downloads. A missing PATH entry is only one search result, not proof that the application is absent.

Reuse a compatible current project first. For an existing target with no dependencies, explicit `--reuse-project <authorized-project>` can create a dependency junction/symlink only after both installed versions and target declarations match. It refuses differing existing files or any existing dependency directory. Never replace a user's node_modules. A known existing junction in a user project is resolved and checked, not relinked silently.

```sh
node <skill>/scripts/aiyoupu.mjs install --project <project> --reuse-project <compatible-project>
```

For a genuinely new directory, first run `install --standalone <new-directory> --plan`. Explain target paths, versions, locked package count, expected package-manager work and why reuse was not suitable. Request confirmation before the first dependency install or any new large dependency. After authorization, scaffold with `--standalone`, then execute the reviewed package-manager command in that directory. `confirmation_required:true` and `npmCi.executed:false` are not successful dependency installation. Do not assume permission because a plan was printed. Reuse an existing browser explicitly with --browser rather than preparing a new one unnecessarily.
