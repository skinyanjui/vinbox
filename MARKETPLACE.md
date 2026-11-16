# VINBOX Cars — marketplace pilot

**Status: working private preview, not a public marketplace.** The scanner and locally saved vehicles remain fully functional. No account backend or public listing database is connected to the deployment.

## Available now

1. Decode or open a saved full VIN in VINBOX and select **Sell** next to that vehicle. Its decoded year, make, model, trim, engine, fuel and drivetrain are carried into the listing editor automatically.
2. Add 1–12 actual vehicle photos, asking price, mileage, city/ZIP, title status, condition and authorization to sell. Known issues and seller description are optional. The device resizes/re-encodes photos to JPEG, removing original EXIF metadata.
3. Select **Preview listing**. The listing appears in a photo-first card grid and a straightforward details page.
4. Use **My listings** to edit drafts, mark sold, restore a listing, and delete it.

**No fraudulent publishing claims.** Listings are labeled **Private preview**. They cannot be accessed on another device, do not have a public listing URL, and buyers cannot contact the seller yet. The details page states that messaging is unavailable; it does not display a non-functional Contact seller action. VINBOX contains no fabricated inventory.

## Local data lifecycle

- Metadata is saved in browser localStorage, key vinbox-marketplace-drafts-v1. Maximum 30 drafts; reaching capacity never silently discards an older listing.
- Photos are saved in IndexedDB database vinbox-marketplace-photos, photos store, keyed by random UUID, in a resized JPEG format (up to 1600 px). Size/type/count restrictions apply. Photos never enter URLs or localStorage; blob URLs are revoked on view changes.
- Vehicle data comes from the NHTSA-decoded VIN snapshot. Current price, odometer, disclosures and condition come from the seller.
- Listing states in this pilot: draft → preview → sold, with the sold state reversible.
- The normal VINBOX JSON backup does **not** back up marketplace photos or drafts. Clearing browser data may remove all listing data. Storage failures must not be represented as successful saves.

## Production backend (migration staged, NOT applied)

See supabase/migrations/20261116000000_marketplace_foundation.sql. It includes relational vehicle, listing, media, conversations, messages, favorites and reports tables, plus RLS policies restricting writes to authenticated owners, and private image storage. Sellers cannot directly activate public listings; activation requires separate trusted moderation. Server database prices use integer cents.

**Do not run this migration on an unrelated Supabase project.** The connected Supabase account has no dedicated VINBOX project; no project was created or billed. The migration is a proposed starting point and has not been verified against a real VINBOX database.

Before true public publication, we still need a dedicated Supabase project, authentication and seller verification, server-side VIN revalidation, secure media processing and signed delivery, rate limits and fraud moderation, real buyer messages and notifications, report/block tools, retention/deletion/backup policies, and cross-user search. These are not enabled by the local preview.

## Verification

Run: node --test tests/*.test.cjs. CI additionally runs a mobile Chrome smoke test against the deployment, from a decoded VIN to Sell, photo upload, draft preview, reload/photo persistence and sold status. Service-worker shell v16 includes the new marketplace pages.

Design principles: no hero or modal wizard, one compact nav, 4:3 actual vehicle photos, two cards on phones, three on tablets, four/five on intermediate desktops and six on large screens, no repeated VIN-derived inputs, and visible provenance for seller disclosures.


## Seller location and photo browsing

- **One location field:** Enter a five-digit U.S. ZIP code (including leading-zero codes) and VINBOX automatically looks up a suggested postal city and state, replacing the ZIP in the existing editable location field. The ZIP is retained separately in the local draft for provenance. Typing a city/town directly still works.
- **Geographical ambiguity:** ZIP codes can cover multiple communities. The suggested postal city is not proof of municipal boundaries or an exact address. Sellers can edit the town/city without another page. A wrong, unknown or offline ZIP lookup shows a recoverable inline message and allows direct town entry. An unconverted ZIP by itself does not pass listing preview validation.
- **Data source:** The fixed-origin `/api/postal/us/:zip` Vercel rewrite accesses Zippopotam.us's GeoNames-derived lookup data. Only the ZIP is sent; no VIN, street address, GPS or account information is transmitted. The service is third-party, best-effort, and may not match a seller's local town name.
- **Photos:** Cards and the detail page display one 4:3 (detail: 16:9 desktop) photo per view using native horizontal swipe/scroll snapping. Additional photos are accessible through unobtrusive previous/next controls, a counter, and arrow-key navigation. The seller's photo-upload thumbnails are a horizontally scrollable shelf with working per-photo removal, instead of a growing photo grid. Reduced-motion and browser keyboard focus are supported.
- **PWA:** Cache v17 includes the updated scripts and layout; ZIP API responses are never cached by the service worker. Photo blobs stay in device-local IndexedDB with the existing deletion and memory cleanup safeguards.


## Marketplace content and categories audit (November 2026)

The Cars experience now follows **photos → asking price and mileage → title and condition → seller notes → optional VIN specifications**. This avoids duplicating actions in the navigation or repeating technical details across cards and panels.

| Surface | Immediately visible | Secondary / hidden | Removed duplication |
|---|---|---|---|
| Browse | Photos, year/make/model, mileage, town, price, concise reported title when known | Other factory specs | Repeated Cars heading, promotional subtitle, duplicated Sell button, large private-mode banner, repeated Private preview labels on every active card |
| Vehicle details | Photos, vehicle heading, asking price, town, mileage, drive/transmission, seller-reported **Title: Clean/Lien/Salvage/Rebuilt/Not sure** and condition | Expandable factory specs incl. engine/fuel/body/trim and only last four VIN digits | Full grid of technical attributes above the fold, duplicated price/mileage/contact panel, blank seller-description section, non-functional contact buttons |
| Selling form | VIN-prefilled vehicle label, photos, price, mileage, city/ZIP, title, condition, seller authorization | Seller notes (optional) | Long repeated technical summary, duplicate explanatory banner, verbose legal-title dropdown labels |
| My listings | Draft / Preview / Sold, price, edit/view/status actions | None needed | Duplicate My listings heading and redundant New listing button (Sell already in navigation); remains one quiet storage warning |

The **title status is always seller-reported**, not proven by decoding a VIN. On the listing card it is shown as a compact `Title: Clean (reported)` label. On the details page, the status is presented as `Title · Clean` alongside `Condition · Good`, with a single provenance line. No verified ownership, clean title, service history, or accident claims are inferred from a VIN. The vehicle heading deduplicates family/trim when NHTSA provides a manufacturer model family (e.g. `GLC-Class` with trim `GLC300 Base-4M` shows `2016 Mercedes-Benz GLC300`).

The private pilot still cannot publish to other devices or send buyer messages. The browse page includes a **quiet “on this device · Not public”** status near the listing count; detail previews and the listing editor retain localized status information. The removed Contact seller action had no functional backend and was therefore misleading; do not reinstate it until buyer/seller messaging is implemented and verified.

The two-card mobile/six-card large-desktop grid and horizontal swipe galleries remain unchanged. Headings are kept semantically available to assistive technology even where visual duplicates were removed. Tests cover content categories, seller-reported status labels, disclosure provenance, responsive cards, VIN-ending privacy, and collapsed specifications.
