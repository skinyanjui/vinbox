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
test('unavailable VIN fields are removed at decode and when restoring legacy records',()=>{
 assert.equal(C.knownVehicleFact('Not Provided'),'');
 assert.equal(C.knownVehicleFact('Not Applicable'),'');
 assert.equal(C.knownVehicleFact('N/A'),'');
 assert.equal(C.knownVehicleFact('AWD'),'AWD');
 const raw={...source,flat:{...source.flat,Trim:'Not Provided',
  BodyClass:'Not Applicable',DriveType:'Not Available',
  TransmissionStyle:'Automatic',FuelTypePrimary:'Gasoline'}};
 const vehicle=C.pickVehicle(raw);
 assert.equal(vehicle.trim,'');
 assert.equal(vehicle.body,'');
 assert.equal(vehicle.drive,'');
 assert.equal(vehicle.transmission,'Automatic');
 const old={...draft(),vehicle:{...draft().vehicle,trim:'Not Provided',drive:'Not Applicable'}};
 const normalized=C.normalizeRecord(old);
 assert.equal(normalized.vehicle.trim,'');
 assert.equal(normalized.vehicle.drive,'');
 const renderer=read('marketplace-components.js');
 assert.ok(renderer.includes('not disclosed|n\\/a|unknown'));
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
 assert.equal(C.saleStatus({status:'preview'}),'Private preview');
 assert.ok(s.includes('on this device · Not public'));
 assert.equal(C.saleStatus({sample:true}),'Sample listing');
 assert.ok(!s.includes('Browse the photo-first listing experience.'));
 assert.ok(!s.includes("link('Sell your car','#new'"));
 assert.ok(!s.includes('innerHTML='));
});
test('image processing resizes and re-encodes, with IndexedDB photo persistence',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes("indexedDB.open('vinbox-marketplace-photos'"));
 const open=s.slice(s.indexOf('function photoDB(){'),s.indexOf('async function photoOp('));
 const operation=s.slice(s.indexOf('async function photoOp('),s.indexOf('function showStoredPhoto('));
 assert.ok(open.includes('req.onsuccess=()=>resolve(req.result)'));
 assert.ok(operation.includes('tx.oncomplete=()=>resolve(req.result)'));
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
 const revision=worker.match(/const VERSION='vinbox-v(\d+)'/)?.[1];
 assert.ok(revision&&read('marketplace.html').includes('marketplace.css?v='+revision));
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
 const s=read('marketplace.html');
 assert.ok(s.includes('Private on this device · Your available listings are not public yet.'));
 assert.ok(s.includes('market-backup-review'));
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
 assert.match(C.validate(d).errors.place,/enter the city/i);
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
test('listing and detail galleries use one shared template and swipe controls',()=>{
 const html=read('marketplace.html'),source=read('marketplace-components.js'),css=read('marketplace.css');
 assert.match(html,/id="market-gallery-template"/);
 assert.ok(html.includes('aria-label="Next photo"'));
 assert.ok(source.includes("photoCarousel(r,'card')"));
 assert.ok(read('marketplace.js').includes("photoCarousel(r,'detail'"));
 assert.ok(source.includes("'ArrowLeft'")&&source.includes("'ArrowRight'"));
 assert.ok(css.includes('scroll-snap-type:x mandatory'));
 assert.ok(css.includes('scroll-snap-type:x proximity'));
 assert.ok(css.includes('overflow-x:auto'));
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

test('similar cars rank characteristics, excluding the current listing',()=>{
 const viewed=samples.find(r=>r.id==='sample-camry');
 const ranked=C.similarListings(viewed,samples);
 assert.equal(ranked.length,3);
 assert.ok(ranked.every(r=>r.id!==viewed.id));
 assert.equal(new Set(ranked.map(r=>r.id)).size,3);
 assert.ok(ranked.every(r=>/wagon|coupe|convertible/i.test(r.vehicle.body)));
 assert.equal(C.similarListings(samples.find(r=>r.id==='sample-f-150'),samples).length,0);
 assert.equal(C.similarListings(viewed,samples,0).length,0);
 assert.deepEqual(C.similarListings(viewed,samples),C.similarListings(viewed,[...samples].reverse()));
 const sameModel={...viewed,id:'nearby-camry',status:'preview',vehicle:{...viewed.vehicle,year:2021},price:'22100'};
 assert.equal(C.similarListings(viewed,[...samples,sameModel])[0].id,'nearby-camry');
});
test('similar cars exclude sold, drafts and repeated VINs',()=>{
 const viewed={...draft(),status:'preview',id:'current'};
 const competitor={...draft(),id:'other',status:'preview',vehicle:{...viewed.vehicle,vin:'1HGCM82633A004352'}};
 const duplicate={...competitor,id:'duplicate'};
 const sold={...competitor,id:'sold',status:'sold',vehicle:{...competitor.vehicle,vin:'1HGCM82633A004353'}};
 const draftCar={...competitor,id:'draft',status:'draft',vehicle:{...competitor.vehicle,vin:'1HGCM82633A004354'}};
 const sameVin={...competitor,id:'sameVin',vehicle:{...competitor.vehicle,vin:viewed.vehicle.vin}};
 const matches=C.similarListings(viewed,[sold,draftCar,sameVin,duplicate,competitor]);
 assert.equal(matches.length,1);
 assert.equal(matches[0].vehicle.vin,competitor.vehicle.vin);
 assert.deepEqual(C.similarListings({},[competitor]),[]);
 assert.deepEqual(C.similarListings(viewed,[]),[]);
});
test('similar cars reuse Browse cards at the bottom of vehicle details',()=>{
 const script=read('marketplace.js'),css=read('marketplace.css');
 assert.ok(script.includes('matches.map(listingCard)'));
 assert.ok(script.includes('if(!matches.length)return null'));
 assert.ok(script.includes('if(similar)main.append(similar)'));
 assert.ok(script.includes("'Similar cars'"));
 assert.ok(css.includes('"similar similar"'));
 assert.ok(css.includes('.market-similar-cards{grid-template-columns:repeat(2,minmax(0,1fr))'));
 assert.ok(css.includes('@media(min-width:900px){.market-similar-cards{grid-template-columns:repeat(4,minmax(0,1fr))'));
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

test('title and condition have compact labels without verbal qualifiers',()=>{
 assert.equal(C.titleStatusLabel('clean'),'Clean');
 assert.equal(C.titleStatusLabel('salvage'),'Salvage');
 assert.equal(C.titleStatusLabel('rebuilt'),'Rebuilt');
 assert.equal(C.titleStatusLabel('unknown'),'Not sure');
 assert.equal(C.titleStatusLabel('invented'),'Not provided');
 assert.equal(C.conditionLabel('good'),'Good');
 assert.equal(C.conditionLabel('needs-work'),'Needs work');
 const source=read('marketplace-components.js');
 assert.ok(source.includes("'Title: '+C.titleStatusLabel(r.titleStatus)"));
 assert.doesNotMatch(source,/\(reported\)|Seller-reported/i);
});
test('legacy lien and issue disclosures retain what the seller supplied',()=>{
 const legacy={...draft(),titleStatus:'lien',knownIssues:'Service light'};
 const result=C.normalizeRecord(legacy);
 assert.equal(result.titleStatus,'unknown');
 assert.equal(result.lienStatus,'yes');
 assert.equal(result.issuesStatus,'listed');
 assert.equal(result.knownIssues,'Service light');
 assert.equal(C.normalizeRecord({...legacy,issuesStatus:'none'}).knownIssues,'');
 assert.equal(C.normalizeRecord(draft()).issuesStatus,'unknown');
 assert.equal(C.validate({...draft(),titleStatus:'rebuilt',lienStatus:'yes'}).valid,true);
 assert.ok(C.validate({...draft(),issuesStatus:'listed'}).errors.knownIssues);
});
test('dealer fee breakdown preserves cents and stays dealer-only',()=>{
 assert.equal(C.money('14900.25'),'$14,900.25');
 assert.equal(C.amountCents('0'),0);
 assert.equal(C.amountCents('39.995'),null);
 const input={...draft(),sellerType:'dealership',dealerFee:'199.99',stockNumber:'A123'};
 const saved=C.normalizeRecord(input);
 assert.equal(saved.stockNumber,'A123');
 assert.equal(C.moneyFromCents(C.cents(saved.price)+C.amountCents(saved.dealerFee)),'$15,099.99');
 assert.equal(C.normalizeRecord({...input,sellerType:'private'}).dealerFee,'');
 assert.ok(C.validate({...input,dealerFee:'invalid'}).errors.dealerFee);
});
test('fuel economy matching uses configuration evidence without a VIN',()=>{
 const vehicle=C.pickVehicle({...source,flat:{...source.flat,EngineCylinders:'4',TransmissionSpeeds:'7'}});
 const input=C.epaInput(vehicle);
 assert.equal(input.flat.EngineCylinders,'4');
 assert.equal(input.flat.TransmissionSpeeds,'7');
 assert.equal(input.flat.Model,'GLC-Class');
 assert.ok(!JSON.stringify(input).includes(source.vin));
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
 assert.ok(read('marketplace.html').includes('<h1 class="market-visually-hidden">Cars</h1>'));
 assert.ok(!source.includes("heading('Cars','Browse the photo-first listing experience.'"));
 assert.ok(!source.includes("link('Sell your car','#new'"));
 assert.ok(!source.includes('Private preview: listings shown here exist only on this device.'));
 assert.ok(source.includes("' on this device · Not public'")||
   source.includes("+' on this device · Not public'"));
});
test('vehicle details keep conditions visible and specs in a shared disclosure',()=>{
 const source=read('marketplace-components.js'),html=read('marketplace.html');
 assert.ok(source.includes("'Disclosures'"));
 assert.ok(source.includes("C.titleStatusLabel(r.titleStatus)"));
 assert.ok(source.includes("C.conditionLabel(r.condition)"));
 assert.ok(html.includes('<details class="market-specifications">'));
 assert.ok(html.includes('class="market-detail-vin" data-slot="vin" hidden'));
 assert.ok(source.includes('slots.vinValue.textContent=vin'));
 assert.ok(source.includes("'None reported by seller'"));
 assert.ok(!source.includes("'Not disclosed'"));
 assert.ok(source.includes("return disclosed.childElementCount?section('Disclosures',disclosed):null"));
 assert.equal(C.saleStatus({status:'sold'}),'Sold');
});
test('contact details validate, persist, and provide safe external seller actions',()=>{
 const d=draft();
 d.status='preview';
 d.contactEmail='seller@example.com';
 d.contactPhone='(812) 555-0123';
 assert.equal(C.validate(d).valid,true);
 const restored=C.normalizeRecord(d);
 assert.equal(restored.contactEmail,'seller@example.com');
 assert.equal(restored.contactPhone,'(812) 555-0123');
 const actions=C.contactLinks(restored);
 assert.match(actions.message,/^mailto:seller@example\.com\?subject=Question%20about%20/);
 assert.match(actions.text,/^sms:8125550123\?body=Hi%2C%20is%20your%20/);
 assert.equal(actions.call,'tel:8125550123');
 assert.deepEqual(C.contactLinks({...restored,sample:true}),{message:null,text:null,call:null});
 assert.deepEqual(C.contactLinks({...restored,status:'sold'}),{message:null,text:null,call:null});
 assert.deepEqual(C.contactLinks({...restored,status:'active'}),{message:null,text:null,call:null},
  'Unverified client state cannot enable buyer actions');
 assert.deepEqual(C.contactLinks({...restored,status:'draft'}),{message:null,text:null,call:null});
 assert.deepEqual(C.contactLinks({...restored,contactPhone:'',contactEmail:''}),
  {message:null,text:null,call:null});
 assert.equal(C.contactLinks({...restored,contactPhone:'',contactEmail:'seller@example.com'}).text,null);
 assert.equal(C.contactLinks({...restored,contactPhone:'',contactEmail:'seller@example.com'}).call,null);
 assert.equal(C.contactLinks({...restored,contactPhone:'(812) 555-0123',contactEmail:''}).message,null);
 assert.deepEqual(C.contactLinks({...restored,contactPhone:'javascript:alert(1)',contactEmail:'abc'}),
  {message:null,text:null,call:null});
 assert.deepEqual(C.contactPresentation(restored),
  {mode:'preview',email:'seller@example.com',phone:'(812) 555-0123',hasMethods:true});
 assert.deepEqual(C.contactPresentation({...restored,status:'sold'}),
  {mode:'sold',email:'',phone:'',hasMethods:false});
 assert.deepEqual(C.contactPresentation({...restored,sample:true}),
  {mode:'sample',email:'',phone:'',hasMethods:false});
 assert.deepEqual(C.contactPresentation({...restored,status:'draft'}),
  {mode:'draft',email:'',phone:'',hasMethods:false});
 assert.equal(C.contactPresentation({...restored,contactEmail:'',contactPhone:''}).hasMethods,false);
 assert.ok(C.validate({...d,contactEmail:'test@example.com\r\nBcc:bad@example.com'}).errors.contactEmail);
 assert.ok(C.validate({...d,contactPhone:'javascript:alert(1)'}).errors.contactPhone);
 assert.equal(C.normalizeRecord({...d,contactEmail:'not-an-email'}).contactEmail,'');
});
test('vehicle facts group title, condition, body, trim below transmission and fuel',()=>{
 const src=read('marketplace-components.js');
 const summary=src.slice(src.indexOf('function detailsHeader'),src.indexOf('function conditionSection'));
 for(const item of ["['Transmission',transmission]","['Fuel',fuel]","['Title',r.titleStatus?C.titleStatusLabel(r.titleStatus):null]","['Condition',r.condition?C.conditionLabel(r.condition):null]","['Body',r.vehicle.body]","['Trim',r.vehicle.trim]"])assert.ok(summary.includes(item));
 assert.ok(summary.indexOf("['Title'")>summary.indexOf("['Fuel'"));
 const specs=src.slice(src.indexOf('function vehicleSpecs'),src.indexOf('function loadedDisclosure'));
 assert.ok(!specs.includes("['Body'")&&!specs.includes("['Trim'"));
 assert.ok(!src.includes("section('Seller',identity)"));
 assert.ok(src.includes("const contact=C.contactPresentation(r)"));
 assert.ok(src.includes("'Private preview · Only on this device. This listing is not public.'"));
 assert.ok(src.includes("'#edit/'+encodeURIComponent(r.id)+'/contacts'"));
 assert.ok(src.includes("'Contact seller'"));
 assert.ok(src.includes("'Email seller',channels.message"));
 assert.ok(src.includes("'Text seller',channels.text"));
 assert.ok(src.includes("'Call seller',channels.call"));
 assert.ok(src.includes("id:'market-seller-contact'"));
 assert.ok(src.includes("'On a real listing, you can contact the seller by email, text, or phone when they provide those details.'"));
 assert.ok(src.includes("'This is an example vehicle. There is no real seller to contact.'"));
 assert.ok(src.includes("'Example vehicle · Contact options shown for demonstration only'"));
 assert.ok(src.includes("class:'market-contact-demo-methods'"));
 assert.ok(!src.includes("link('Message seller'"));
 assert.ok(read('marketplace.js').includes("if(index==='contacts')requestAnimationFrame"));
 assert.ok(read('marketplace.js').includes("id:'market-seller-contacts'"));
 const app=read('marketplace.js');
 assert.ok(app.includes("makeContact('contactEmail','Contact email'"));
 assert.ok(app.includes("makeContact('contactPhone','Contact phone'"));
 assert.ok(app.includes("function saveContacts(){"));
 assert.ok(app.includes("if(!seller.saveContacts())"));
 assert.ok(app.includes("Contact details saved on this device. Not published."));
 assert.ok(app.includes("if(saveContacts()&&location.hash.endsWith('/contacts'))"));
 assert.ok(app.includes("r.status==='draft'?'Preview listing':'Save changes'"));
 assert.ok(app.includes("record.contactEmail=previous.email")===false);
 assert.ok(app.includes("[record.contactEmail,record.contactPhone,record.updatedAt]=prev"));
 assert.ok(!app.includes("makeInput(record,'contactEmail'"));
});
test('mobile navigation uses icons and listing management is in Account',()=>{
 const html=read('marketplace.html');
 const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
 const anchors=[...nav.matchAll(/<a\s+[^>]*data-nav="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
 assert.deepEqual(anchors.map(match=>match[1]),['browse','saved','new','profile']);
 for(const [,key,contents] of anchors){
  if(key==='new'){
   assert.ok(contents.includes('Sell a car'));
   assert.ok(contents.includes('<svg'));
  }else{
   assert.ok(contents.includes('<svg'));
   assert.ok(!/<span/.test(contents));
  }
 }
 assert.ok(nav.includes('aria-label="Account and sign in"'));
 assert.ok(nav.includes('aria-label="Sell a car"'));
 assert.ok(html.includes('class="market-account-listings"'));
 assert.ok(read('marketplace.css').includes('.market-links a.market-sell span{display:none}'));
 assert.ok(html.includes('<h1 class="market-heading">Account</h1>'));
 assert.ok(html.includes("Accounts aren't available in this private preview."));
 const css=read('marketplace.css'),shared=read('styles.css'),scanner=read('app.js');
 assert.match(css,/\.market-links\{display:grid;/);
 assert.match(css,/\.market-nav-search\{[^}]*display:grid;/);
 assert.match(css,/\.market-card\{min-width:0;display:grid;/);
 assert.match(css,/\.market-detail-price-row\{display:grid;/);
 assert.match(css,/\.market-avatar-actions,\.market-seller-row\{display:grid;/);
 assert.match(shared,/--space-1:4px;--space-2:8px;--space-3:12px;/);
 assert.match(shared,/\.wrap\{[^}]*display:grid;/);
 assert.ok(scanner.includes("class:'card-row'"));
 assert.ok(!scanner.includes("style:'display:flex;align-items:center'"));
});
test('search ranks multiple terms and supports year, price and sorting without sold listings',()=>{
 const results=C.searchListings(samples,'Toyota Camry');
 assert.equal(results.length,1);
 assert.equal(results[0].id,'sample-camry');
 assert.equal(C.searchListings(samples,'2022 Toyota').length,1);
 assert.equal(C.searchListings(samples,'under $20000').every(r=>C.cents(r.price)<=2000000),true);
 assert.equal(C.searchListings(samples,'Electric')[0].id,'sample-ioniq-5');
 assert.deepEqual(C.searchListings(samples,'something-impossible'),[]);
 assert.equal(C.searchListings(samples,'', 'price-asc')[0].price<=C.searchListings(samples,'','price-desc')[0].price,true);
 assert.ok(!C.searchListings([...samples,{...samples[0],id:'sold',status:'sold'}]).some(r=>r.id==='sold'));
 const frontend=read('marketplace.js'),html=read('marketplace.html');
 assert.ok(frontend.includes('C.searchListings(items,query,sort.value,browseType)'));
 assert.ok(frontend.includes('history.replaceState'));
 assert.ok(frontend.includes('grid.append(...ordered)'));
 assert.ok(html.includes('data-slot="sort"'));
});
test('search hides private statuses and VIN queries from URLs without blocking normal terms',()=>{
 const preview={...draft(),id:'preview',status:'preview'};
 const active={...draft(),id:'active',status:'active'};
 const removed={...draft(),id:'removed',status:'removed'};
 const pending={...draft(),id:'pending',status:'pending_review'};
 assert.deepEqual(C.searchListings([preview,active,removed,pending]).map(x=>x.id),['preview','active']);
 assert.equal(C.containsVinLikeQuery('Mercedes GLC300 2016'),false);
 assert.equal(C.containsVinLikeQuery('Toyota Camry 2022'),false);
 assert.equal(C.containsVinLikeQuery('WDC0G4KB8GF018636'),true);
 assert.equal(C.containsVinLikeQuery('WDC0G4KB'),true);
 assert.equal(C.containsVinLikeQuery('under $20k'),false);
 assert.equal(C.searchListings(samples,'under $20k').length,2);
 assert.equal(C.searchListings(samples,'2022 Toyota Camry')[0].id,'sample-camry');
 const frontend=read('marketplace.js');
 assert.ok(frontend.includes('!C.containsVinLikeQuery(query)'));
});
test('vehicle type filters reflect the visible inventory and compose with search and sort',()=>{
 const types=C.availableSearchTypes(samples).map(x=>x.value);
 assert.deepEqual(types,['all','suv','truck','passenger','van','electric']);
 assert.deepEqual(C.availableSearchTypes([]).map(x=>x.value),['all']);
 assert.deepEqual(C.availableSearchTypes([{
  ...samples[1],id:'sold-only',status:'sold'
 }]).map(x=>x.value),['all']);
 assert.equal(C.searchListings(samples,'','relevant','truck').length,1);
 assert.equal(C.searchListings(samples,'Ford','relevant','truck')[0].id,'sample-f-150');
 assert.equal(C.searchListings(samples,'Ford','relevant','electric').length,0);
 assert.equal(C.searchListings(samples,'','relevant','electric')[0].id,'sample-ioniq-5');
 assert.equal(C.searchListings(samples,'Toyota','relevant','passenger')[0].id,'sample-camry');
 assert.deepEqual(C.searchListings(samples,'','relevant','invalid'),[]);
 const script=read('marketplace.js'),html=read('marketplace.html');
 assert.ok(script.includes('C.availableSearchTypes(items)'));
 assert.ok(script.includes('C.searchListings(items,query,sort.value,browseType)'));
 assert.ok(script.includes("url.searchParams.set('type',browseType)"));
 assert.ok(html.includes('data-slot="types" role="group" aria-label="Vehicle type"'));
 assert.ok(read('marketplace.css').includes('.market-type-filters{display:grid;'));
});
test('staged backend search is read only, RLS-invoker and excludes private VIN data',()=>{
 const sql=read('supabase/market_search_public_staged.sql');
 assert.ok(sql.includes('security invoker'));
 assert.ok(sql.includes("l.status='active' and l.deleted_at is null"));
 assert.ok(sql.includes("websearch_to_tsquery"));
 assert.ok(sql.includes('create index if not exists market_listings_public_search_fts'));
 assert.ok(sql.includes('limit greatest(1,least(coalesce(p_limit,20),50))'));
 assert.ok(!/market_vehicles\s+v|select\s+\*/i.test(sql));
 assert.ok(sql.includes('revoke all on function'));
 assert.ok(sql.includes("p_type text default 'all'"));
 assert.ok(sql.includes("when 'electric' then"));
 assert.ok(sql.includes("when 'truck' then"));
 assert.equal((sql.match(/create or replace function/g)||[]).length,1);
 assert.equal((sql.match(/\$function\$/g)||[]).length,2);
 assert.equal((sql.match(/revoke all on function/g)||[]).length,1);
 assert.equal((sql.match(/grant execute on function/g)||[]).length,1);
});
test('My Listings has one state model, recent-first ordering and accurate counts',()=>{
 const draftListing={...draft(),id:'11111111-1111-4111-8111-111111111111',status:'draft',updatedAt:'2026-11-15T09:00:00.000Z'};
 const available={...draft(),id:'22222222-2222-4222-8222-222222222222',status:'preview',updatedAt:'2026-11-16T12:00:00.000Z'};
 const sold={...draft(),id:'33333333-3333-4333-8333-333333333333',status:'sold',updatedAt:'2026-11-16T07:00:00.000Z'};
 const records=[draftListing,available,sold];
 assert.deepEqual(C.managedCounts(records),{all:3,draft:1,preview:1,sold:1});
 assert.deepEqual(C.managedCounts([]),{all:0,draft:0,preview:0,sold:0});
 assert.deepEqual(C.managedListings(records).map(r=>r.id),[available.id,sold.id,draftListing.id]);
 assert.deepEqual(C.managedListings(records,'draft').map(r=>r.id),[draftListing.id]);
 assert.deepEqual(C.managedListings(records,'preview').map(r=>r.id),[available.id]);
 assert.deepEqual(C.managedListings(records,'sold').map(r=>r.id),[sold.id]);
 assert.deepEqual(C.managedListings(records,'invalid'),[]);
 assert.equal(C.manageLabel(draftListing),'Draft');
 assert.equal(C.manageLabel(available),'Available');
 assert.equal(C.manageLabel(sold),'Sold');
 assert.deepEqual(C.MANAGE_FILTERS.map(x=>x.value),['all','draft','preview','sold']);
});
test('My Listings actions are contextual, reversible and preserve a private-only distinction',()=>{
 const app=read('marketplace.js'),html=read('marketplace.html'),css=read('marketplace.css');
 assert.ok(html.includes('class="market-my-listings"'));
 assert.ok(html.includes('data-slot="filters" role="group" aria-label="Listing status"'));
 assert.ok(html.includes('Private on this device'));
 assert.ok(app.includes("mineFilter=next;"));
 assert.ok(app.includes("C.managedListings(listings,mineFilter)"));
 assert.ok(app.includes("C.managedCounts(listings)"));
 assert.ok(app.includes("r.status=next;r.updatedAt=new Date().toISOString()"));
 assert.ok(app.includes("if(!persist()){r.status=prev;r.updatedAt=date;return;}"));
 assert.ok(app.includes("'Confirm sold'"));
 assert.ok(app.includes("'Confirm delete'"));
 assert.ok(app.includes("'Mark available'"));
 assert.ok(app.includes("'Continue draft'"));
 assert.ok(app.includes("'View listing'"));
 assert.ok(app.includes("hidden from Browse on this device"));
 assert.ok(css.includes('.market-my-grid{display:grid'));
 assert.ok(css.includes('.market-my-filter[aria-pressed="true"]'));
});
test('Account retains local seller profile and listing management',()=>{
 const nav=read('marketplace.html').match(/<nav[\s\S]*?<\/nav>/)[0];
 assert.deepEqual([...nav.matchAll(/data-nav="(\w+)"/g)].map(x=>x[1]),['browse','saved','new','profile']);
 const storage=memory();
 assert.deepEqual(C.readProfile(storage),{sellerName:'',sellerType:'private'});
 C.writeProfile(storage,{sellerName:'  Smoke Test Motors ',sellerType:'dealership'});
 assert.deepEqual(C.readProfile(storage),{sellerName:'Smoke Test Motors',sellerType:'dealership'});
 assert.throws(()=>C.writeProfile(storage,{sellerName:'<dealer>'}),/Enter a name/);
 assert.equal(C.readProfile(storage).sellerName,'Smoke Test Motors');
});
test('recent lookup and scanner results deduplicate full VINs for the selling form',()=>{
 const lookup=require('../vin-lookup.js'),storage=memory();
 const uppercase={...source,flat:{...source.flat,Make:'MERCEDES-BENZ'}};
 lookup.rememberVehicles(storage,[uppercase,{...source,vin:'BAD'},source,{...source,hasError:true}]);
 const recent=lookup.recentVehicles(storage);
 assert.equal(recent.length,1);
 assert.equal(C.pickVehicle(recent[0]).vin,source.vin);
 assert.equal(C.pickVehicle(recent[0]).model,'GLC-Class');
 assert.equal(C.pickVehicle(recent[0]).make,'Mercedes-Benz');
});
test('marketplace card metadata is short and card grid preserved',()=>{
 const html=read('marketplace.html');
 const source=read('marketplace-components.js');
 const card=source.slice(source.indexOf('function card(r,photoCarousel,save){'));
 assert.match(html,/data-slot="title"><\/a><\/div>\s*<p[^>]+data-slot="facts"><\/p>\s*<p[^>]+data-slot="location"/);
 assert.ok(card.includes('const mileage=C.mileage(r.mileage)'));
 assert.ok(card.includes('slots.location.textContent=r.place'));
 assert.ok(!card.includes('r.vehicle.transmission'));
 assert.ok(!card.includes('r.vehicle.drive'));
 assert.ok(card.includes("r.status==='sold'"));
 assert.match(html,/market-card-photo-link[^>]*>\s*<div class="market-card-overlay"[^>]*>\s*<span class="market-card-price-chip"/);
 const css=read('marketplace.css');
 assert.match(css,/\.market-card-title a\{[^}]*text-overflow:ellipsis;white-space:nowrap/);
 assert.match(css,/\.market-cards\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(min-width:1440px\)\{\.market-cards\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('Saved stores only unique listing IDs and stays separate from vehicle drafts',()=>{
 const storage=memory(),local=draft().id;
 C.write(storage,[draft()]);
 C.writeSaved(storage,['sample-camry',local,'sample-camry','https://example.com',null]);
 assert.deepEqual(C.readSaved(storage),['sample-camry',local]);
 assert.equal(C.read(storage).length,1);
 storage.setItem(C.SAVED_KEY,'{invalid}');
 assert.deepEqual(C.readSaved(storage),[]);
});

test('versioned marketplace resources match the service worker shell',()=>{
 const html=read('marketplace.html'),worker=read('sw.js');
 const revision=worker.match(/const VERSION='vinbox-v(\d+)'/)[1];
 for(const asset of ['styles.css','marketplace.css','marketplace-core.js','marketplace-components.js','marketplace-backup.js','marketplace.js']){
  assert.ok(html.includes(asset+'?v='+revision));
  assert.ok(worker.includes("'"+asset+"'"));
 }
 assert.ok(worker.includes('STATIC.has(url.pathname+url.search)'));
});
