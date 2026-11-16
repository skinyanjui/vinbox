# vinbox

VIN scanner built on the NHTSA vPIC API. Single file, no build step: open `index.html` in a browser tab or host it as a static site.

- Scan a VIN barcode with the camera, or from a photo; or type or paste one
- Batch decode (up to 50 per request), partial VINs with a `*` wildcard, optional model year (`5UXWX7C5*BA 2011`)
- Recalls (matched by make, model and year) and dimensions from NHTSA
- Save vehicles locally, export CSV, deep link with `#<VIN>`

Data: [vPIC](https://vpic.nhtsa.dot.gov/api/) and the NHTSA recalls API. The app must run in a normal browser tab or hosted page: sandboxed previews block outside requests, and the camera needs HTTPS.

## Install and offline use

Open the hosted site on a phone and use **Add to Home Screen** (iOS Safari: Share menu; Android Chrome: menu, Install app). It then launches full screen with its own icon. The app shell is cached, so it opens without a connection and Saved vehicles are always available. Decoding and recalls still need a connection to NHTSA, and the app says so when you are offline.

Files: `index.html` (the whole app), `sw.js` (offline shell), `manifest.webmanifest` and the icon files. After a redeploy, the new version loads the next time the app is opened.
