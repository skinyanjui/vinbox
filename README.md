# VINBOX

A minimal, mobile-first vehicle identification app using the US National Highway Traffic Safety Administration (NHTSA) APIs. No account or build step is required. Open the site, scan or enter a VIN, and inspect results.

## What it does

- Scan a VIN barcode with the camera, or select a photo of a VIN barcode
- Type or paste a 17-character VIN, multiple VINs, or a partial VIN with a `*` wildcard
- Batch-decode up to **250 distinct VINs** (50 per NHTSA request)
- Inspect decoded characteristics, optional WMI maker enrichment, model-based recalls, approximate Canadian-market dimensions, and EPA fuel economy estimates
- Save up to **100** vehicles on this device without silently evicting older entries. Remove one or clear all with Undo, export/restore a validated JSON backup, export CSV, and open VIN links using `#VIN`
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
| `epa.js` | EPA API adapter, bounded lookup and fuel/energy normalization |
| `epa-match.js` | Conservative, deterministic VIN-to-EPA model and configuration matcher |
| `extras.js` | Saved-list clear/Undo/restore controls and EPA vehicle-card panel |
| `backup.js` | Portable JSON backup format, validation and saved-list capacity rules |
| `sw.js` | Scope-limited offline asset cache, fresh-first navigation |
| `manifest.webmanifest` and icons | Installable PWA metadata and assets |
| `vercel.json` | Static deployment and security headers |
| `tests/*.test.cjs` | Node regression suites for VIN decoding, saved data, EPA matching, and adversarial compatibility |
| `.github/workflows/test.yml` | Pull-request and push CI configuration |

## Test

Requires Node.js 22:

```bash
node --test tests/*.test.cjs
```

Manually verify on iOS Safari and Android Chrome: camera permission allow/deny, close while permission dialog is pending, switch tabs during a decode, photo upload, barcode fallback, flashlight behavior, screen reader/keyboard tab controls, offline reopening, and restoring online connectivity.

## Data and privacy

Vehicle lookup requests send the VIN (and optional model year) to `vpic.nhtsa.dot.gov`. The EPA integration sends **only year/make/model and EPA configuration ID, never the VIN**, to `www.fueleconomy.gov` through Vercel's fixed-domain `/api/epa/*` rewrite. When requested, recall information is fetched from `api.nhtsa.gov` using make/model/year. VINs saved in the app are stored **only in this browser's localStorage**. There is no VINBOX account, sync server, or analytics service. Browser clearing, private mode, or device replacement may remove saved entries. Use **Backup** to download a JSON file and **Restore backup** to replace the saved list after an explicit confirmation. CSV is for tabular export and does not restore saved detail records. Imported files are processed in the browser. Google Fonts and a pinned ZXing scanner fallback are loaded from third-party providers when necessary.

EPA fuel-economy records are automatically linked to NHTSA decoding when the VIN provides enough evidence to identify **one unique EPA configuration**. VINBOX checks the EPA's model designations, year, make, body style, known trim, displacement, cylinders, fuel/electrification, drivetrain and transmission. It reads the official year/make/model/options menus and validates candidate EPA records rather than selecting the first result. When distinct EPA configurations remain plausible, VINBOX presents a short choice instead of guessing. EPA year, make and model must match the decoded vehicle or a model explicitly chosen through the official EPA menu. A detected powertrain conflict prompts user confirmation. A one-option EPA match is still a **model estimate**, not VIN-exact proof. EPA figures cover US-market model years 1984 onward, and annual fuel cost reflects EPA assumptions (15,000 miles and EPA fuel prices). EV and CNG/LPG data display gasoline-equivalent MPGe where appropriate; plug-in hybrids show gasoline MPG and, where available, plug-in MPGe separately. EPA XML's actual `atvType` field is supported. The selected EPA ID and exact EPA model label are saved locally with a bookmarked vehicle and can be changed. The key NHTSA engine/fuel/drive/transmission/body/trim fields also persist in saved vehicles and portable JSON backups. VINs are never sent to FuelEconomy.gov. Unavailable EPA data never blocks VIN decoding or recall lookup.

NHTSA recall matches are **by make, model, and year**, not VIN-specific proof of an outstanding repair. Confirm recall status and completed remedies through [NHTSA's recall lookup](https://www.nhtsa.gov/recalls) or a manufacturer/dealer. Some markets, model variants, and trims are underrepresented. Canadian-market dimensions are approximate and may not match a US-specific trim.

## Reliability and security

- NHTSA requests have bounded retries and a per-attempt timeout. Stale user-initiated decodes are cancelled.
- CSV exports guard against spreadsheet formula injection.
- Camera streams are closed on dismissal, tab concealment, and navigation away.
- A deployment Content Security Policy restricts scripts, network access, embedding, and other browser capabilities, including limiting the scanner CDN allowlist to the exact pinned file path.
- The service worker only caches known app assets, Google Fonts, and a pinned scanner library; NHTSA and EPA API responses are never cached by the service worker. The EPA adapter uses bounded, short-lived in-memory lookups.
- The app has no user accounts, backend database, or payment processing.

The scanner fallback currently depends on the third-party `@zxing/library@0.21.3` build from unpkg. For stricter software-supply-chain guarantees, self-host an independently audited dependency with integrity verification.

See [AUDIT.md](AUDIT.md) for the hardening audit, verification status, and remaining release checks.

## Release checklist

Run `node --test tests/*.test.cjs`, verify Vercel's `/api/epa/vehicle/menu/make?year=2022` responds with a valid EPA menu, and test single/multiple/no-match EPA configurations, offline and API-failure states, saved deletion and Undo, and a saved selection after reload. Verify real iOS/Android camera scanning independently.

Implementation and rollback notes: [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Saved backup and restore

Use **Saved → Backup** to download `vinbox-saved.json`, then **Saved → Restore backup** to choose it. VINBOX validates the file size, version, VINs, fields, duplicates, and 100-item limit before offering an inline replacement confirmation. Restore and deletions are reversible with Undo; browser storage failures leave the prior saved list intact. The JSON file contains VINs and vehicle characteristics, so treat it as private and store it securely.

At the 100-vehicle limit, VINBOX refuses the 101st save and tells users to remove a saved vehicle first. No saved item is ever automatically removed to make space.

## Automatic EPA matching

Open an expanded vehicle result to request EPA estimates on demand. VINBOX first resolves the year/make/model nomenclature, then evaluates NHTSA body style, engine displacement, cylinder count, automatic/manual transmission, drivetrain, trim, and fuel/electrification against the actual EPA candidate records. An unambiguous match is displayed with **“Matched automatically from the decoded VIN”** and persisted as the official EPA record ID. No extra tap is necessary. **Change configuration** explicitly reopens the manual selector.

VIN decodes do not always reveal an EPA-specific transmission subtype, final-drive ratio, fuel octane, trim designation, or other rating-relevant detail. VINBOX will **not guess** when two candidate records remain compatible, have different EPA ratings, or some candidate records could not be checked. In those cases it asks users to confirm the correct configuration. Failed/partial VIN decodes are never automatically assigned an EPA record.

The automatic lookup considers at most four plausible EPA model names and sixteen matching configuration records (three concurrent requests with short-lived in-memory cache). Larger model families go directly to a filtered manual selector instead of generating excessive API requests. It never sends the VIN itself to FuelEconomy.gov. Use `node --test tests/*.test.cjs` to run the full suite; physical vehicle checks against door stickers/manufacturer equipment remain appropriate when exact configuration data is uncertain.

## EPA data integrity and confirmation policy

One shared `VinEpaMatch.assessment` compatibility contract is used by automatic selection, manual selection, and previously saved EPA IDs. The adapter refuses to display a fuel-economy record that conflicts with decoded VIN model, make, model year, engine displacement, cylinder count, known drivetrain, transmission type or **number of gears**, primary fuel, identified hybrid/PHEV/EV status, or explicit turbocharger details. The validation also considers exact trim **words** rather than substring guesses (e.g. `Executive` is not `EX`). It deduplicates repeated EPA configuration IDs.

An EPA configuration's existence alone is not enough to claim an automatic match. If the VIN does not establish the hybrid state or turbocharger evidence required for a confident match, VINBOX retains the option for user selection rather than inventing certainty. Manual selection still cannot override known VIN/EPA contradictions. **AWD and part-time 4WD are not automatically treated as interchangeable** because they may describe materially different equipment.

If an old saved record points to a different EPA model, the fuel-economy panel rejects it and offers **Choose another / retry**; the saved VIN and its decoded characteristics remain intact. Existing saved JSON backups remain compatible, and all VINs continue to be sent only to NHTSA, not to FuelEconomy.gov.

Run all regression suites with `node --test tests/*.test.cjs`. Hardware camera, physical vehicle verification, accessibility, and production browser interactions remain separate acceptance checks.

## VIN-to-EPA matching without unnecessary dropdowns

EPA records are **vehicle configurations**, not VIN-decoded records. VINBOX now uses a three-outcome fuel economy contract to avoid requiring a version selection merely to display useful, verified EPA estimates:

1. **Unique configuration:** A complete NHTSA decode plus one compatible EPA vehicle record shows the selected record's city/highway/combined MPG or MPGe and its EPA ID is saved.
2. **Verified shared rating or observed range:** If multiple fully checked, compatible EPA records remain, VINBOX compares their EPA-published figures. It shows one shared rating (for example, 2022 RAV4 2.5L FWD: **30 MPG**) or a labeled minimum–maximum range (for example, 2022 F-150 2.7L 4WD: **20–21 MPG**). It does not calculate an arithmetic average of MPG or claim to know an exact EPA vehicle ID. The user can optionally **Choose exact version**.
3. **No trustworthy estimate:** When VIN evidence is partial, EPA data is missing/failed, fuel units conflict, electrification or turbo evidence is insufficient, or too many variants remain unchecked, VINBOX keeps a manual configuration choice or indicates unavailable data rather than guessing.

The resolver checks EPA year, manufacturer, model and NHTSA body type, known trim, displacement, cylinder count, transmission type/**CVT subtype**/speed count, drivetrain, fuel, electrification and turbo state. It validates the **entire** candidate set before offering a shared or ranged estimate. It will not present a computed range if any plausible EPA record could not be loaded. EPA vehicle IDs and costs come from the official source. The app never invents an EPA configuration ID for a group estimate or sends the VIN to FuelEconomy.gov.

**Annual fuel cost** is the EPA-published estimate based on 15,000 miles/year and EPA fuel prices. For several compatible configurations, VINBOX shows the observed minimum–maximum of published costs (or the identical cost). It does **not** calculate annual cost by simply dividing 15,000 by an averaged MPG. Electricity usage retains one decimal when provided by EPA. The fuel-economy panel opens automatically when its result is available, reducing extra clicks.

### Backend architecture and limits

VINBOX is a static PWA, **not** a database-backed service. VIN decode goes from browser to the official NHTSA vPIC API. EPA year/make/model/options/record requests use Vercel's fixed-origin same-site rewrite to FuelEconomy.gov. Records are fetched only for expanded vehicle cards. EPA request concurrency is capped at three; at most 16 possible configurations are fetched per resolution; request timeouts, retries and in-memory 24-hour caching limit load. User saved vehicles and an optional EPA ID remain device-local. A per-VIN fingerprint of NHTSA decode fields invalidates stale EPA results after a repeated decode. Installed PWAs receive this release through the **v11** service-worker cache.

Coverage: `node --test tests/*.test.cjs` (116 cases). **Manual checks still necessary:** actual mobile camera/flashlight, VoiceOver/TalkBack, public browser behavior with real NHTSA VINs, offline upgrades and live deployment latency. The outside services can be unavailable or change their field coverage; VINBOX degrades to a transparent fallback.

## Automatic recovery from invalid EPA model associations

An EPA ID stored in the browser is **only a previously resolved association**. It is not an authoritative attribute of the VIN. When VINBOX loads a saved vehicle, it fetches the referenced official EPA record and compares the record's **actual** model, year, make, engine, drivetrain, transmission, and fuel against NHTSA's decoded fields.

If the EPA record is compatible but the old stored `epaModel` text differs, VINBOX repairs that label from the official EPA record without asking the user to choose again. If the saved EPA ID is stale, retired, or points to an incompatible vehicle, VINBOX removes **only** the invalid EPA association from local storage and **automatically reruns VIN-based resolution**. The vehicle and all its decoded details remain saved.

The same automatic recovery is attempted after a user inadvertently selects an incompatible EPA menu entry. No mismatching EPA MPG is displayed. A unique verified match is selected and persisted automatically; several compatible versions show a verified common EPA rating or range where possible; manual selection is retained only for genuinely unresolved variants. An invalid auto-selected EPA record cannot recursively retry itself. Transient network errors do not erase the saved association, and **Retry VIN match** launches automatic resolution rather than forcing a model dropdown.

The app continues to obtain decoded VIN data from NHTSA and EPA configuration records from FuelEconomy.gov through the existing same-origin proxy. No VIN is sent to EPA, no server database is added, and existing saved-vehicle JSON backups are backward compatible. The service worker cache is `vinbox-v12`. Full regression suite: `node --test tests/*.test.cjs`.
