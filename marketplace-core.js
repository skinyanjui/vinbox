/* VINBOX marketplace contracts — standalone, testable and storage-agnostic. */
(function(root){
'use strict';
const STORAGE_KEY='vinbox-marketplace-drafts-v1';
const MAX_DRAFTS=30, MAX_PHOTOS=12;
const VALID_TITLE=['clean','lien','salvage','rebuilt','unknown'];
const VALID_CONDITION=['excellent','good','fair','needs-work'];
function text(value,max=160){return String(value==null?'':value).normalize('NFKC').trim().slice(0,max);}
function vin(value){const v=text(value,25).toUpperCase();return /^[A-HJ-NPR-Z0-9]{17}$/.test(v)?v:null;}
function cents(value){const s=text(value,30).replace(/[$,\s]/g,'');if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)&&n>0&&n<=1000000000?n:null;}
function miles(value){const s=text(value,30).replace(/[,\s]/g,'');if(!/^\d{1,7}$/.test(s))return null;const n=Number(s);return n<=1500000?n:null;}
function location(value){const s=text(value,100);return s.length>=2&&s.length<=80&&!/[\r\n<>]/.test(s)?s:null;}
function postalCode(value){const v=text(value,20).trim();return /^\d{5}$/.test(v)?v:null;}
function postalPlace(zip,payload){
 if(!postalCode(zip)||!payload||payload['country abbreviation']!=='US'||String(payload['post code'])!==zip)return null;
 const list=Array.isArray(payload.places)?payload.places:[];
 const names=[];
 for(const item of list){
  const name=text(item?.['place name'],80),region=text(item?.['state abbreviation'],2).toUpperCase();
  if(!name||!/^[A-Z]{2}$/.test(region)||/[<>\r\n]/.test(name))continue;
  const label=name+', '+region;
  if(!names.includes(label))names.push(label);
 }
 return names.length?{zip,place:names[0],alternatives:names.slice(1)}:null;
}
function pickVehicle(it){
 if(!it||!it.decoded||it.hasError||!vin(it.vin))return null;
 const f=it.flat||{};
 const year=Number(f.ModelYear||it.year);if(!Number.isInteger(year)||year<1981||year>new Date().getFullYear()+2)return null;
 const make=text(f.Make||it.make,70),model=text(f.Model,90);
 if(!make||!model)return null;
 const trim=text(f.Trim,120),body=text(f.BodyClass,100),drive=text(f.DriveType,100),engine=text(f.DisplacementL,10),
   transmission=text(f.TransmissionStyle,70),fuel=text(f.FuelTypePrimary,70);
 return {vin:vin(it.vin),year,make,model,trim,body,drive,engine,transmission,fuel,
   title:text(it.title||[year,make,model,trim].filter(Boolean).join(' '),180)};
}
function fresh(vehicle){
 return {id:null,vehicle,status:'draft',price:'',mileage:'',place:'',postalCode:'',titleStatus:'',condition:'',
   knownIssues:'',description:'',authorized:false,photoIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function validate(record){
 const errors={};
 if(!record?.vehicle||!vin(record.vehicle.vin))errors.vehicle='Decode a valid full VIN first.';
 if(cents(record?.price)===null)errors.price='Enter an asking price greater than zero.';
 if(miles(record?.mileage)===null)errors.mileage='Enter the current odometer mileage.';
 if(!location(record?.place)||postalCode(record?.place))errors.place='Enter a city or town (ZIP codes are converted automatically).';
 if(!VALID_TITLE.includes(record?.titleStatus))errors.titleStatus='Select the current title status.';
 if(!VALID_CONDITION.includes(record?.condition))errors.condition='Choose the current vehicle condition.';
 if(!Array.isArray(record?.photoIds)||record.photoIds.length<1)errors.photos='Add at least one current photo.';
 if(record?.photoIds?.length>MAX_PHOTOS)errors.photos='Use at most 12 photos.';
 if(record?.authorized!==true)errors.authorized='Confirm that you are authorized to sell the vehicle.';
 return {valid:Object.keys(errors).length===0,errors};
}
function normalizeRecord(r){
 if(!r||!r.vehicle||!vin(r.vehicle.vin))return null;
 const photoIds=Array.isArray(r.photoIds)?[...new Set(r.photoIds.filter(x=>typeof x==='string'&&/^[a-f0-9-]{20,50}$/i.test(x)))].slice(0,MAX_PHOTOS):[];
 return {...fresh(r.vehicle),id:typeof r.id==='string'&&/^[a-f0-9-]{20,50}$/i.test(r.id)?r.id:null,
   vehicle:r.vehicle,status:['draft','preview','sold'].includes(r.status)?r.status:'draft',
   price:text(r.price,30),mileage:text(r.mileage,30),place:text(r.place,100),postalCode:postalCode(r.postalCode)||'',
   titleStatus:VALID_TITLE.includes(r.titleStatus)?r.titleStatus:'',
   condition:VALID_CONDITION.includes(r.condition)?r.condition:'',
   knownIssues:text(r.knownIssues,1200),description:text(r.description,3000),
   authorized:r.authorized===true,photoIds,createdAt:text(r.createdAt,40),updatedAt:text(r.updatedAt,40)};
}
function read(storage){
 try{const data=JSON.parse(storage.getItem(STORAGE_KEY)||'[]');return Array.isArray(data)?data.slice(0,MAX_DRAFTS).map(normalizeRecord).filter(Boolean):[]}
 catch{return []}
}
function write(storage,records){
 if(!Array.isArray(records)||records.length>MAX_DRAFTS)throw Error('Too many local listings (30 maximum).');
 storage.setItem(STORAGE_KEY,JSON.stringify(records.map(normalizeRecord).filter(Boolean)));
 return true;
}
function money(price){const n=cents(price);return n===null?'Price not set':(n/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});}
function mileage(value){const n=miles(value);return n===null?'Mileage not set':n.toLocaleString('en-US')+' mi';}
function displayTitle(record){const v=record.vehicle;return [v.year,v.make,v.model,v.trim].filter(Boolean).join(' ');}
const api={STORAGE_KEY,MAX_DRAFTS,MAX_PHOTOS,VALID_TITLE,VALID_CONDITION,text,vin,cents,miles,location,postalCode,postalPlace,pickVehicle,fresh,validate,normalizeRecord,read,write,money,mileage,displayTitle};
if(typeof module!=='undefined')module.exports=api;
root.VinboxMarketCore=api;
})(typeof window!=='undefined'?window:globalThis);
