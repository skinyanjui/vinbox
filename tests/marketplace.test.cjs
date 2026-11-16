'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../marketplace-core.js');
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
test('listing requires price, mileage, city, disclosures, authorization and a photo',()=>{
 const d=C.fresh(C.pickVehicle(source));
 let v=C.validate(d);
 assert.equal(v.valid,false);
 for(const f of ['price','mileage','place','titleStatus','condition','photos','authorized'])assert.ok(v.errors[f]);
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
test('listing cards and vehicle page use public-preview wording without fake inventory',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes('Private preview'));
 assert.ok(s.includes('listings shown here exist only on this device'));
 assert.ok(s.includes('Messaging is not active')||s.includes('messaging is not active'));
 assert.ok(!s.includes('innerHTML='));
});
test('image processing resizes and re-encodes, with IndexedDB photo persistence',()=>{
 const s=read('marketplace.js');
 assert.ok(s.includes("indexedDB.open('vinbox-marketplace-photos'"));
 assert.ok(s.includes("canvas.toBlob"));
 assert.ok(s.includes("image/jpeg"));
 assert.ok(s.includes("1600/Math.max"));
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
 for(const filename of ['marketplace.css','marketplace-core.js','marketplace.js'])assert.ok(html.includes(filename));
 assert.ok(html.includes('href="./"'));
 assert.ok(!html.includes('cdn.')&&!html.includes('https://fonts.'));
});
test('PWA caches marketplace assets together with the scanner shell',()=>{
 const worker=read('sw.js');
 for(const file of ['marketplace.html','marketplace.css','marketplace-core.js','marketplace.js'])assert.ok(worker.includes("'"+file+"'"));
 assert.ok(worker.includes("vinbox-v16"));
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
