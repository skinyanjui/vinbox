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

---

## Follow-up remediation audit — 2026-11-16

All source changes were staged and checked before creating one atomic commit to main.

| Finding | Fix | Verification |
| --- | --- | --- |
| Saved vehicle 101 silently evicted item 100 | Hard cap with visible error; no existing record deleted | Capacity-boundary test |
| CSV unable to restore complete bookmarks | Versioned JSON backup/restore retaining EPA ID, selected model, and details | Round-trip, duplicate, invalid, and oversize tests |
| Clear/restore risk of user data loss | Inline confirmation, storage rollback and Undo | Clear/Undo/import/rollback tests |
| Undo hidden on Results | Display feedback across both tabs | Saved-controls and integration source checks |
| EPA wrong model and powertrain ambiguity | Verify year, make, model, manually chosen variant, and engine/drive conflict | Model/make/year, cylinder, engine and drive tests |
| CNG/LPG/PHEV/EV mislabeled | Read real XML atvType and distinguish MPGe, MPG and bifuel gasoline | Fuel-unit regression tests |
| API retry storms | Honor limited Retry-After/delay and bounded queue | Adapter review and request tests |
| EPA results overwritten by stale requests | Generation tokens per VIN | UI contract and async guard review |
| Dense batch-card rendering | Build nested details only when card is open | Source regression |
| Focus dropped during async UI change | Restore focused control or EPA section header | Source assertion; real screen-reader check pending |
| PWA cache outdated | Add backup.js and bump service worker version to v8 | Cache/asset-order test |
| CDN script trust too broad | Restrict CSP host-source to pinned scanner path | CSP test |

### Live EPA verification

The production Vercel proxy returned HTTP 200 and official XML for the 2022 Honda make list, Honda model list, Civic 4Dr options, and vehicle record 31873. Civic 2022 options returned no matches for a bare model name; the EPA lists Civic 4Dr and Civic 5Dr variants. Users must select the correct model and configuration. These are US-market EPA ratings, not VIN-certified assertions.

### Release verification and remaining limitations

Pre-release verification: 40 of 40 regression tests passed in the JavaScript test harness. Production requires successful GitHub Actions and Vercel deployment statuses. Hardware camera, flashlight, VoiceOver/TalkBack, cross-device PWA, actual browser file-picker and anonymous-site checks remain manual.

The fallback scanner remains an exact-version ZXing CDN dependency without a verified SRI hash or audited self-hosted asset. CSP is narrowed to the pinned file, but this is only a partial mitigation. No production browser error reporting was added. A Vercel function log query cannot establish that browser JavaScript runs without errors.

### Rollback and compatibility

No backend migrations. Existing local saved records remain valid. The additive epaModel field and versioned JSON backup are backward-compatible. If deployment fails, revert the single repair commit, preserving browser-local data; an imported backup can also restore saved vehicles when needed.

---
## VIN-first EPA auto-match follow-up — 2026-11-16

**User outcome:** VINBOX should show EPA fuel economy without requiring a dropdown whenever the NHTSA-decoded data uniquely determines the EPA configuration. VINBOX may not imply exactness where the VIN lacks rating-relevant detail.

### Data contract and decision flow

1. Decode VIN using NHTSA as before. EPA receives only decoded year/make/model and EPA IDs, never the VIN.
2. Find official EPA make and candidate model labels. Account for common hyphenated model names (e.g. F-150 vs F150), body styles (Civic 4Dr vs 5Dr), AWD/FWD and explicit trim qualifiers.
3. Filter EPA options using available displacement, cylinders, automatic/manual transmission and turbo flags. Make no assumptions for absent values.
4. Fetch at most 16 plausible official EPA vehicle records, with 3-request concurrency, and evaluate powertrain/body/model evidence. Require **one** compatible option with supporting discriminators and complete candidate coverage before automatic selection.
5. Cross-check selected record's year/make/model before rendering. Persist the exact EPA record ID and model label with the saved vehicle and JSON backup.
6. If any candidate could also match, a candidate call fails, the VIN decode is partial, or a vehicle family exceeds the safe fetch cap, show the narrow manual model/configuration choice instead. The Change configuration action always allows correction.

### Proof and test scenarios

- Confirmed official 2022 Civic 4Dr offers both 2.0-liter Automatic (AV-S7) and Automatic (variable gear ratios), with **different** MPG. VINBOX does not pick one if its decoded transmission does not distinguish them.
- Confirmed official 2022 Honda Insight Touring menu has a single 1.5-liter configuration. Tests demonstrate automatic selection from VIN's Touring trim plus other engine/transmission fields.
- Tested sedan vs hatchback, manual vs automatic, 2WD vs 4WD, known trim qualifier, manufacturer/year mismatch, diesel/gasoline mismatch, incomplete VIN, incomplete EPA responses, huge model lists, and persisted EPA association.
- Existing 40 regression tests remain in CI, with a new matching suite for automatic success, ambiguity and UI behavior.

### Risk boundaries and remaining verification

The original EPA service defines ratings by **vehicle configuration**, not VIN. Some VINs do not encode transmission subtypes, exact final-drive, fuel grade, or equipment. Therefore automatic matches are only claimed when the decoded attributes uniquely support the retrieved EPA record; others still require human confirmation. Vercel's /api/epa proxy, service-worker v9, mobile Safari/Chrome camera and keyboard/screen-reader flows must be checked after deployment. No schema or backend migration was necessary, and rollback is one commit.

---

## Shared VIN/EPA compatibility remediation — November 16, 2026

### Root causes corrected

- The EPA matching engine formerly compared manual versus automatic but ignored `TransmissionSpeeds`. It now parses published EPA gear-count codes such as `Automatic (S10)` and rejects a six-speed VIN against a ten-speed EPA configuration both before and after fetching the EPA record.
- Fuel matching previously handled only diesel-versus-gasoline and electric VIN mismatches. It now compares authoritative primary-fuel classes (gasoline, diesel, CNG, LPG, electricity and hydrogen), preserves mixed-fuel uncertainty, and distinguishes HEV/PHEV/EV status using FuelEconomy.gov's actual `atvType` value.
- Known NHTSA turbocharger states are now compared with EPA `tCharger` and explicit natural-aspiration or turbo descriptions. Missing affirmative turbo or hybrid evidence prevents an automatic claim; manually selectable configurations remain available when there is no contradiction.
- A saved EPA model label or user's manual selection could previously bypass NHTSA model or engine consistency checks. All three selection paths (automatic, manual and saved) now call the **same** assessment before metrics are displayed or an EPA ID is persisted. Incompatible records show a clear recovery choice instead of MPG.
- Trim matching no longer uses substring checks that treated `Executive` as `EX`. Duplicate EPA IDs are deduplicated in the resolver and unique-match logic. Published EPA model labels come from the retrieved EPA record.
- The old shortcut that automatically selected one option returned by the fallback menu has been removed. Automatic selection remains available via the full VIN-evidence and candidate-coverage check; manual model selection still automatically opens its sole valid EPA record after compatibility validation.

### Validation and limits

- Pre-release suite: **99 test cases** across the previously established 40 core/EPA/repair cases, 15 VIN-to-EPA matching cases, and 44 additional adversarial matching and UI cases.
- Checked correct/incorrect gasoline, diesel, CNG, LPG, HEV, PHEV and BEV relationships; explicit 6/10-speed differences, drivetrain, displacement, cylinder count, turbo metadata, trim token boundaries, duplicate IDs, existing saved records, and manual model/option errors.
- Verified official EPA XML uses `tCharger=T` for turbocharged configurations and `atvType=Hybrid` for a real 2022 Insight. This is used as source evidence, not a claim that every VIN can be mapped uniquely.
- AWD versus 4WD remains a conservative choice when the VIN and EPA descriptions disagree; it is not silently coerced into a match.
- No server/database migrations, account changes or VIN sharing with EPA. The release is designed for a single consolidated Git commit and Vercel build.
- **Residual acceptance:** production smoke-check the new files and /api/epa, run actual browser VIN-to-EPA interactions, and verify on iOS/Android, assistive technologies and camera hardware. Avoid claiming these tests passed without executing them.

### Rollback

If the release fails, revert this single repair commit. Vehicle data remains in the existing device-local storage and the already supported JSON backup. No destructive data migration is involved.
