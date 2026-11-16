# VINBOX Cars — marketplace pilot

**Status: working private preview, not a public marketplace.** The scanner and locally saved vehicles remain fully functional. No account backend or public listing database is connected to the deployment.

## Available now

1. Decode or open a saved full VIN in VINBOX and select **Sell** next to that vehicle. Its decoded year, make, model, trim, engine, fuel and drivetrain are carried into the listing editor automatically.
2. Add 1–12 current vehicle photos, asking price, mileage, city/ZIP, title status, condition, seller name and authorization to sell. Choose **Private seller** or **Dealership** and optionally add a profile photo or logo. Known issues and seller description are optional.
3. Select **Preview listing**. The vehicle gallery opens the details page, with the seller name, seller type and avatar below the vehicle facts. Initials appear when an avatar is absent. Older previews with no seller information remain accessible.
4. Use **My listings** to edit drafts, mark sold, restore a listing, and delete it.

**Browse** opens with 10 sample vehicles from fictional private sellers and dealerships. Their illustrative photos and avatars are generated WebP assets bundled with the app. The sample count and detail label identify the demo inventory. Each card places the asking price over its cover photo. Sample listings contain no real VIN or contact information and are view-only. Personal vehicle listings are labeled **Private preview** and remain accessible on the device that saved them.

On phones, **Browse**, **Sell a car**, and **My listings** sit in a floating bottom bar above the device safe area. Header search stays centered when space allows and uses the available width beside the logo on narrow phones. It filters Browse as you type and preserves the filter when you return from a listing. Submit a search from other pages to open matching results.

## Local data lifecycle

- Metadata is saved in browser localStorage, key vinbox-marketplace-drafts-v1. Maximum 30 drafts; reaching capacity never silently discards an older listing.
- Listing photos and seller images are stored in the photos store of the vinbox-marketplace-photos IndexedDB database. The browser re-encodes them to JPEG, stripping original EXIF metadata. The largest side is capped at 1600 px for vehicles and 256 px for avatars. The draft stores image IDs and the seller display name and type. Removing a seller image or deleting its listing removes the associated avatar blob.
- Vehicle data comes from the NHTSA-decoded VIN snapshot. Current price, odometer, disclosures and condition come from the seller.
- Listing states in this pilot: draft → preview → sold, with the sold state reversible.
- The normal VINBOX JSON backup does **not** back up marketplace photos or drafts. Clearing browser data may remove all listing data. Storage failures must not be represented as successful saves.

## Production backend (migration staged, NOT applied)

See supabase/migrations/20261116000000_marketplace_foundation.sql. It includes relational vehicle, listing, media, conversations, messages, favorites and reports tables, plus RLS policies restricting writes to authenticated owners, and private image storage. Sellers cannot directly activate public listings; activation requires separate trusted moderation. Server database prices use integer cents.

**Do not run this migration on an unrelated Supabase project.** The connected Supabase account has no dedicated VINBOX project; no project was created or billed. The migration is a proposed starting point and has not been verified against a real VINBOX database.

Before true public publication, we still need a dedicated Supabase project, authentication and seller verification, server-side VIN revalidation, secure media processing and signed delivery, rate limits and fraud moderation, real buyer messages and notifications, report/block tools, retention/deletion/backup policies, and cross-user search. These are not enabled by the local preview.

## Verification

Run `node --test tests/*.test.cjs`. CI also runs a mobile Chrome smoke test against the deployment. It exercises the sample catalog, the image-first details page, and the private VIN-to-preview path including seller image persistence. The service worker caches sample images as they are requested.

Design principles: no hero or modal wizard, one compact nav, 4:3 actual vehicle photos, two cards on phones, three on tablets, four/five on intermediate desktops and six on large screens, no repeated VIN-derived inputs, and visible provenance for seller disclosures.


## Seller location and photo browsing

- **One location field:** Enter a five-digit U.S. ZIP code (including leading-zero codes) and VINBOX automatically looks up a suggested postal city and state, replacing the ZIP in the existing editable location field. The ZIP is retained separately in the local draft for provenance. Typing a city/town directly still works.
- **Geographical ambiguity:** ZIP codes can cover multiple communities. The suggested postal city is not proof of municipal boundaries or an exact address. Sellers can edit the town/city without another page. A wrong, unknown or offline ZIP lookup shows a recoverable inline message and allows direct town entry. An unconverted ZIP by itself does not pass listing preview validation.
- **Data source:** The fixed-origin `/api/postal/us/:zip` Vercel rewrite accesses Zippopotam.us's GeoNames-derived lookup data. Only the ZIP is sent; no VIN, street address, GPS or account information is transmitted. The service is third-party, best-effort, and may not match a seller's local town name.
- **Photos:** Cards and the detail page display one 4:3 (detail: 16:9 desktop) photo per view using native horizontal swipe/scroll snapping. Additional photos are accessible through unobtrusive previous/next controls, a counter, and arrow-key navigation. The seller's photo-upload thumbnails are a horizontally scrollable shelf with working per-photo removal, instead of a growing photo grid. Reduced-motion and browser keyboard focus are supported.
- **PWA:** The service-worker shell includes the marketplace templates, components and data adapters; ZIP API responses are never cached by the service worker. Photo blobs stay in device-local IndexedDB with the existing deletion and memory cleanup safeguards.


## Vehicle details and data sources

- The swipeable gallery opens the details page and links to a full-photo route. Browse, details, and the full-photo route share one gallery component. Returning to the listing keeps the last photo in view.
- Asking price, city, mileage, and sale status sit together. Cards show the asking price over the photo. A dealer can supply an optional stock number and additional fee amount. The details page sums the asking price and additional dealer fees in integer cents, before taxes and registration.
- Title branding and lien status are independent. A legacy “Lien” becomes “Not sure” for title and “Lien on vehicle” for lien status. Known issues appear with condition and title. Sellers can add exterior color and recent maintenance. Existing issue notes are preserved; empty legacy notes show “Not disclosed.”
- VIN-decoded factory specs are distinct from seller information. Fuel economy reuses the scanner's EPA matcher and displays results only for a confirmed automatic configuration match. NHTSA model recalls load separately on demand and link to the official VIN lookup for unrepaired recalls on a specific vehicle.
- Private drafts and uploads remain device-local. Buyers can message sellers once a public listing backend and authenticated seller accounts are available. The detail fields migration is staged for that future backend and has not been applied.

The marketplace layouts and scanner section patterns use native HTML templates, with shared DOM helpers in `ui.js`. Marketplace components render listing cards, disclosures, form fields, photo galleries, and seller identity. Routes handle navigation and local draft persistence.
