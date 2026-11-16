'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../marketplace-core.js');
const samples=require('../marketplace-samples.js');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
const source={vin:'WDC0G4KB8GF018636',decoded:true,hasError:false,
 year:2016,title:'2016 Mercedes-Benz GLC-Class GLC300 Base-4M',
 flat:{ModelYear:'2016',Make:'Mercedes-Benz',Model:'GLC-Class',Trim:'GLC300 Base-4M',
 BodyClass:'Sport Utility Vehicle',DriveType:'AWD/All-Wheel Drive',DisplacementL:'2.0',
 FuelTypePrimary:'Gasoline',TransmissionStyle:'Automatic'}};
function draft(){
 const car=C.pickVehicle(source),d=C.fresh(car);
 d.id='a3a3f8be-f7a1-42e4-9f3d-411b28a99dca';
 d.price='14,900';d.mileage='92400';d.place='Evansville, Indiana';
 d.titleStatus='clean';d.condition='good';d.authorized=true;
 d.sellerName='Morgan Ellis';
 d.photoIds=['6abe87a1-1a0d-4cca-b271-41be88512399'];
 return d;
}
const memory=()=>{const entries=new Map();return {getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)}};
test('VINBOX sells a decoded VIN without asking year, make or model again',()=>{
 const d=C.pickVehicle(source);
 assert.equal(d.year,2016);assert.equal(d.make,'Mercedes-Benz');
 assert.equal(d.model,'GLC-Class');assert.equal(d.trim,'GLC300 Base-4M');
 assert.equal(d.vin,source.vin);
});
test('partial/failed VIN cannot be treated as sellable decoded vehicle',()=>{
 assert.equal(C.pickVehicle({...source,vin:'WDC0G4KB*'}),null);
 assert.equal(C.pickVehicle({...source,hasError:true}),null);
 assert.equal(C.pickVehicle({...source,decoded:false}),null);
});
test('listing requires price, mileage, city, disclosures, seller name, authorization and a photo',()=>{
 const d=C.fresh(C.pickVehicle(source));
 let v=C.validate(d);
 assert.equal(v.valid,false);
 for(const f of ['price','mileage','place','titleStatus','condition','sellerName','photos','authorized'])assert.ok(v.errors[f]);
});
test('complete seller input validates with no duplicate vehicle questions',()=>assert.equal(C.validate(draft()).valid,true));
test('money is represented in integer cents without floating point',()=>{
 assert.equal(C.cents('$14,900.25'),1490025);
 assert.equal(C.cents('0'),null);
 assert.equal(C.cents('12.345'),null);
 assert.equal(C.cents('Infinity'),null);
 assert.equal(C.cents('1e7'),null);
 assert.equal(C.cents('100000000000'),null);
});
test('odometer is nonnegative, integer, and realistically bounded',()=>{
 assert.equal(C.miles('92,400'),92400);
 assert.equal(C.miles('0'),0);
 assert.equal(C.miles('-10'),null);
 assert.equal(C.miles('10.5'),null);
 assert.equal(C.miles('1500001'),null);
});
test('unsafe or blank city is rejected',()=>{
 assert.equal(C.location('Evansville, IN'),'Evansville, IN');
 assert.equal(C.location('<script>'),null);
 assert.equal(C.location(''),''
   ||null);
 assert.equal(C.location('Evansville\nIndiana'),null);
});
test('photo limit and declared title/condition enums are enforced',()=>{
 const d=draft();d.photoIds=new Array(13).fill('x');
 assert.equal(C.validate(d).valid,false);
 d.photoIds=['6abe87a1-1a0d-4cca-b271-41be88512399'];d.titleStatus='verified clean';
 assert.equal(C.validate(d).valid,false);
 d.titleStatus='clean';d.condition='unknown';
 assert.equal(C.validate(d).valid,false);
});
test('drafts roundtrip through local storage and preserve vehicle attributes',()=>{
 const storage=memory(),d=draft();
 assert.equal(C.write(storage,[d]),true);
 const restored=C.read(storage);
 assert.equal(restored.length,1);
 assert.equal(restored[0].vehicle.model,'GLC-Class');
 assert.equal(restored[0].price,'14,900');
 assert.equal(restored[0].status,'draft');
 assert.deepEqual(restored[0].photoIds,d.photoIds);
});
test('malformed listing storage safely falls back to an empty array',()=>{
 const storage={getItem:()=>'{broken'};assert.deepEqual(C.read(storage),[]);
});
test('more than 30 local drafts is rejected without silently deleting records',()=>{
 assert.throws(()=>C.write(memory(),Array.from({length:31},draft)),/Too many/);
});
test('untrusted stored status and photo paths are normalized',()=>{
 const d=draft();d.status='active';d.photoIds=['../../secret','6abe87a1-1a0d-4cca-b271-41be88512399'];
 const clean=C.normalizeRecord(d);
 assert.equal(clean.status,'draft');assert.equal(clean.photoIds.length,1);
});
test('listing cards and vehicle details distinguish samples and private previews',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes('Private preview'));
 assert.ok(s.includes('on this device · Not public'));
 assert.ok(s.includes("r.sample?'Sample listing':'Private preview'"));
 assert.ok(!s.includes('Browse the photo-first listing experience.'));
 assert.ok(!s.includes("link('Sell your car','#new'"));
 assert.ok(s.includes('Messaging is not active')||s.includes('messaging is not active'));
 assert.ok(!s.includes('innerHTML='));
});
test('image processing resizes and re-encodes, with IndexedDB photo persistence',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes("indexedDB.open('vinbox-marketplace-photos'"));
 assert.ok(s.includes("canvas.toBlob"));
 assert.ok(s.includes("image/jpeg"));
 assert.ok(s.includes("maxSize/Math.max")&&s.includes("processImage(file,256)"));
 assert.ok(s.includes("URL.revokeObjectURL"));
});
test('scanner has a Sell action carrying the existing VIN data',()=>{
 const s=read('app.js');
 assert.ok(s.includes("sessionStorage.setItem('vinbox-sell-vehicle-v1',JSON.stringify({vin:it.vin"));
 assert.ok(s.includes("location.assign('marketplace.html#new')"));
 assert.ok(s.includes('it.decoded&&!it.hasError'));
});
test('marketplace pages use scripts and styles from same origin',()=>{
 const html=read('marketplace.html');
 for(const filename of ['marketplace.css','marketplace-core.js','marketplace-samples.js','marketplace.js'])assert.ok(html.includes(filename));
 assert.ok(html.includes('href="./"'));
 assert.ok(!html.includes('cdn.')&&!html.includes('https://fonts.'));
});
test('PWA caches marketplace assets together with the scanner shell',()=>{
 const worker=read('sw.js');
 for(const file of ['marketplace.html','marketplace.css','marketplace-core.js','marketplace-samples.js','marketplace.js'])assert.ok(worker.includes("'"+file+"'"));
 assert.ok(worker.includes("vinbox-v19"));
});
test('unprovisioned production schema forbids anonymous writes and unauthorized publishing',()=>{
 const sql=read('supabase/migrations/20261116000000_marketplace_foundation.sql');
 assert.ok(sql.includes('alter table public.market_listings enable row level security'));
 assert.ok(sql.includes('revoke all on public.market_listings from anon, authenticated'));
 assert.ok(sql.includes("status in ('draft','pending_review','sold','removed')"));
 assert.ok(sql.includes("status='active'"));
 assert.ok(sql.includes('seller_id=(select auth.uid())'));
});

test('local preview never deletes old drafts when the draft limit is reached',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes('if(listings.length>=C.MAX_DRAFTS)'));
 assert.ok(!s.includes('listings.length=C.MAX_DRAFTS'));
});
test('marketplace image backup limitations are communicated rather than hidden',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes('Backing up decoded VINs does not back up these listing drafts or photos.'));
});
test('marketplace production smoke test exercises the full VIN-sell-photo-preview flow',()=>{
 const s=read('scripts/marketplace-smoke.cjs');
 assert.ok(s.includes('page.waitForURL')&&s.includes('marketplace'));
 assert.ok(s.includes('Preview listing'));
 assert.ok(s.includes('photoPersisted:true'));
});
test('marketplace workflow verifies the live site before running the browser smoke',()=>{
 const s=read('.github/workflows/mobile-performance.yml');
 const idx=s.indexOf('node scripts/wait-for-production.cjs');
 const smoke=s.indexOf('node scripts/marketplace-smoke.cjs');
 assert.ok(idx>=0&&smoke>idx);
});

test('marketplace card grid uses 2 mobile and 6 large-desktop columns',()=>{
 const css=read('marketplace.css');
 assert.match(css,/\.market-cards\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(min-width:1440px\)\{\.market-cards\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(css,/\.market-cards\{grid-template-columns:1fr/);
 assert.match(css,/@media\(min-width:680px\)/);
 assert.match(css,/@media\(min-width:900px\)/);
});

test('ZIP lookup maps to city/state without GPS or a street address',()=>{
 const payload={'post code':'47715','country abbreviation':'US',
   places:[{'place name':'Evansville','state abbreviation':'IN'}]};
 assert.deepEqual(C.postalPlace('47715',payload),{zip:'47715',place:'Evansville, IN',alternatives:[]});
 assert.equal(C.postalCode('00501'),'00501');
 assert.equal(C.postalCode('4771'),null);
 assert.equal(C.postalCode('47715<script>'),null);
});
test('ZIP suggestions allow manual town corrections when several places share a code',()=>{
 const payload={'post code':'12345','country abbreviation':'US',
   places:[{'place name':'Schenectady','state abbreviation':'NY'},
           {'place name':'Rotterdam','state abbreviation':'NY'},
           {'place name':'Schenectady','state abbreviation':'NY'}]};
 assert.deepEqual(C.postalPlace('12345',payload),{zip:'12345',place:'Schenectady, NY',alternatives:['Rotterdam, NY']});
 assert.equal(C.postalPlace('12346',payload),null);
 assert.equal(C.postalPlace('12345',{...payload,'country abbreviation':'GB'}),null);
 assert.equal(C.postalPlace('12345',{...payload,places:[{'place name':'<script>','state abbreviation':'NY'}]}),null);
});
test('raw ZIP alone does not pass listing preview and corrected town is persisted',()=>{
 const d=draft();d.place='47715';
 assert.equal(C.validate(d).valid,false);
 assert.match(C.validate(d).errors.place,/city or town/i);
 d.place='Evansville, IN';d.postalCode='47715';
 assert.equal(C.validate(d).valid,true);
 const storage=memory();C.write(storage,[d]);
 assert.equal(C.read(storage)[0].postalCode,'47715');
});
test('postal lookup is a fixed-origin proxy and form waits for result',()=>{
 const v=JSON.parse(read('vercel.json'));
 assert.ok(v.rewrites.some(r=>r.source==='/api/postal/us/:zip'&&r.destination==='https://api.zippopotam.us/us/:zip'));
 const s=read('marketplace.js');
 assert.ok(s.includes("fetch('/api/postal/us/'+zip"));
 assert.ok(s.includes("C.postalPlace(zip,await response.json())"));
 assert.ok(s.includes('await Promise.all([postal.resolve(),seller.ready()])'));
 assert.ok(!s.includes('navigator.geolocation'));
});
test('listing and detail galleries swipe horizontally, with keyboard-accessible arrows',()=>{
 const s=read('marketplace.js'),css=read('marketplace.css');
 assert.ok(s.includes("photoCarousel(r,'card')"));
 assert.ok(s.includes("photoCarousel(r,'detail')"));
 assert.ok(s.includes("class:'market-photos',tabindex:'0'"));
 assert.ok(css.includes('scroll-snap-type:x mandatory'));
 assert.ok(css.includes('scroll-snap-type:x proximity'));
 assert.ok(css.includes('overflow-x:auto'));
 assert.ok(css.includes('touch-action:auto'));
 assert.ok(s.includes("role:'region'"));
 assert.ok(s.includes("'aria-label':'Next photo'"));
});
test('photo loading keeps the editor remove control',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes('placeholder.replaceWith(img)'));
 assert.ok(s.includes('else box.prepend(img)'));
 assert.ok(!s.includes('box.replaceChildren('));
});

test('seller identity round-trips while older previews still load',()=>{
 const storage=memory(),legacy=draft();
 delete legacy.sellerName;
 const restored=C.normalizeRecord({...legacy,status:'preview'});
 assert.equal(restored.status,'preview');
 assert.equal(restored.sellerName,'');
 assert.equal(restored.sellerType,'private');
 assert.equal(restored.sellerAvatarId,null);
 assert.ok(C.validate(restored).errors.sellerName);
 const avatarId='23d12756-dfbc-454a-9468-af08a50db947';
 const dealer={...draft(),sellerName:' River Bend Motor Co. ',sellerType:'dealership',sellerAvatarId:avatarId};
 C.write(storage,[dealer]);
 const result=C.read(storage)[0];
 assert.equal(result.sellerName,'River Bend Motor Co.');
 assert.equal(result.sellerType,'dealership');
 assert.equal(result.sellerAvatarId,avatarId);
 assert.equal(C.normalizeRecord({...dealer,sellerAvatarId:dealer.photoIds[0]}).sellerAvatarId,null);
 assert.equal(C.normalizeRecord({...dealer,sellerAvatarId:'https://example.com/avatar.jpg'}).sellerAvatarId,null);
 assert.ok(C.validate({...dealer,sellerName:'River\nBend'}).errors.sellerName);
 assert.equal(C.sellerInitials(result.sellerName),'RB');
});

test('ten sample vehicles have unique demo IDs, varied body styles and bundled imagery',()=>{
 assert.equal(samples.length,10);
 assert.equal(new Set(samples.map(record=>record.id)).size,10);
 assert.equal(new Set(samples.map(record=>record.vehicle.body)).size,10);
 assert.deepEqual(new Set(samples.map(record=>record.sellerType)),new Set(['private','dealership']));
 for(const record of samples){
  assert.match(record.id,/^sample-[a-z\d-]+$/);
  assert.equal(record.sample,true);
  assert.ok(record.sellerName);
  assert.ok(C.cents(record.price)>0);
  assert.equal(record.vehicle.vin,undefined);
  assert.equal(C.normalizeRecord(record),null);
  for(const media of [...record.photoSources,record.sellerAvatarSrc].filter(Boolean)){
   const bytes=fs.readFileSync(path.join(__dirname,'..',media));
   assert.equal(bytes.toString('ascii',8,12),'WEBP');
  }
 }
});

test('seller-reported title and condition have compact, honest labels',()=>{
 assert.equal(C.titleStatusLabel('clean'),'Clean');
 assert.equal(C.titleStatusLabel('lien'),'Lien');
 assert.equal(C.titleStatusLabel('salvage'),'Salvage');
 assert.equal(C.titleStatusLabel('rebuilt'),'Rebuilt');
 assert.equal(C.titleStatusLabel('unknown'),'Not sure');
 assert.equal(C.titleStatusLabel('invented'),'Not provided');
 assert.equal(C.conditionLabel('good'),'Good');
 assert.equal(C.conditionLabel('needs-work'),'Needs work');
 const source=read('marketplace.js');
 assert.ok(source.includes("'Title: '+C.titleStatusLabel(r.titleStatus)+' (reported)'"));
 assert.ok(source.includes("'Seller-reported, not independently verified.'"));
});
test('vehicle heading removes duplicate family and trim designations',()=>{
 assert.equal(C.displayTitle({vehicle:{year:2016,make:'Mercedes-Benz',
  model:'GLC-Class',trim:'GLC300 Base-4M'}}),'2016 Mercedes-Benz GLC300');
 assert.equal(C.displayTitle({vehicle:{year:2022,make:'Honda',
  model:'Civic',trim:'EX'}}),'2022 Honda Civic EX');
 assert.equal(C.displayTitle({vehicle:{year:2022,make:'Ford',
  model:'F-150',trim:'F-150'}}),'2022 Ford F-150');
});
test('browse removes repeated page heading, hero copy, CTA and preview notice',()=>{
 const source=read('marketplace.js');
 assert.ok(source.includes("el('h1',{class:'market-visually-hidden'},'Cars')"));
 assert.ok(!source.includes("heading('Cars','Browse the photo-first listing experience.'"));
 assert.ok(!source.includes("link('Sell your car','#new'"));
 assert.ok(!source.includes('Private preview: listings shown here exist only on this device.'));
 assert.ok(source.includes("' on this device · Not public'")||
   source.includes("+' on this device · Not public'"));
});
test('vehicle details prioritize seller facts with specifications collapsed',()=>{
 const source=read('marketplace.js');
 assert.ok(source.includes("'Condition & title'"));
 assert.ok(source.includes("C.titleStatusLabel(r.titleStatus)"));
 assert.ok(source.includes("C.conditionLabel(r.condition)"));
 assert.ok(source.includes("el('details',{class:'market-specifications'"));
 assert.ok(source.includes("'Ends in '+r.vehicle.vin.slice(-4)"));
 assert.ok(source.includes("if(r.knownIssues||r.description)"));
 assert.ok(!source.includes("'No additional description provided.'"));
});
test('unavailable buyer contact is not a non-functional action or sticky bar',()=>{
 const source=read('marketplace.js');
 assert.ok(!source.includes("'Contact seller'"));
 assert.ok(!source.includes("market-mobile-contact'"));
 assert.ok(source.includes('Buyer messaging is not active in this private preview.'));
});
test('marketplace card metadata is short and card grid preserved',()=>{
 const source=read('marketplace.js');
 const card=source.slice(source.indexOf('function card(r){'),source.indexOf('function renderBrowse(){'));
 assert.ok(card.includes("C.mileage(r.mileage)+' · '+r.place"));
 assert.ok(!card.includes('r.vehicle.transmission'));
 assert.ok(!card.includes('r.vehicle.drive'));
 assert.ok(card.includes("r.status==='sold'?"));
 const css=read('marketplace.css');
 assert.match(css,/\.market-cards\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(min-width:1440px\)\{\.market-cards\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});
