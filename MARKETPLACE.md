# VINBOX Cars — marketplace pilot

**Status: working private preview, not a public marketplace.** The scanner and locally saved vehicles remain fully functional. No account backend or public listing database is connected to the deployment.

## Available now

1. Open **Sell a car**. Enter a full VIN and choose **Find vehicle**, or choose a scanned or saved vehicle below the field. The VIN fills in the year, make, model and available specs. Use **Open VIN scanner** to scan a barcode or photo.
2. Add 1–12 current vehicle photos, asking price, mileage, city/ZIP, title status, condition, seller name and authorization to sell. Choose **Private seller** or **Dealership** and optionally add a profile photo or logo. Known issues and seller description are optional.
3. Select **Preview listing**. The details page groups mileage, drivetrain, transmission, fuel, title, condition, body, and trim in one responsive facts grid. A separate disclosures section shows liens and known issues. The contact card shows the seller name, type and avatar without a redundant heading. Initials appear when an avatar is absent. Older previews with no seller information remain accessible.
4. Choose **Continue draft** in **Sell a car** or **My listings** to pick up a draft on the same device. Use **My listings** to edit a preview, mark it sold, mark it available again, or delete it.

**Browse** opens with 10 sample vehicles from fictional private sellers and dealerships. Their illustrative photos and avatars are generated WebP assets bundled with the app. The sample count and detail label identify the demo inventory. Each card places the asking price over its cover photo. Sample listings contain no real VIN or contact information and are view-only. Personal vehicle listings are labeled **Private preview** and remain accessible on the device that saved them.

The details page ends with **Similar cars**, showing up to four available listings ranked by make/model, body style, fuel, drivetrain, year, price, mileage and city. It excludes the viewed vehicle, sold listings, drafts and repeated VINs. Cards reuse Browse including Save; demonstration listings are labeled as examples below the recommendations. When no eligible alternatives exist, an empty state and Browse link appear.

The mobile dock has four **icon-only** actions: Browse, Saved, Sell and Account, with accessible names and touch-sized hit areas. Desktop navigation keeps the Sell a car text action. **My listings** is under Account, where local listing management belongs; it remains accessible at `#mine`. Account is the intended authentication entry point, but **real sign-in is not available** until a dedicated backend is provisioned. Local seller defaults and listings stay device-local.

Browse uses a shared deterministic search contract: multiple words, quoted phrases, year, make, model, body, city, VIN, price expressions such as `under $20k`, and ranking/sorting for price, mileage, or model year. Search terms remain in the `?q=` URL without page reload; matched cards keep their photo and Save state. A clear empty state includes Clear search. Sold listings and drafts are excluded from browse search (sold previews remain accessible through My listings). Sorting and card matching operate on the current local/demo dataset, **not a public server**.

For the future backend, `supabase/market_search_public_staged.sql` contains an **unapplied**, read-only, pagination-bounded full-text search function with an index and invoker RLS. It exposes only whitelisted public listing fields (no VIN or seller ID) and excludes deleted, sold, pending, and draft records. The database must first be provisioned and schema/data/auth reviewed; generate and validate the migration in that project before making an RPC available. Index performance, RLS, abuse throttling, pagination and failure handling must be verified there.

Marketplace and scanner screens use shared 4/8/12/16/20/24px spacing tokens and grid-based page, navigation, field, card, detail, and action layouts. Horizontal swipe galleries and photo shelves retain their scroll behavior.

## Local data lifecycle

- Metadata is saved in browser localStorage, key vinbox-marketplace-drafts-v1. Maximum 30 drafts; reaching capacity never silently discards an older listing.
- Saved cars use a separate device-local list of listing IDs. Drafts remain private and clearing browser storage removes the shortlist.
- Seller defaults are saved on the device and apply to new listings. Recent VIN lookups stay in the current tab session. Vehicles saved in the scanner appear in Sell across tabs on the same device.
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
- The summary follows the gallery on phones and sits beside it on desktop. Asking price, dealer fees, Save, city, sale status, and key vehicle facts are grouped together. Cards show the asking price over the photo. Dealer price breakdowns sum dealer fees and asking price in integer cents, before taxes and registration.
- Title branding and lien status are independent. A legacy “Lien” becomes “Not sure” for title and “Lien on vehicle” for lien status. Seller-reported liens and known issues appear in a compact color-coded disclosure grid. No disclosure row is shown when it is genuinely missing; the form uses a neutral Choose one prompt rather than Not disclosed. Individual specification rows and optional sections are omitted when empty; unavailable EPA/recall panels disappear after a successful empty lookup. Existing seller notes remain stored.
- The full VIN appears in the listing summary when available. Sample vehicles have no VIN. Fuel economy displays EPA estimates when Vinbox can match the vehicle version. Open **Model recalls** for the model-year lookup and a link to check an individual VIN.
- Private drafts and uploads remain device-local. Seller contact email and phone are optional per-listing fields stored on this device. When supplied, the details page offers native email, SMS and phone links. These open the device's email/phone apps; they do not send or persist in-app messages. Demo listings have no contact actions, and sold listings do not solicit messages. An authenticated backend and verified accounts are still required for cross-user in-app messaging. The detail fields migration is staged for that future backend and has not been applied.

The marketplace layouts and scanner section patterns use native HTML templates, with shared DOM helpers in `ui.js`. Marketplace components render listing cards, disclosures, form fields, photo galleries, and seller identity. Routes handle navigation and local draft persistence.
