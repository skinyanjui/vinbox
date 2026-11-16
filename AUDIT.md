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

---

## Deep VIN / EPA backend and calculations audit — 2026-11-16

### Root-cause trace

NHTSA vPIC VIN decode → `parseResult` typed vehicle → `VinEpaMatch.candidates` → EPA menu model/options → bounded EPA record fetches → `assessment/uniqueMatch` → `estimateFromCandidates` → card presentation → optional device-local save.

The app previously rejected auto-selection whenever two EPA IDs matched and fell back to a mandatory dropdown, even if both EPA configurations had the **same MPG**. It likewise forced a selection for nearby but distinct ratings despite the possibility of showing a truthful range. EPA returned variant metadata that may differ on start-stop equipment, transmission subtypes or final-drive details not represented in a VIN decode. No direct EPA VIN→ID lookup exists, so claiming an arbitrary single ID would be wrong.

**Implemented:**
- Added EPA shared-rating and observed min/max summaries only when all plausible, checked and compatible EPA records have positive city, highway and combined ratings, compatible fuel units and no unconfirmed essential equipment.
- No arithmetic averaging of MPG, MPGe or annual cost. Min/max values are taken directly from each record; missing cost or energy figures are omitted. One unique record retains exact-record semantics; multiple records do not persist an invented EPA ID.
- Verified example data: EPA's 2022 Toyota RAV4 2.5L FWD records `44991` and `44992` both publish 27 city / 35 highway / 30 combined MPG and $2,000 annual fuel cost, differing by stop-start equipment. Ford F150 Pickup 4WD 2.7L records `44871` and `44877` publish 21 and 20 combined MPG and $2,850 and $3,000 annual cost respectively. Honda Civic 4Dr 2.0L EPA IDs `44133` and `44134` report different ratings (35 versus 33 combined MPG); VINBOX reports the verified range without asserting the wrong transmission version.
- Added CVT/AV-S distinctions from stepped automatics (S8/S10), supplementing manual/automatic and number-of-speeds checking; empty/unknown fields never become affirmative evidence.
- The fuel-economy subsection expands when ready or when confirmation is genuinely necessary, reducing clicks.
- Added a stable normalized per-VIN evidence fingerprint to invalidate cached UI results when a VIN is re-decoded with different authoritative engine, model or fuel attributes; epoch checks protect against obsolete asynchronous completions.
- Retained no-VIN-to-EPA data sharing, fixed-host Vercel rewrite, bounded request queue (3 active), 12-second timeout, one retry, 24-hour in-memory response cache, and existing local saved-list backup/restore safeguards.
- Preserved one decimal of EPA kWh/100-mile consumption rather than rounding all electricity use to a whole number. Published EPA MPG and annual costs are displayed, not calculated from one another.
- Updated static PWA service-worker assets to `vinbox-v11`, avoiding inconsistent cached JavaScript after deployment.

### Acceptance matrix

Tests include previous VIN decode, retries, parsing, security, saved-list, fuel, engine, transmission, make/model, EV/PHEV/HEV, API errors, ambiguous and unique matching; plus **17 new tests** for real EPA RAV4, F150 and Civic-related matching outcomes, network endpoint order, missing EPA ratings, incomplete VIN, fuel conflict, cost bounds, electricity precision, UI without dropdown and stale-NHTSA-evidence invalidation. **116/116 isolated pre-release regression tests passed**. GitHub Actions/production verification must still confirm after commit.

### Residual boundaries and rollback

The product has no server database or independent official EPA dataset mirror; no schema migration, account synchronization, or analytics backend was added. Potentially large EPA model families (>4 plausible models or >16 options), incomplete EPA responses, models with unknown hybrid/turbo configuration, or vehicles where rated variants differ for facts that cannot be checked may still require user selection. Because output is EPA configuration-level estimates, displayed ranges are not claimed as VIN-specific certification.

True mobile camera capture, assistive technology navigation, anonymous production access and real browser service-worker cache upgrades cannot be certified by the mocked unit suite alone. Keep a single release commit and revert it for rollback; local saved vehicles remain compatible. Existing files and privacy behavior are unchanged except for the transient in-memory estimate view.

---

## EPA model mismatch automatic-recovery audit — 2026-11-16

**Observed user-facing defect:** `EPA model does not correspond to decoded VIN model. Choose another configuration.`

### Confirmed root causes

1. On the saved-vehicle path, `selectEpa` used the older, device-stored `epaModel` value as the expected official EPA model. A stale local label could reject an otherwise valid EPA record.
2. An invalid saved EPA ID, a stale EPA ID returning 404, or an incompatible user-picked configuration ended in an error state. The flow did not invoke the VIN-first resolver to find a corrected association.
3. The retry button used `loadEpa(it,true)`, calling manual EPA model discovery, even when automatic matching could have resolved the VIN.

### Remediation, end to end

- Validate against the **actual model label from the retrieved official EPA record**, always cross-checking it and the other known attributes against the decoded VIN. User-supplied or persisted model text cannot authorize an incompatible vehicle record.
- On saved ID mismatch or 404, remove only the invalid `epaId` and `epaModel`, with device-storage write checks and rollback; keep the saved VIN, decoded facts, and groups untouched. Automatically rerun `EPA.resolve` without checking the outdated saved ID again.
- On an incompatible manual selection, automatically rerun `EPA.resolve` using the decoded VIN, instead of displaying the mismatch error. Preserve manual choice only when the returned official data remain ambiguous.
- An incompatible result from the **automatic** resolver does not recursively retry; it fails closed without displaying wrong MPG. Temporary API failures preserve the saved association for retry.
- Replace the misleading **Choose another / retry** action with **Retry VIN match**, which runs VIN-first matching. Bump installed PWA shell cache to v12.

### Regression verification

Added 12 new `tests/auto-recovery.test.cjs` cases: stale saved ID, outdated stored label, wrong stored engine, retired EPA ID (404), transient API failure (503), true ambiguity, bad auto-selected ID, no saved ID, bad manual choice with auto success, bad manual choice with genuine ambiguity, preservation of saved VIN/group facts, and automatic retry button behavior. All prior 116 cases remain in the full suite. Production deployment requires GitHub Actions and Vercel checks; physical device, real user VIN and screen-reader acceptance remain manual.

**Safety boundary:** VIN→EPA is a best-supported configuration match, not an EPA-provided VIN-to-vehicle-ID lookup. Where NHTSA cannot distinguish EPA configurations, the app must retain a user choice or show a verified range; it cannot invent a VIN-specific EPA ID.

---

## 2016 Mercedes GLC300 4MATIC VIN family-model matching — 2026-11-16

**User symptom:** `VINBOX /#WDC0G4KB8GF018636` displayed `2016 Mercedes-Benz GLC-Class GLC300 Base-4M` but the fuel-economy card still said `EPA uses a different model designation. Choose the equivalent model.`

**Root cause:** The NHTSA model field is a family name, `GLC-Class`. The code's `modelQualifier` only matched an EPA model whose first token matched NHTSA `Model`, and ignored the exact `GLC300` identifier and `4M` drivetrain marker already available in NHTSA `Trim`. Both EPA options were consequently discarded and the manual `choose-model` state was shown.

**Authoritative verification:** The NHTSA 2016 Mercedes-Benz manufacturer VIN attributes map the `WDC` / `0G4K` model pattern to GLC300-4M (as distinct from `0G4J`, GLC300). FuelEconomy.gov's 2016 Mercedes-Benz model menu lists `GLC300` and `GLC300 4matic`; official EPA records 37159 and 37160 differ by drivetrain. Record 37160 lists 2.0L four-cylinder, automatic 9-speed, 4-Wheel Drive, premium gasoline, 21 city / 28 highway / 24 combined MPG. No VIN was transmitted to EPA.

**Solution:** Derive the *exact* model badge from an explicitly manufacturer-decoded trim for NHTSA `Class`/`Series` family labels, requiring a precise EPA badge match and guarding against nearby badges. Recognize `4M` and `4MATIC` drivetrain tokens, exclude non-4matic EPA names for a 4M trim, and allow NHTSA AWD versus EPA 4-Wheel Drive only when the EPA model is explicitly branded `4matic`. Other AWD versus 4WD mismatches remain incompatible. Existing engine, cylinders, fuel, transmission, year, and make validation remains authoritative.

**Validation:** 11 focused regression tests cover the exact supplied VIN, ordinary GLC300, missing DriveType with 4M trim, AWD wording, GLC350 nonmatches, C-Class and 3 Series, negative conflict checks, complete year/make/model/options/record lookup, EPA calculations, and UI rendering without a selector. All 128 prior regression tests plus 11 new tests passed in isolated pre-commit suites (**139/139**). Production CI and deployment verification remain release gates. Bumped service worker to v13 so existing installed PWAs receive the fix.

**Boundaries:** If no exact model badge is in VIN trim, VINBOX will not invent a badge from a vague family name. It may still show a verified EPA range or request configuration information where source evidence cannot disambiguate. Hardware browser and mobile tests remain manual.

---

## Performance audit — 2026-11-16

### Execution-path inspection

- **Startup:** 5 deferred first-party scripts, CSS and Google-hosted fonts. Installed PWA shell cached via versioned service worker; no app-server database or server-side rendering. Scripts are small compared with large app frameworks, but there is no full in-browser performance trace or field Core Web Vitals attached to this audit.
- **Single VIN decode:** one NHTSA vPIC request, up to four bounded attempts on transient error, 20-second per-attempt timeout. It was already loaded independently of optional WMI enrichment; no unsafe result caching was added.
- **EPA:** Before this change a cold matching lookup sequentially requested make menu → model menu → model options → vehicle record, even when NHTSA already identified the make. Menu data was only cached in memory and lost on page reload. EPA completion re-rendered the whole vehicle list (up to 250 entries).
- **Batch decoding:** NHTSA batches up to 50 per HTTP POST, but up to five chunks were awaited serially.
- **Other downstreams:** Recalls/specs remain opt-in. Camera/ZXing loads only after a scanner action; no eager scanner library download introduced.

### Optimizations made

1. **Direct official model menu:** try EPA year + decoded make first. Only if no models exist, use the official make list to resolve aliases and retry. Preserves failures, verified source labels and full VIN/EPA compatibility. A cold VIN with recognized make now follows **3 dependent EPA requests instead of 4**, verified by mocked request-count regression. 
2. **Session EPA menu cache:** 24-hour TTL, 80-key FIFO cap, 25 KB response limit, public make/model/options responses only. Cache entries are never a VIN and are scoped to the browser tab. Independent API mocks are not stored in real-browser cache; storage errors fail open to the network. No EPA vehicle ID is inferred from cached menu data.
3. **Targeted EPA redraw:** asynchronous loading/completion updates only the rendered EPA component and badge; list DOM is preserved. If Results/Saved changes before a response completes, repaint only the currently visible VIN card. Keyboard focus moves to the EPA summary when the selected control disappears.
4. **Bounded NHTSA concurrency:** when decoding 51–250 VINs, process up to two groups of 50 concurrently. Preserve output order, original abort signal, per-request retry/timeout and strict partial-response validation. Small batches are not penalized by new scheduling.
5. **Service-worker version:** v14, ensuring installed PWAs fetch the updated modules together.

### Verification method and limitations

The staged suite includes the earlier 139 regression tests plus nine new performance tests. The new tests specifically check cold request count, deliberate manufacturer fallback, HTTP error handling, same-tab menu caching across module reload, storage denied/quota fallback, batch 2-request cap and ordering, targeted async card refresh, and the production hook. Test assertions are deterministic and do not invent speed metrics. CI completion, Vercel READY, and live production smoke checks are required after the one atomic main-branch commit.

**No measured first-contentful-paint, LCP, INP, actual EPA p95 latency, network download timing or real iOS camera power draw** is claimed. Instrument these under controlled 4G/slow-device and offline PWA conditions before setting SLOs. Future options include progressive batch result streaming and reducing blocking font requests, but they were deliberately left unchanged pending measurements. Existing local saved data, privacy, permissions, vehicle validation, and financial EPA calculations remain backward compatible.
