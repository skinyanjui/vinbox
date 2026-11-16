# vinbox

VIN scanner built on the NHTSA vPIC API. Single file, no build step: open `index.html` in a browser tab or host it as a static site.

- Scan a VIN barcode with the camera, or from a photo; or type or paste one
- Batch decode (up to 50 per request), partial VINs with a `*` wildcard, optional model year (`5UXWX7C5*BA 2011`)
- Recalls (matched by make, model and year) and dimensions from NHTSA
- Save vehicles locally, export CSV, deep link with `#<VIN>`

Data: [vPIC](https://vpic.nhtsa.dot.gov/api/) and the NHTSA recalls API. The app must run in a normal browser tab or hosted page: sandboxed previews block outside requests, and the camera needs HTTPS.
