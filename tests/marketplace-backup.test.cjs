'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const C=require('../marketplace-core.js');
const B=require('../marketplace-backup.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const photo='a0000000-0000-4000-8000-000000000001';
const seller='a0000000-0000-4000-8000-000000000002';
const id='b0000000-0000-4000-8000-000000000001';
const jpeg={id:photo,data:'data:image/jpeg;base64,/9j/AAAA'};
function record(){
 const v={vin:'WDC0G4KB8GF018636',year:2016,make:'Mercedes-Benz',model:'GLC-Class',trim:'GLC300'};
 return {...C.fresh(v),id,photoIds:[photo],sellerAvatarId:seller,price:'14900',mileage:'92400',
  place:'Evansville, IN',sellerName:'Test Seller',titleStatus:'clean',condition:'good',authorized:true};
}
function archive(records=[record()],photos=[jpeg,{id:seller,data:jpeg.data}]){
 return {format:B.FORMAT,version:B.VERSION,createdAt:'2026-11-17T01:00:00Z',
  listings:records,photos,saved:[id,'sample-camry'],profile:{sellerName:'Test Seller',sellerType:'private'}};
}
test('full device backup includes listings, photos, favorites and seller profile',()=>{
 const data=archive(),json=B.createBackup(data.listings,data.saved,data.profile,data.photos);
 const parsed=B.parseBackup(json);
 assert.equal(parsed.listings.length,1);
 assert.equal(parsed.photos.size,2);
 assert.deepEqual(parsed.saved,[id,'sample-camry']);
 assert.equal(parsed.profile.sellerName,'Test Seller');
 const plan=B.planRestore([],parsed);
 assert.equal(plan.added.length,1);
 assert.equal(plan.skipped.length,0);
 assert.deepEqual(plan.photoIds,[photo,seller]);
 assert.deepEqual(plan.saved,[id,'sample-camry']);
});
test('backup import merges repeated VINs and IDs without overwriting existing data',()=>{
 const imported=B.parseBackup(JSON.stringify(archive()));
 const existing={...record(),id:'b0000000-0000-4000-8000-000000000009',sellerName:'Current owner',photoIds:[],sellerAvatarId:null};
 const plan=B.planRestore([existing],imported);
 assert.equal(plan.added.length,0);
 assert.equal(plan.skipped.length,1);
 assert.deepEqual(plan.photoIds,[]);
 assert.deepEqual(plan.saved,[existing.id,'sample-camry']);
 assert.equal(existing.sellerName,'Current owner');
 assert.deepEqual(B.planRestore([record()],imported).added,[]);
});
test('invalid backups are rejected before any data is changed',()=>{
 const corruptions=[
  '{}',
  'not json',
  JSON.stringify({...archive(),version:99}),
  JSON.stringify({...archive(),photos:[jpeg]}),
  JSON.stringify({...archive(),photos:[{...jpeg,data:'data:text/html;base64,PHNjcmlwdD4='},{id:seller,data:jpeg.data}]}),
  JSON.stringify({...archive(),listings:[record(),record()]}),
  JSON.stringify({...archive(),profile:{sellerName:'<script>',sellerType:'private'}})
 ];
 for(const content of corruptions)assert.throws(()=>B.parseBackup(content));
});
test('restore enforces capacity before saving photos or mutating local storage',()=>{
 const parsed=B.parseBackup(JSON.stringify(archive()));
 const existing=Array.from({length:30},(_,index)=>({...record(),
  id:'f0000000-0000-4000-8000-'+String(index).padStart(12,'0'),
  vehicle:{...record().vehicle,vin:'1HGCM82633A'+String(index).padStart(6,'0')}}));
 assert.throws(()=>B.planRestore(existing,parsed),/30 local listings/);
});
test('backup is only accessed through Account and never uploads files to a server',()=>{
 const script=read('marketplace.js'),html=read('marketplace.html');
 assert.ok(html.includes('marketplace-backup.js?v='));
 assert.ok(html.includes('market-backup-review'));
 assert.ok(html.includes('Restore to this device'));
 assert.ok(script.includes('B.createBackup('));
 assert.ok(script.includes('B.parseBackup(await file.text())'));
 assert.ok(script.includes('await photoOp(\'put\',newId'));
 assert.ok(script.includes('await Promise.allSettled(written.map('));
 assert.ok(!/fetch\([^\n]*(?:backup|restore)/i.test(script));
});
