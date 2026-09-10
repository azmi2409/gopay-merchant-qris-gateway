# Agent Instructions

These instructions apply to all files in this repository.

## Project

- Runtime: Node.js 24 or newer.
- Package manager: pnpm 11.23.0.
- Language: TypeScript with CommonJS output.
- HTTP framework: Express 5.
- Database: `@libsql/client`, supporting local SQLite and remote LibSQL/Turso.
- Tests: Vitest and Supertest.

## Required Workflow

1. Inspect existing code and tests before changing behavior.
2. Prefer the smallest correct change and existing dependencies.
3. Update or add tests for non-trivial behavior.
4. Run `pnpm run build` and `pnpm test` before completion.
5. Run `git diff --check` and inspect the final diff.
6. Update `README.md` for public API, setup, or configuration changes.
7. Update `CHANGELOG.md` under `Unreleased` for user-visible changes.

## Security

- Never read, print, commit, copy, or use values from `.env`, `gopay_session`, `gopay.key`, local databases, or log files unless the user explicitly requests a safe local operation.
- Never add real QRIS payloads, merchant IDs, phone numbers, cookies, tokens, OTPs, API keys, encryption keys, or account data to fixtures, commands, documentation, logs, screenshots, or Git history.
- Use synthetic QRIS fixtures and mocked upstream responses in tests.
- Do not call live private GoBiz / Gojek / GoPay endpoints during automated tests or UI previews.
- Preserve AES-256-GCM encryption for persisted session data.
- Do not return upstream credentials, response bodies, or stack traces to API clients.

## Code Conventions

- Keep routes thin; use existing services and utilities for reusable behavior.
- Validate input at HTTP and external-system boundaries.
- Preserve API compatibility unless a breaking change is explicitly requested and documented.
- Keep SQL valid for both local SQLite and remote LibSQL/Turso.
- Avoid new abstractions, dependencies, and compatibility shims without a concrete need.
- Use ASCII unless an existing file requires other characters.
- Keep comments rare and explain reasons, not obvious operations.

## Tests

- Tests must be deterministic, isolated, and network-independent.
- Use `file::memory:` for database tests.
- Do not depend on an existing local session, key, database, or authenticated merchant account.
- Mock QR image downloads and GoBiz transaction verification.
- Cover success, invalid input, missing resources, expiration, and upstream failure where relevant.

## Git

- Do not modify or revert unrelated working-tree changes.
- Keep commits atomic and deployable.
- Use concise Conventional Commit-style messages.
- Do not commit generated `dist/`, runtime data, credentials, session files, keys, databases, or logs.
- Do not push, force-push, rewrite history, or create releases unless explicitly requested.
