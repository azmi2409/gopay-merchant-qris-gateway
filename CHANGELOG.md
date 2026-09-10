# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional QRIS `callback_url` with success/expiry auto-redirect and merchant-return button.
- Contribution guidelines and repository instructions for coding agents.
- Encrypted GoBiz session persistence in LibSQL for stateless deployments.
- Responsive QRIS payment page with QR image download.
- Configurable static API key and HS256 JWT authentication modes.
- Separate web admin service built with SvelteKit 2 and Tailwind CSS v4.
- Browser-based GoBiz OTP setup and encrypted runtime gateway settings.
- Dashboard analytics, date-range reports, API reference, recent QRIS records, and persistent activity log viewer.
- First-time guided onboarding with local static QRIS image decoding and manual payload fallback.
- Expandable OpenAPI-style API documentation with authentication, parameters, request bodies, and response examples.
- Admin QRIS generator with payment-page and PNG actions.
- Webhook verification, registration, redacted listing, and removal in gateway setup.
- Manual verification mode allowing gateway operation with static QRIS only and manual "Tandai Lunas" settlement.

### Changed

- Docker image runs as a non-root user with health checks and persistent SQLite storage support.
- GitHub Actions use Node 24-compatible action runtimes and pnpm 11.23.0.
- Repository now uses a pnpm workspace and Docker Compose deploys gateway and admin as isolated processes.
- Admin panel migrated to SvelteKit 2 with `@sveltejs/adapter-node` and Tailwind CSS v4.
- Compose persistence uses a named volume instead of a host bind mount.
- Gateway startup no longer prompts for terminal input; unconfigured deployments are completed in the admin panel.
- Expired QRIS records are retained with `EXPIRED` status for accurate reporting.

### Fixed

- Payment status polling returns a pending response when session verification is temporarily unavailable.
- QRIS payment page fits common desktop, tablet, and mobile viewports without scrolling.
- Admin OTP setup reports validation, rate-limit, timeout, and upstream GoBiz failures with actionable HTTP statuses.
- GoBiz OTP verification reuses the device identity established by the OTP request.
- Webhook registration and listing responses redact stored signing secrets.

## [1.0.0] - 2026-09-10

### Added

- TypeScript and Express REST v1 gateway.
- Dynamic QRIS generation with CRC16 and amount injection.
- GoBiz login, encrypted local session storage, and token refresh.
- Transaction matching and duplicate-claim prevention.
- LibSQL-backed QRIS, transaction claim, and webhook persistence.
- HMAC-signed webhook registration and delivery.
- Docker deployment, automated tests, and CI workflow.
