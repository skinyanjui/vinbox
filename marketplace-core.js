/* VINBOX marketplace contracts — standalone, testable and storage-agnostic. */
(function(root){
'use strict';
const STORAGE_KEY='vinbox-marketplace-drafts-v1';
const SAVED_KEY='vinbox-marketplace-saved-v1';
const MAX_DRAFTS=30, MAX_PHOTOS=12;
const MAX_SELLER_NAME=80;
const VALID_TITLE=['clean','salvage','rebuilt','unknown'];
const VALID_CONDITION=['excellent','good','fair','needs-work'];
const LIEN_OPTIONS=['yes','no','unknown'];
const ISSUE_OPTIONS=['listed','none','unknown'];
const FIELD_LIMITS=Object.freeze({exteriorColor:50,maintenance:600,stockNumber:40,knownIssues:1200,description:3000});
const EPA_FIELDS=['ElectrificationLevel','EngineCylinders','FuelTypeSecondary','TransmissionSpeeds','Turbo'];
function text(value,max=160){return String(value==null?'':value).normalize('NFKC').trim().slice(0,max);}
function localId(value){return typeof value==='string'&&/^[a-f0-9-]{20,50}$/i.test(value)?value:null;}
function sellerType(value){return value==='dealership'?'dealership':'private';}
function sellerName(value){
 const name=typeof value==='string'?text(value,MAX_SELLER_NAME+1):'';
 return name&&name.length<=MAX_SELLER_NAME&&!/[\u0000-\u001f\u007f<>]/.test(name)?name:'';
}
function sellerInitials(value){
 return sellerName(value).split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toUpperCase();
}
function vin(value){const v=text(value,25).toUpperCase();return /^[A-HJ-NPR-Z0-9]{17}$/.test(v)?v:null;}
function amountCents(value){const s=text(value,30).replace(/[$,\s]/g,'');if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return n<=1000000000?n:null;}
function cents(value){return amountCents(value)||null;}
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
 const epaFields=Object.fromEntries(EPA_FIELDS.map(key=>[key,text(f[key],80)]).filter(([,value])=>value));
 return {vin:vin(it.vin),year,make,model,trim,body,drive,engine,transmission,fuel,
   epaFields,title:text(it.title||[year,make,model,trim].filter(Boolean).join(' '),180)};
}
function epaInput(vehicle){
 const supplemental=Object.fromEntries(EPA_FIELDS.map(key=>[key,text(vehicle.epaFields?.[key],80)]));
 return {year:vehicle.year,decoded:true,flat:{ModelYear:vehicle.year,Make:vehicle.make,Model:vehicle.model,
  Trim:vehicle.trim,BodyClass:vehicle.body,DriveType:vehicle.drive,DisplacementL:vehicle.engine,
  TransmissionStyle:vehicle.transmission,FuelTypePrimary:vehicle.fuel,...supplemental}};
}
function issuesStatus(record){
 if(ISSUE_OPTIONS.includes(record.issuesStatus))return record.issuesStatus;
 return text(record.knownIssues)?'listed':'unknown';
}
function fresh(vehicle){
 return {id:null,vehicle,status:'draft',price:'',mileage:'',place:'',postalCode:'',titleStatus:'',condition:'',
   lienStatus:'',issuesStatus:'',exteriorColor:'',maintenance:'',stockNumber:'',dealerFee:'',
   sellerName:'',sellerType:'private',sellerAvatarId:null,
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
 if(record&&issuesStatus(record)==='listed'&&!text(record.knownIssues))errors.knownIssues='Describe the known issues.';
 if(record?.sellerType==='dealership'&&text(record.dealerFee)&&amountCents(record.dealerFee)===null)
  errors.dealerFee='Enter an amount in dollars, or leave this blank.';
 if(!sellerName(record?.sellerName))errors.sellerName='Enter a seller name using up to '+MAX_SELLER_NAME+' characters.';
 if(!Array.isArray(record?.photoIds)||record.photoIds.length<1)errors.photos='Add at least one current photo.';
 if(record?.photoIds?.length>MAX_PHOTOS)errors.photos='Use at most 12 photos.';
 if(record?.authorized!==true)errors.authorized='Confirm that you are authorized to sell the vehicle.';
 return {valid:Object.keys(errors).length===0,errors};
}
function normalizeRecord(r){
 if(!r||!r.vehicle||!vin(r.vehicle.vin))return null;
 const photoIds=Array.isArray(r.photoIds)?[...new Set(r.photoIds.filter(localId))].slice(0,MAX_PHOTOS):[];
 const avatarId=localId(r.sellerAvatarId);
 const dealer=sellerType(r.sellerType)==='dealership';
 const issue=issuesStatus(r);
 return {...fresh(r.vehicle),id:localId(r.id),
   vehicle:r.vehicle,status:['draft','preview','sold'].includes(r.status)?r.status:'draft',
   price:text(r.price,30),mileage:text(r.mileage,30),place:text(r.place,100),postalCode:postalCode(r.postalCode)||'',
   titleStatus:r.titleStatus==='lien'?'unknown':VALID_TITLE.includes(r.titleStatus)?r.titleStatus:'',
   lienStatus:r.titleStatus==='lien'?'yes':LIEN_OPTIONS.includes(r.lienStatus)?r.lienStatus:'',
   issuesStatus:issue,exteriorColor:text(r.exteriorColor,FIELD_LIMITS.exteriorColor),
   maintenance:text(r.maintenance,FIELD_LIMITS.maintenance),
   stockNumber:dealer?text(r.stockNumber,FIELD_LIMITS.stockNumber):'',
   dealerFee:dealer?text(r.dealerFee,30):'',
   condition:VALID_CONDITION.includes(r.condition)?r.condition:'',
   sellerName:sellerName(r.sellerName),sellerType:sellerType(r.sellerType),
   sellerAvatarId:photoIds.includes(avatarId)?null:avatarId,
   knownIssues:issue==='listed'?text(r.knownIssues,FIELD_LIMITS.knownIssues):'',
   description:text(r.description,FIELD_LIMITS.description),
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
function listingIds(values){
 return Array.isArray(values)?[...new Set(values.filter(id=>
  typeof id==='string'&&(localId(id)||/^sample-[a-z0-9-]{1,35}$/.test(id))))]:[];
}
function readSaved(storage){
 try{return listingIds(JSON.parse(storage.getItem(SAVED_KEY)||'[]'));}
 catch{return [];}
}
function writeSaved(storage,ids){
 storage.setItem(SAVED_KEY,JSON.stringify(listingIds(ids)));
}
function moneyFromCents(n){return (n/100).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:n%100?2:0,maximumFractionDigits:2});}
function money(price){const n=cents(price);return n===null?'Price not set':moneyFromCents(n);}
function mileage(value){const n=miles(value);return n===null?'Mileage not set':n.toLocaleString('en-US')+' mi';}
const TITLE_LABELS=Object.freeze({clean:'Clean',salvage:'Salvage',rebuilt:'Rebuilt',unknown:'Not sure'});
const CONDITION_LABELS=Object.freeze({excellent:'Excellent',good:'Good',fair:'Fair','needs-work':'Needs work'});
function titleStatusLabel(value){return Object.hasOwn(TITLE_LABELS,value)?TITLE_LABELS[value]:'Not provided';}
function conditionLabel(value){return Object.hasOwn(CONDITION_LABELS,value)?CONDITION_LABELS[value]:'Not provided';}
function saleStatus(record){return record.sample?'Sample listing':record.status==='sold'?'Sold':record.status==='draft'?'Draft':'Private preview';}
function displayTitle(record){
 const v=record.vehicle;
 const model=text(v.model,90),trim=text(v.trim,120);
 let name=model;
 // VIN trim contains the actual badge when the model is a generic family.
 // Require the manufacturer's badge to start with the family exactly.
 const family=model.match(/^([A-Za-z0-9]+)[- ](?:Class|Series)$/i);
 const badge=trim.split(' ')[0];
 if(family&&badge&&badge.toLowerCase().startsWith(family[1].toLowerCase())&&
   /[0-9]/.test(badge.slice(family[1].length)))name=badge;
 // Don't repeat the same model designation as both Model and Trim.
 else if(trim){
  const leading=trim.toLowerCase();
  // Example: Model "Civic", Trim "Civic LX" -> "Civic LX", once.
  if(leading===model.toLowerCase())name=model;
  else if(leading.startsWith(model.toLowerCase()+' '))name=model+' '+trim.slice(model.length).trim();
  else if(!leading.startsWith(model.toLowerCase()))name=[model,trim].filter(Boolean).join(' ');
 }
 return [v.year,v.make,name].filter(Boolean).join(' ');
}
const api={STORAGE_KEY,SAVED_KEY,MAX_DRAFTS,MAX_PHOTOS,MAX_SELLER_NAME,VALID_TITLE,VALID_CONDITION,FIELD_LIMITS,text,vin,cents,amountCents,miles,location,postalCode,postalPlace,pickVehicle,epaInput,issuesStatus,fresh,validate,normalizeRecord,read,write,readSaved,writeSaved,money,moneyFromCents,mileage,titleStatusLabel,conditionLabel,saleStatus,displayTitle,sellerInitials};
if(typeof module!=='undefined')module.exports=api;
root.VinboxMarketCore=api;
})(typeof window!=='undefined'?window:globalThis);
