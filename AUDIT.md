# VINBOX engineering audit — 2026-11-16

**Scope:** `main` at the start of the audit versus the proposed `improve/reliability-security-ux-20261116` branch.

## Remediated findings

| Priority | Finding | Correction |
| --- | --- | --- |
| High | Repeated or overlapping decodes could show out-of-date results | Abort previous decode, reject stale completion, restore correct button/loading state |
| High | Exported NHTSA fields could be interpreted as spreadsheet formulas | Prefix dangerous leading values before RFC-style CSV quoting |
| High | Incomplete batch responses could silently omit VINs | Enforce expected response size and show retryable error |
| High | Service worker could cache unintended paths and delete unrelated origin caches | Restrict shell and CDN caching; remove only `vinbox-*` caches; network-first navigation |
| High | Inline application JS weakened deployment CSP options | Split app shell into external JS/CSS; disallow inline scripts with CSP |
| Medium | Camera could activate after the scanner was dismissed during a permission prompt | Session-token cancellation and immediate track release |
| Medium | Camera could remain active in the background | Stop camera on document hide/pagehide; stop on dismiss |
| Medium | Native and fallback camera decoders could overwork the device | Throttle native detector, avoid redundant image canvas resizes, stop native loop after ZXing activation |
| Medium | Scanner focus and keyboard behavior were inconsistent | Dialog focus management, focus return, Escape, Tab containment, status announcements |
| Medium | Local saved data had little integrity checking and storage failures were silent | Validate stored entries, bound saved list to 100, show storage failure and roll back unsaved state |
| Medium | API calls could wait indefinitely and have weak transient failure handling | 20-second per-attempt timeout, bounded retries, backoff and user-visible timeout failure |
| Medium | Optional enrichment delayed the primary decode result and could issue many lookups | Render decoded results immediately; cap optional WMI queries per batch |
| Medium | Recalls were fetched before a user requested them | Fetch only when the recalls section is expanded; distinguish no matches from unavailable |
| Low | Clipboard-API absence could throw when copying | Guard clipboard access with a recoverable message |
| Low | Export object URLs and native photo bitmaps could leak resources | Revoke file URLs and close bitmaps |
| Low | Touch and keyboard accessibility had gaps | Keyboard-operable tablist, ARIA relationships, skip link, improved touch targets, reduced-motion CSS |
| Low | Mobile photo button could force a new camera capture | Allow choosing an existing photo |

## Verification performed

- **9/9 direct JavaScript core smoke checks passed:** normalization, checksum, partial year, scanned prefix, batch bound, CSV formula defense, mocked single decode, incomplete batch detection, and transient retry recovery.
- Application JS compiled successfully with a JavaScript parser after substantive edits.
- Regression suite committed to `tests/core.test.cjs` covering deterministic core paths, API failure handling, cancellation, and deployment configuration.
- CI workflow committed to `.github/workflows/test.yml` for Node 22.

**Not yet verified:** a GitHub Actions test run, full end-to-end tests with real NHTSA responses in a browser, security-header behavior after Vercel deployment, physical camera permission/torch testing, or screen-reader testing on actual mobile devices. Passing code-level checks is not equivalent to a production release.

## Remaining risks / release gates

1. **External scanner dependency:** ZXing is pinned to a version but still loaded from unpkg without Subresource Integrity. Self-host and independently verify the dependency before a high-assurance production rollout.
2. **Data scope:** NHTSA vPIC is incomplete for non-US vehicles; model-based recalls cannot identify VIN-specific repair completion. Make this limitation visible wherever recalls are used operationally.
3. **Device data:** Saved vehicles live in unencrypted browser localStorage. This avoids a backend but offers neither syncing nor a recoverable cloud backup; CSV export is the only backup route.
4. **Real-device smoke test:** Test camera open/cancel/reopen, permission denied, Torch unsupported, native/ZXing fallback, photo uploads, visible/invisible tabs, and foreground/background transitions on iOS Safari and Android Chrome.
5. **Network smoke test:** Confirm NHTSA CORS, CSP `connect-src` and `script-src`, 400/429/503 errors, offline reopening, and recovery after reconnecting.
6. **Accessibility acceptance:** Confirm tab order, focus trapping/return, screen reader names, light/dark contrast and VoiceOver/TalkBack output.
7. **Deploy safety:** Confirm Vercel preview success and deployed security headers, verify PWA service worker updates from the prior cache version, then promote or merge. Rollback by reverting the branch/PR changes; expect clients with an installed PWA to refresh on a subsequent page load.

## Architecture decision

Retain a dependency-light static application because there is no account, billing, or authoritative VINBOX database. Use `index.html` for semantic markup, `styles.css` for presentation, `app.js` for the client/domain code, and `sw.js` for narrowly scoped offline behavior. Add backend services only if shared saved lists, server-side integration keys, team accounts, or an authoritative marketplace data model become actual product requirements.
