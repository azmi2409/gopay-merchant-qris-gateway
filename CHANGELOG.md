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

### Changed

- Docker image runs as a non-root user with health checks and persistent SQLite storage support.
- GitHub Actions use Node 24-compatible action runtimes and pnpm 11.23.0.

### Fixed

- Payment status polling returns a pending response when session verification is temporarily unavailable.
- QRIS payment page fits common desktop, tablet, and mobile viewports without scrolling.

## [1.0.0] - 2026-09-10

### Added

- TypeScript and Express REST v1 gateway.
- Dynamic QRIS generation with CRC16 and amount injection.
- GoBiz login, encrypted local session storage, and token refresh.
- Transaction matching and duplicate-claim prevention.
- LibSQL-backed QRIS, transaction claim, and webhook persistence.
- HMAC-signed webhook registration and delivery.
- Docker deployment, automated tests, and CI workflow.
