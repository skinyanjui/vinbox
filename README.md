# VINBOX

A minimal, mobile-first vehicle identification app using the US National Highway Traffic Safety Administration (NHTSA) APIs. No account or build step is required. Open the site, scan or enter a VIN, and inspect results.

## What it does

- Scan a VIN barcode with the camera, or select a photo of a VIN barcode
- Type or paste a 17-character VIN, multiple VINs, or a partial VIN with a `*` wildcard
- Batch-decode up to **250 distinct VINs** (50 per NHTSA request)
- Inspect decoded characteristics, optional WMI maker enrichment, model-based recalls, approximate Canadian-market dimensions, and EPA fuel economy estimates
- Save up to **100** vehicles on this device; remove one or clear all with a confirmation and 8-second Undo; export CSV and open full VIN deep links using `#VIN`
- Install as a Progressive Web App (PWA) with an offline app shell

VIN input may contain letters and digits, but not I, O, or Q. Non-US VINs can have different check-digit rules; the app warns rather than automatically rejecting them.

## Run locally

Serve the repository as a static site:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` for the VIN decoder. **EPA lookup requires Vercel routing:** run `npx vercel dev` or use a Vercel deployment, because `/api/epa/*` is a same-origin proxy defined in `vercel.json` (the Python static server does not implement it). For camera access on a mobile device, deploy over HTTPS. The app's NHTSA calls require connectivity; opening the UI offline does not mean decoding works offline.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Small, semantic page shell |
| `styles.css` | Responsive interface, light/dark mode, reduced-motion support |
| `app.js` | VIN decoding, camera scanning, saved vehicles, presentation |
| `epa.js` | EPA API adapter, matching and fuel/energy normalization |
| `extras.js` | Saved-list clear/Undo and EPA vehicle-card panel |
| `sw.js` | Scope-limited offline asset cache, fresh-first navigation |
| `manifest.webmanifest` and icons | Installable PWA metadata and assets |
| `vercel.json` | Static deployment and security headers |
| `tests/core.test.cjs`, `tests/epa.test.cjs` | Dependency-free Node regression tests |
| `.github/workflows/test.yml` | Pull-request and push CI configuration |

## Test

Requires Node.js 22:

```bash
node --test tests/*.test.cjs
```

Manually verify on iOS Safari and Android Chrome: camera permission allow/deny, close while permission dialog is pending, switch tabs during a decode, photo upload, barcode fallback, flashlight behavior, screen reader/keyboard tab controls, offline reopening, and restoring online connectivity.

## Data and privacy

Vehicle lookup requests send the VIN (and optional model year) to `vpic.nhtsa.dot.gov`. The EPA integration sends **only year/make/model and EPA configuration ID, never the VIN**, to `www.fueleconomy.gov` through Vercel's fixed-domain `/api/epa/*` rewrite. When requested, recall information is fetched from `api.nhtsa.gov` using make/model/year. VINs saved in the app are stored **only in this browser's localStorage**. There is no VINBOX account, sync server, or analytics service. Browser clearing, private mode, or device replacement may remove saved entries; use CSV export for backup. Imported files are processed in the browser. Google Fonts and a pinned ZXing scanner fallback are loaded from third-party providers when necessary.

EPA fuel-economy records are matched through the official year/make/model menus. If the EPA offers multiple engine/transmission/drivetrain variants, users choose the correct one; VINBOX never silently guesses a version. A one-option EPA match is still a **model estimate**, not VIN-exact proof. EPA figures cover US-market model years 1984 onward, and annual fuel cost reflects EPA assumptions (15,000 miles and EPA fuel prices). EV data display MPGe and electricity consumption; plug-in hybrids show gasoline MPG and, where available, plug-in MPGe separately. The selected EPA ID is saved locally with a bookmarked vehicle and can be changed. Unavailable EPA data never blocks VIN decoding or recall lookup.

NHTSA recall matches are **by make, model, and year**, not VIN-specific proof of an outstanding repair. Confirm recall status and completed remedies through [NHTSA's recall lookup](https://www.nhtsa.gov/recalls) or a manufacturer/dealer. Some markets, model variants, and trims are underrepresented. Canadian-market dimensions are approximate and may not match a US-specific trim.

## Reliability and security

- NHTSA requests have bounded retries and a per-attempt timeout. Stale user-initiated decodes are cancelled.
- CSV exports guard against spreadsheet formula injection.
- Camera streams are closed on dismissal, tab concealment, and navigation away.
- A deployment Content Security Policy restricts scripts, network access, embedding, and other browser capabilities.
- The service worker only caches known app assets, Google Fonts, and a pinned scanner library; NHTSA and EPA API responses are never cached by the service worker. The EPA adapter uses bounded, short-lived in-memory lookups.
- The app has no user accounts, backend database, or payment processing.

The scanner fallback currently depends on the third-party `@zxing/library@0.21.3` build from unpkg. For stricter software-supply-chain guarantees, self-host an independently audited dependency with integrity verification.

See [AUDIT.md](AUDIT.md) for the hardening audit, verification status, and remaining release checks.

## Release checklist

Run `node --test tests/*.test.cjs`, verify Vercel's `/api/epa/vehicle/menu/make?year=2022` responds with a valid EPA menu, and test single/multiple/no-match EPA configurations, offline and API-failure states, saved deletion and Undo, and a saved selection after reload. Verify real iOS/Android camera scanning independently.

Implementation and rollback notes: [IMPLEMENTATION.md](IMPLEMENTATION.md).
