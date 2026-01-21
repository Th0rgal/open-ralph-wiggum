# Commit Examples by Type

Extended examples for each commit type with body content.

## feat - New Features

```
feat(validation): add URLValidator with domain whitelist

Implement URLValidator class supporting:
- Domain whitelist enforcement (youtube.com, youtu.be, m.youtube.com)
- Dangerous scheme blocking (javascript, data, file)
- URL parsing with embedded credentials handling
- Port number validation (1-65535)

Addresses Requirement 31: Input validation
Part of Task 5.1: Input Validation Utilities
```

```
feat(api): add video metadata endpoint

New GET /api/v1/videos/{id}/metadata endpoint:
- Returns title, duration, formats, thumbnails
- Supports format filtering via query params
- Implements caching with 5-minute TTL

Part of Task 6.2: API Endpoints
```

## fix - Bug Fixes

```
fix(auth): use hmac.compare_digest for secure key comparison

Replace direct string equality with hmac.compare_digest to prevent
timing attacks on API key validation. Ensures constant-time comparison
regardless of key length or content.

Addresses security best practice for sensitive data comparison
```

```
fix(download): handle network timeout during video fetch

Add retry logic with exponential backoff for network failures:
- Max 3 attempts with delays [2, 4, 8] seconds
- Classify retriable errors (5xx, timeout, connection)
- Log each retry attempt with remaining count

Fixes issue where downloads would fail silently on flaky connections
```

## refactor - Code Improvements

```
refactor(template): consolidate filename sanitization logic

Extract common sanitization patterns into helper methods:
- Path traversal prevention (.., /, absolute paths)
- Special character removal (control chars, null bytes)
- Windows reserved name handling (CON, PRN, LPT1-9, etc)

Improves code maintainability and reduces duplication
```

```
refactor(providers): extract common yt-dlp options builder

Move duplicated option building from get_info/download to
_build_base_options helper. Reduces code duplication and ensures
consistent option handling across all provider methods.

No behavior change, pure refactoring
```

## test - Test Changes

```
test(security): add 102 path traversal prevention tests

Comprehensive test coverage for TemplateProcessor including:
- Basic path traversal attempts (.., /)
- URL-encoded variants (%2e%2e, %2f)
- Unicode/UTF-8 bypass attempts
- Windows edge cases (backslashes, drive letters)

Part of Task 5.4: Security Test Suite
```

```
test(validation): add parametrized URL validation tests

Add 25 test cases covering:
- Valid YouTube URL formats (watch, shorts, embed, youtu.be)
- Invalid domains (vimeo, dailymotion)
- Malformed URLs (no scheme, wrong port)
- Edge cases (trailing slashes, query params)

Coverage for URLValidator: 98%
```

## perf - Performance

```
perf(cache): implement LRU eviction for metadata cache

Replace dict-based cache with LRU implementation:
- Max 1000 entries with automatic eviction
- 40% memory reduction under high load
- Sub-millisecond lookup times maintained

Addresses memory growth issue in long-running instances
```

## security - Security Fixes

```
security(cookie): validate cookie file integrity before use

Add SHA256 checksum verification for cookie files:
- Compute hash on first load, store in memory
- Verify hash before each use
- Reject modified files with clear error message

Prevents use of tampered cookie files
Addresses Requirement 33: Security validation
```

## ci - CI/CD Changes

```
ci(github): add security scanning to PR workflow

Enable Bandit security scanner in GitHub Actions:
- Run on all Python files
- Fail on HIGH/CRITICAL findings
- Cache virtualenv for faster runs

Part of Task 15.3: Basic security validation
```

## docs - Documentation

```
docs(api): add OpenAPI description for download endpoint

Document /api/v1/download endpoint:
- Request body schema with format options
- Response codes (200, 400, 401, 404, 500)
- Example requests and responses

Improves API documentation for consumers
```

## chore - Maintenance

```
chore(deps): update yt-dlp to 2024.12.06

Update yt-dlp from 2024.11.15 to 2024.12.06:
- Fixes YouTube throttling detection
- Adds support for new Instagram format
- Improves error messages for geo-blocked content

No breaking changes expected
```

## style - Formatting

```
style(providers): apply black formatting to youtube.py

Apply black formatter with 88 char line length.
No functional changes, formatting only.
```

## Merge Commit Examples

### Feature Branch to Develop

```
Merge pull request #5 from fvadicamo/feature/input-validation-security

feat(security): implement input validation and security (Task 5)

Merges comprehensive security implementation (Task 5) into develop:
- Input validation utilities (URLValidator, FormatValidator, ParameterValidator)
- Secure template processor with path traversal prevention
- API key authentication middleware with multi-key support
- 473 tests with 93% coverage

Task 5.1: Input Validation Utilities
- URLValidator: Domain whitelist (youtube.com, youtu.be), dangerous scheme blocking
- FormatValidator: yt-dlp format ID validation with regex and selectors
- ParameterValidator: Audio quality/format and language code validation

Task 5.2: Template Processor
- Path traversal prevention (.., /, absolute paths, URL encoding)
- Filename sanitization (illegal chars, control chars, null bytes)
- Windows reserved names handling (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
- Collision handling with numeric suffix, max length 200 chars

Task 5.3: API Key Authentication
- APIKeyAuth class with multi-key support
- Excluded paths for health/doc endpoints
- Secure hashing for logging (SHA256 first 8 chars)
- FastAPI dependency injection integration

Task 5.4: Security Tests
- 102 path traversal prevention tests with edge cases
- URL validation tests with malicious inputs
- API key authentication and credential tests
- Sensitive data redaction verification

Requirements Covered:
- Req 7: Output template processing with security
- Req 9: API key authentication
- Req 31: Input validation
- Req 33: Security (secure comparison, log redaction)

Test Coverage:
- All 473 tests passing
- Coverage: 93% (exceeds 80% minimum)
- Pre-commit checks: all passing
```

### Develop to Main (Release)

```
Merge pull request #10 from fvadicamo/develop

release: v0.1.0 - MVP with YouTube provider

First stable release with core functionality:
- YouTube video info, formats, download, audio extraction
- Cookie-based authentication for age-restricted content
- API key authentication
- Input validation and security hardening
- 500+ tests with 92% coverage

Breaking Changes: None (initial release)

Features:
- GET /api/v1/info - Video metadata
- GET /api/v1/formats - Available formats
- POST /api/v1/download - Video/audio download
- Cookie file support for authenticated requests

Documentation:
- API documentation at /docs (Swagger UI)
- OpenAPI spec at /openapi.json
```

## Commits with Trailers

### Single Issue
```
fix(validation): prevent XSS in user input

Escape HTML entities before rendering.

Fixes #78
```

### Multiple Issues + Co-author
```
fix(auth): resolve session and token issues

- Fix session expiry not triggering logout
- Fix token refresh race condition

Fixes #101
Fixes #103
Co-authored-by: Bob <bob@example.com>
```

## Breaking Changes

### With ! Notation
```
feat(api)!: migrate to v2 endpoints

BREAKING CHANGE: /api/v1/* endpoints removed. Update base URL to /api/v2/.
```

### Config Breaking Change
```
chore(config)!: rename environment variables

BREAKING CHANGE: DATABASE_URL -> APP_DATABASE_URL, API_KEY -> APP_API_KEY
```
