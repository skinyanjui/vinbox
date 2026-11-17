/* Portable VINBOX device backup. No network, storage, or server dependencies. */
(function(root){
'use strict';
const C=root.VinboxMarketCore;
const FORMAT='vinbox-marketplace-backup',VERSION=1;
const MAX_FILE=80*1024*1024,MAX_IMAGE=12*1024*1024;
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{20,50}$/i.test(id);
function normalized(list){
 if(!Array.isArray(list)||list.length>C.MAX_DRAFTS)throw Error('Backup exceeds the 30-listing limit.');
 const ids=new Set(),records=[];
 for(const raw of list){
  const r=C.normalizeRecord(raw);
  if(!r?.id||ids.has(r.id))throw Error('Backup contains an invalid or repeated listing ID.');
  ids.add(r.id);records.push(r);
 }
 return records;
}
function validImages(images,records){
 if(!Array.isArray(images))throw Error('Backup photos are missing.');
 const result=new Map(),required=new Set(records.flatMap(r=>[...r.photoIds,r.sellerAvatarId].filter(Boolean)));
 let bytes=0;
 for(const image of images){
  if(!validId(image?.id)||result.has(image.id)||typeof image.data!=='string'||
    !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image.data))
   throw Error('Backup contains an invalid or repeated photo.');
  const data=image.data.slice('data:image/jpeg;base64,'.length);
  const size=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
  if(size<=0||size>MAX_IMAGE)throw Error('A backup photo exceeds the supported size.');
  bytes+=size;
  if(bytes>MAX_FILE)throw Error('Backup photos exceed the supported size.');
  result.set(image.id,image.data);
 }
 for(const id of required)if(!result.has(id))throw Error('Backup is missing a vehicle photo or seller image.');
 return result;
}
function parseBackup(text){
 if(typeof text!=='string'||text.length>MAX_FILE*1.4)throw Error('Backup file is too large.');
 let payload;
 try{payload=JSON.parse(text)}catch{throw Error('Choose a valid VINBOX backup JSON file.');}
 if(payload?.format!==FORMAT||payload.version!==VERSION)
  throw Error('This file is not a supported VINBOX marketplace backup.');
 const records=normalized(payload.listings);
 const images=validImages(payload.photos,records);
 const saved=C.readSaved({getItem:()=>JSON.stringify(Array.isArray(payload.saved)?payload.saved:[])});
 const profile=payload.profile&&typeof payload.profile==='object'?payload.profile:{};
 const testStorage={setItem(){},getItem(){return null}};
 try{C.writeProfile(testStorage,{sellerType:profile.sellerType,sellerName:profile.sellerName||''});}
 catch{throw Error('Backup contains invalid seller details.');}
 return {listings:records,photos:images,saved,profile:{
  sellerType:profile.sellerType==='dealership'?'dealership':'private',
  sellerName:typeof profile.sellerName==='string'?profile.sellerName.trim():''},
  createdAt:typeof payload.createdAt==='string'?payload.createdAt:''};
}
function createBackup(listings,saved,profile,photos){
 const payload={format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),
  listings,saved,profile,photos};
 const json=JSON.stringify(payload);
 parseBackup(json);
 return json;
}
function planRestore(existing,backup){
 const records=normalized(existing),seen=new Set(records.map(r=>r.id));
 const vinIds=new Map(records.map(r=>[C.vin(r.vehicle.vin),r.id]));
 const added=[],skipped=[],idMap=new Map();
 for(const r of backup.listings){
  const matching=seen.has(r.id)?r.id:vinIds.get(C.vin(r.vehicle.vin));
  if(matching){idMap.set(r.id,matching);skipped.push(r.id);continue;}
  added.push(r);seen.add(r.id);vinIds.set(C.vin(r.vehicle.vin),r.id);idMap.set(r.id,r.id);
 }
 if(records.length+added.length>C.MAX_DRAFTS)
  throw Error('Not enough space for these listings. VINBOX supports 30 local listings.');
 const validSaved=new Set([...seen,...backup.saved.filter(id=>/^sample-[a-z0-9-]{1,35}$/.test(id))]);
 const saved=backup.saved.map(id=>idMap.get(id)||id).filter(id=>validSaved.has(id));
 const photoIds=[...new Set(added.flatMap(r=>[...r.photoIds,r.sellerAvatarId].filter(Boolean)))];
 return {added,skipped,saved,photoIds};
}
const api={FORMAT,VERSION,MAX_FILE,parseBackup,createBackup,planRestore};
if(typeof module!=='undefined')module.exports=api;
root.VinboxMarketBackup=api;
})(typeof window!=='undefined'?window:globalThis);
