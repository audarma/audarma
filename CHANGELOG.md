# Changelog

All notable changes to Audarma will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **CRITICAL**: Fixed locale caching bug in `ViewTranslationProvider` where switching languages would display cached translations from the previous language instead of translating to the new locale. The component now reactively detects locale changes and clears stale cache. (See DEMO_LEARNINGS.md #10)

## [0.1.0-alpha.0] - 2025-11-13

### Added

- Initial alpha release
- Core translation system with view-level tracking
- Smart caching with content hash tracking
- Progressive loading (shows original text, translates in background)
- Adapter pattern for database, LLM provider, and i18n library
- Batch translation support
- React hooks: `useViewTranslation`
- React components: `AudarProvider`, `ViewTranslationProvider`
- TypeScript definitions for all public APIs
- Example adapters:
  - Supabase database adapter
  - Nebius LLM provider (OpenAI-compatible)
  - next-intl i18n adapter
- Documentation:
  - README with quick start guide
  - Dual-mode translation guide (lazy + CLI)
  - Installation guide for AI coding agents
  - Contributing guide
- Database schema for PostgreSQL

### Known Limitations

- Hard-coded English as source language
- No cache invalidation API
- No error boundaries
- No retry logic
- No cost tracking
- Client-side only (no server component support)
- No streaming translations
- No partial cache updates

[unreleased]: https://github.com/audarma/audarma/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/audarma/audarma/releases/tag/v0.1.0-alpha.0
