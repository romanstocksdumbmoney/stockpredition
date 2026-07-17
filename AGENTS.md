# AGENTS.md

Guidance for AI agents working in this repository.

## Repository status

`main` is currently a **stub**: it contains only `README.md` (`# stockpredition`) and this
`AGENTS.md`. There is no application source, dependency manifest, test suite, or build
configuration on this branch.

Other remote branches under `cursor/*` hold unrelated experiments from prior agent sessions
(e.g. small games, expense trackers, a tradebot scaffold). They are **not** part of the stock
prediction product on `main` and should not be assumed to be present.

## Cursor Cloud specific instructions

### Toolchain (pre-installed on the VM)

| Tool | Version / Notes |
|------|-----------------|
| Node.js | v22 via nvm (`node`, `npm`, `pnpm`, `yarn` all available) |
| Python | 3.12 (`python3`, `pip`) |
| Git | Standard git workflow against `origin` |

Docker is **not** installed and is **not** required for the current `main` branch (no
containers are defined).

### Update script behavior

The VM update script is intentionally near-empty because `main` has no lockfiles or
dependency manifests to refresh. It only installs dependencies if a recognized manifest is
present, so it is a no-op on the current stub. When application code and manifests are added
(e.g. `package.json`, `pyproject.toml`, `requirements.txt`), confirm the update script picks
them up and extend it if a non-standard install step is required.

### Lint / test / build / run

There are **no** lint, test, build, or dev scripts on `main` until project scaffolding is
added. `npm test`, `pytest`, and similar commands will not succeed until code and tooling are
introduced. The only thing that can be "run" today is the language runtimes themselves
(`node`, `python3`).

### When application code is added

Typical next steps for a stock-prediction project:

1. Add a dependency manifest and `.env.example` for API keys (market-data providers, etc.).
2. Document required services (API, frontend, database, optional ML worker) in `README.md`.
3. Add standard scripts (`dev`, `test`, `lint`) and wire them into CI.
4. Update this file and the VM update script accordingly.
