# AGENTS.md

Guidance for AI agents working in this repository.

## Repository status

`main` is currently a **stub**: it contains only `README.md` (`# stockpredition`). There is no application source, dependency manifest, test suite, or build configuration on this branch.

Other remote branches under `cursor/*` hold unrelated experiments from prior agent sessions; they are not part of the stock prediction product on `main`.

## Cursor Cloud specific instructions

### Toolchain (pre-installed on the VM)

| Tool | Notes |
|------|--------|
| Node.js | v22 via nvm (`node`, `npm`, `pnpm`, `yarn`) |
| Python | 3.12 (`python3`, `pip`) |
| Git | Standard git workflow against `origin` |

Docker is **not** required for the current `main` branch (no containers defined).

### Update script behavior

The VM update script is intentionally minimal (`true`) because `main` has no lockfiles or dependency manifests to refresh. When application code and manifests are added (e.g. `package.json`, `pyproject.toml`, `requirements.txt`), **extend the update script** with the appropriate install command (`npm install`, `pip install -r requirements.txt`, etc.).

### Lint / test / build / run

There are **no** lint, test, build, or dev scripts on `main` until project scaffolding is added. Do not expect `npm test`, `pytest`, or similar to succeed without first adding code and tooling.

### When application code is added

Typical next steps for a stock-prediction project:

1. Add a dependency manifest and `.env.example` for API keys (market data providers, etc.).
2. Document required services (API, frontend, database, optional ML worker) in `README.md`.
3. Add standard scripts (`dev`, `test`, `lint`) and wire them in CI.
4. Update this file and the VM update script accordingly.

### Branch naming

Cloud agents should create feature branches as `cursor/<descriptive-name>-7ec0`.
