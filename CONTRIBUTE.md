# Contributing

Contributions are welcome. This project uses unofficial private GoBiz / Gojek / GoPay APIs, so changes must prioritize account safety, credential protection, and graceful handling of upstream changes.

## Before You Start

- Search existing issues and pull requests before opening a duplicate.
- Open an issue before large behavioral or architectural changes.
- Never include a real QRIS payload, merchant ID, phone number, token, cookie, OTP, session file, database credential, or encryption key in code, tests, logs, screenshots, commits, or issues.
- Use synthetic fixtures and mocked upstream responses in tests.

## Local Setup

Requirements:

- Node.js 24 or newer
- pnpm 11.23.0, declared in `package.json`

```bash
git clone https://github.com/azmi2409/gopay-merchant-qris-gateway.git
cd gopay-merchant-qris-gateway
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Use placeholder values while developing. A real GoBiz login is not required for most work or for the automated test suite.

## Development Workflow

1. Create a focused branch from `main`.
2. Make the smallest change that solves one problem.
3. Add or update tests for behavioral changes.
4. Run the required checks:

```bash
pnpm run build
pnpm test
```

5. Update `README.md` when setup, configuration, or public API behavior changes.
6. Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.
7. Open a pull request describing the problem, solution, verification, and compatibility impact.

## Code Guidelines

- Follow the existing TypeScript style and module organization.
- Keep routes thin and place reusable behavior in existing services or utilities.
- Use the Node.js standard library or existing dependencies before adding a package.
- Validate input at HTTP and external-system trust boundaries.
- Preserve API response compatibility unless the change is documented as breaking.
- Keep database changes compatible with local SQLite and remote LibSQL/Turso.
- Return safe errors to clients; do not expose tokens, cookies, internal responses, or stack traces.
- Do not make automated tests depend on network access, a local `gopay_session`, or a real merchant account.

## Commit and Pull Request Guidelines

Use concise, imperative Conventional Commit-style messages:

```text
feat: add payment reconciliation endpoint
fix: handle expired GoBiz session
docs: clarify Turso configuration
test: cover duplicate transaction claims
```

Keep commits atomic and deployable. Pull requests should include:

- What changed and why
- Any API, configuration, database, or deployment impact
- Tests added or updated
- Commands used for verification
- Screenshots for payment-page UI changes

## Reporting Security Issues

Do not disclose credentials, working private API tokens, account data, or exploitable security details in a public issue. Contact the maintainer privately through the repository owner's GitHub profile and rotate any exposed credential immediately.

## Release Process

This project follows Semantic Versioning:

- `PATCH`: backward-compatible fixes
- `MINOR`: backward-compatible features
- `MAJOR`: breaking API or configuration changes

For a release:

1. Move entries from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update `package.json` to the same version.
3. Run `pnpm install --frozen-lockfile`, `pnpm run build`, and `pnpm test`.
4. Commit the release changes.
5. Create an annotated Git tag named `vX.Y.Z`.
6. Publish release notes from the matching changelog section.
