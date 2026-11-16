# VINBOX Cars — marketplace pilot

**Status: working private preview, not a public marketplace.** The scanner and locally saved vehicles remain fully functional. No account backend or public listing database is connected to the deployment.

## Available now

1. Decode or open a saved full VIN in VINBOX and select **Sell** next to that vehicle. Its decoded year, make, model, trim, engine, fuel and drivetrain are carried into the listing editor automatically.
2. Add 1–12 actual vehicle photos, asking price, mileage, city/ZIP, title status, condition and authorization to sell. Known issues and seller description are optional. The device resizes/re-encodes photos to JPEG, removing original EXIF metadata.
3. Select **Preview listing**. The listing appears in a photo-first card grid and a straightforward details page.
4. Use **My listings** to edit drafts, mark sold, restore a listing, and delete it.

**No fraudulent publishing claims.** Listings are labeled **Private preview**. They cannot be accessed on another device, do not have a public listing URL, and buyers cannot contact the seller yet. The contact control explains that messaging is unavailable. VINBOX contains no fabricated inventory.

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
