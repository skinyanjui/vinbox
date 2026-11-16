# VINBOX — saved vehicles and EPA fuel economy (2026-11-16)

## Scope and outcome

Improve the existing mobile-first single-page VIN tool without adding accounts, a database, extra pages, modal dialogs, or a JavaScript build step.

### User journey

1. Scan/type VIN → NHTSA returns decoded vehicle; EPA failure never prevents VIN results.
2. Expand a vehicle → VINBOX begins a **lazy** EPA lookup by year/make/model (no VIN sent to EPA).
3. Find official EPA make and model through the menu endpoints; if the model name differs, offer an inline EPA model picker.
4. If EPA lists a single configuration, load it with a visible US-market estimate disclaimer. If multiple configurations exist, ask users to select engine/transmission/drivetrain; never pick an arbitrary option.
5. Show combined/city/highway MPG (or MPGe for EV), EPA annual cost, and optional EV/PHEV metrics. Display unavailable values as dashes, not zeroes.
6. Save a vehicle → persist the selected EPA ID with the existing localStorage record (no duplicate full EPA data). Existing saved records without EPA ID remain readable.
7. Remove saved vehicle → immediate removal, Undo banner for eight seconds. Clear all → inline confirmation with Cancel/Remove all, then eight-second Undo. Neither operation clears current decoding results.

### API and reliability

Source: [FuelEconomy.gov Web Services](https://www.fueleconomy.gov/feg/ws/index.shtml), data for model years 1984 onward.

- `GET /api/epa/vehicle/menu/make?year=YYYY`
- `GET /api/epa/vehicle/menu/model?year=YYYY&make=...`
- `GET /api/epa/vehicle/menu/options?year=YYYY&make=...&model=...`
- `GET /api/epa/vehicle/{EPA_ID}`

Vercel rewrites these same-origin URLs to the fixed authoritative FuelEconomy.gov origin. The client only permits the specific menu and numeric vehicle endpoints (no arbitrary-proxy URLs), with an explicit JSON Accept header plus safe XML parsing as a fallback. Responses stay in a bounded in-memory cache for 24 hours; the API request queue holds at most three concurrent fetches, with a 12-second timeout and one retry for transient errors. No NHTSA or EPA API response is cached by the service worker.

### Data contract and provenance

NHTSA remains the authoritative decoder for the entered VIN. EPA provides independent **US-market model-configuration** ratings identified by EPA vehicle ID. VINBOX records only that ID in a locally saved vehicle, not an assertion that the exact VIN was certified to that configuration. Multiple versions require a deliberate selection. No EPA values are inferred when fields are absent. The retrieved EPA record is verified against model year and make before display.

EPA cost estimates use the EPA-provided annual fuel cost, not invented local gas prices or real-time forecasts. MPG and MPGe are labelled separately; gasoline and plug-in metrics are not conflated. EV electric range uses the primary-fuel range field; PHEVs use the alternative electric-mode range where available. External links lead to the official public source.

### Privacy, compatibility and failure handling

- VINs are sent only to the existing NHTSA decoder. EPA requests include decoded year/make/model and EPA IDs.
- No account, new database, authentication change, analytics pipeline, ad tracking, or billing.
- Bookmarks remain in the existing `vin-history` storage key. Optional `epaId` provides backward-compatible enrichment; old records continue to load.
- When localStorage rejects a save or deletion, revert in-memory changes and display existing storage warning. Undo restores prior saved records through the same checked save path.
- Failure/empty states include: no model year, unsupported year, no EPA make, model mismatch, no options, ambiguous configuration, API unavailable/timeouts, invalid EPA ID, and offline.
- EPA lookup is lazy per expanded card. When the service is down, VIN decoding, saved lists, and recalls remain operational.
- The service worker version is bumped to install the two new scripts. Existing client cache is replaced through the established upgrade lifecycle.

### Verification and acceptance

- Run `node --test tests/*.test.cjs` before merging/releasing.
- Confirm Vercel rewrite with a real request in the deployment environment; a plain Python static server cannot serve `/api/epa/*`.
- Check 1983 and incomplete NHTSA result (unavailable), 2022 model single/multiple EPA variants, mismatched engine selections, EV, PHEV, invalid/blank readings.
- Confirm first and repeated lookups, rapid tab toggles, offline errors with Retry, and no regression to NHTSA decoding.
- Confirm saved count after removal, clear confirmation/Cancel, Undo after single/all removal, persistence across reload, and storage quota/privacy-mode failure.
- Confirm keyboard focus on inline Clear confirmation, 44px targets, screen reader names, light/dark mode, and 320px mobile layout.
- Physically verify iOS Safari and Android Chrome camera permissions/torch and PWA upgrade before declaring fully production-ready.

### Rollout, monitoring and rollback

Deploy once through a single atomic commit to `main` to avoid repeated Vercel builds. Observe Vercel deployment/response status and GitHub Actions tests. There is no new server data to migrate or backfill. If the EPA proxy fails in production, keep VINBOX functioning with the EPA section's Retry/Search fallback; revert the single change if needed. Existing saved vehicles are never deleted by deployment, only by explicit user actions. Avoid treating an apparently successful deployment as proof that live EPA and real mobile-device integrations work.

**Deferred by design:** personal fuel-price calculators, mileage estimates for a VIN's unique historical configuration, model comparison screens, server-side saved-vehicle sync, and an independent EPA dataset mirror.
