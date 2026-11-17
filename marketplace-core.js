/* VINBOX marketplace contracts — standalone, testable and storage-agnostic. */
(function(root){
'use strict';
const STORAGE_KEY='vinbox-marketplace-drafts-v1';
const SAVED_KEY='vinbox-marketplace-saved-v1';
const PROFILE_KEY='vinbox-seller-profile-v1';
const MAX_DRAFTS=30, MAX_PHOTOS=12;
const MAX_SELLER_NAME=80;
const VALID_TITLE=['clean','salvage','rebuilt','unknown'];
const VALID_CONDITION=['excellent','good','fair','needs-work'];
const LIEN_OPTIONS=['yes','no','unknown'];
const ISSUE_OPTIONS=['listed','none','unknown'];
const FIELD_LIMITS=Object.freeze({exteriorColor:50,maintenance:600,stockNumber:40,knownIssues:1200,description:3000,contactEmail:254,contactPhone:30});
const EPA_FIELDS=['ElectrificationLevel','EngineCylinders','FuelTypeSecondary','TransmissionSpeeds','Turbo'];
function text(value,max=160){return String(value==null?'':value).normalize('NFKC').trim().slice(0,max);}
function localId(value){return typeof value==='string'&&/^[a-f0-9-]{20,50}$/i.test(value)?value:null;}
function sellerType(value){return value==='dealership'?'dealership':'private';}
function sellerName(value){
 const name=typeof value==='string'?text(value,MAX_SELLER_NAME+1):'';
 return name&&name.length<=MAX_SELLER_NAME&&!/[\u0000-\u001f\u007f<>]/.test(name)?name:'';
}
function contactEmail(value){
 const email=typeof value==='string'?value.trim():'';
 return email.length<=FIELD_LIMITS.contactEmail && /^[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(email)?email:'';
}
function contactPhone(value){
 const phone=typeof value==='string'?value.trim():'';
 const digits=phone.replace(/\D/g,'');
 return phone.length<=FIELD_LIMITS.contactPhone && /^\+?[0-9 ()-]+$/.test(phone) &&
  digits.length>=7 && digits.length<=15?phone:'';
}
function sellerInitials(value){
 return sellerName(value).split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toUpperCase();
}
function sellerProfile(record){
 return {sellerName:sellerName(record?.sellerName),sellerType:sellerType(record?.sellerType)};
}
function readProfile(storage){
 try{return sellerProfile(JSON.parse(storage.getItem(PROFILE_KEY)||'null'));}
 catch{return sellerProfile(null);}
}
function writeProfile(storage,record){
 const profile=sellerProfile(record);
 if(typeof record?.sellerName==='string'&&record.sellerName.trim()&&!profile.sellerName)
  throw new RangeError('Enter a name with up to 80 characters.');
 storage.setItem(PROFILE_KEY,JSON.stringify(profile));
 return profile;
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
 const make=text(it.make||f.Make,70),model=text(f.Model,90);
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
   sellerName:'',sellerType:'private',sellerAvatarId:null,contactEmail:'',contactPhone:'',
   knownIssues:'',description:'',authorized:false,photoIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function validate(record){
 const errors={};
 if(!record?.vehicle||!vin(record.vehicle.vin))errors.vehicle='Choose a vehicle with a full VIN.';
 if(cents(record?.price)===null)errors.price='Enter an asking price above zero.';
 if(miles(record?.mileage)===null)errors.mileage='Enter the mileage shown on the odometer.';
 if(postalCode(record?.place))errors.place='Enter the city for this ZIP code.';
 else if(!location(record?.place))errors.place='Enter a city or ZIP code.';
 if(!VALID_TITLE.includes(record?.titleStatus))errors.titleStatus='Choose the title status.';
 if(!VALID_CONDITION.includes(record?.condition))errors.condition='Choose the vehicle condition.';
 if(record&&issuesStatus(record)==='listed'&&!text(record.knownIssues))errors.knownIssues='Describe the known issues.';
 if(record?.sellerType==='dealership'&&text(record.dealerFee)&&amountCents(record.dealerFee)===null)
  errors.dealerFee='Enter an amount in dollars, or leave this blank.';
 if(!sellerName(record?.sellerName))errors.sellerName='Enter a seller name using up to '+MAX_SELLER_NAME+' characters.';
 if(record?.contactEmail && !contactEmail(record.contactEmail))errors.contactEmail='Enter a valid email address, or leave it blank.';
 if(record?.contactPhone && !contactPhone(record.contactPhone))errors.contactPhone='Enter a phone number with 7–15 digits, or leave it blank.';
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
   contactEmail:contactEmail(r.contactEmail),contactPhone:contactPhone(r.contactPhone),
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
function searchText(value){
 return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function containsVinLikeQuery(query){
 const tokens=String(query??'').toUpperCase().match(/[A-Z0-9]{1,30}/g)||[];
 return tokens.some(token=>/^[A-HJ-NPR-Z0-9]{8,17}$/.test(token)
  && (token.length===17||((token.match(/[0-9]/g)||[]).length>=2&&(token.match(/[A-HJ-NPR-Z]/g)||[]).length>=2)));
}
function searchQuery(input){
 const raw=String(input??'').slice(0,120);
 const constraints={minPrice:null,maxPrice:null,year:null,terms:[]};
 const pricePattern=/\b(under|below|less than|up to|max|over|above|more than|min)\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(k)?\b/gi;
 let textOnly=raw.replace(pricePattern,(match,op,amount,k)=>{
  const dollars=Number(amount.replace(/,/g,''))*(k?1000:1);
  if(!Number.isFinite(dollars)||dollars<=0||dollars>10000000)return match;
  const cents=Math.round(dollars*100);
  if(/under|below|less than|up to|max/i.test(op))constraints.maxPrice=cents;
  else constraints.minPrice=cents;
  return ' ';
 });
 const year=textOnly.match(/(?:^|\s)(19[8-9]\d|20[0-9]\d)(?=\s|$)/);
 if(year){
  constraints.year=Number(year[1]);
  textOnly=textOnly.replace(year[1],' ');
 }
 const matches=textOnly.match(/"[^"]{1,120}"|\S+/g)||[];
 constraints.terms=matches.map(x=>searchText(x)).filter(Boolean).slice(0,12);
 return constraints;
}
function searchListings(inventory,query='',sort='relevant'){
 if(!Array.isArray(inventory))return [];
 const parsed=searchQuery(query);
 const results=[];
 for(let index=0;index<inventory.length;index++){
  const record=inventory[index];
  if(!record?.vehicle||(!record.sample&&!['preview','active'].includes(record.status))||record.status==='sold')continue;
  const v=record.vehicle,price=cents(record.price);
  if(parsed.minPrice!==null&&(price===null||price<parsed.minPrice))continue;
  if(parsed.maxPrice!==null&&(price===null||price>parsed.maxPrice))continue;
  if(parsed.year!==null&&Number(v.year)!==parsed.year)continue;
  const title=searchText(displayTitle(record));
  const make=searchText(v.make),model=searchText(v.model);
  const city=searchText(record.place);
  const vinCode=searchText(v.vin);
  const fields=[title,make,model,city,vinCode,searchText(v.body),searchText(v.trim),
   searchText(v.fuel),searchText(v.drive),searchText(v.transmission),searchText(record.sellerName),
   searchText(record.exteriorColor),searchText(conditionLabel(record.condition)),
   searchText(titleStatusLabel(record.titleStatus))].filter(Boolean);
  let score=0,match=true;
  for(const term of parsed.terms){
   const hit=fields.findIndex(x=>x===term||x.split(' ').includes(term)||x.startsWith(term+' ')||x.includes(' '+term+' ')||x.includes(term));
   if(hit<0){match=false;break;}
   score+=hit===0?12:hit<=2?9:hit===3?7:hit===4?10:2;
   if(title===term||model===term)score+=8;
  }
  if(!match)continue;
  results.push({record,index,score,price:price??Infinity,mileage:miles(record.mileage)??Infinity,year:Number(v.year)||0});
 }
 const sorters={
  'price-asc':(a,b)=>a.price-b.price,
  'price-desc':(a,b)=>b.price-a.price,
  'mileage-asc':(a,b)=>a.mileage-b.mileage,
  newest:(a,b)=>b.year-a.year
 };
 const compare=Object.hasOwn(sorters,sort)?sorters[sort]:(a,b)=>b.score-a.score;
 results.sort((a,b)=>compare(a,b)||a.index-b.index);
 return results.map(x=>x.record);
}
function bodyGroup(value){
 const body=text(value,100).toLowerCase();
 if(/pickup|truck/.test(body))return 'truck';
 if(/crossover|sport utility|\bsuv\b|off-road|multi-purpose/.test(body))return 'suv';
 if(/minivan|\bvan\b/.test(body))return 'van';
 if(/sedan|hatchback|wagon|liftback|coupe|convertible|roadster/.test(body))return 'passenger';
 return '';
}
// Score visible, available vehicles using comparable, known facts.
function similarListings(current,inventory,limit=4){
 if(!current?.vehicle||!Array.isArray(inventory)||!Number.isInteger(limit)||limit<=0)return [];
 const vehicle=current.vehicle,group=bodyGroup(vehicle.body);
 const make=text(vehicle.make).toLowerCase(),model=text(vehicle.model).toLowerCase();
 const fuel=text(vehicle.fuel).toLowerCase(),drive=text(vehicle.drive).toLowerCase();
 const year=Number(vehicle.year),price=cents(current.price),distance=miles(current.mileage);
 const results=[];
 for(const listing of inventory){
  if(!listing?.id||listing.id===current.id||!listing.vehicle||
   (!listing.sample&&!['preview','active'].includes(listing.status)))continue;
  const v=listing.vehicle;
  let score=0;
  const sameMake=make&&text(v.make).toLowerCase()===make;
  if(sameMake)score+=24;
  if(sameMake&&model&&text(v.model).toLowerCase()===model)score+=40;
  const otherGroup=bodyGroup(v.body);
  // Price alone must not make a van or truck "similar" to a sedan.
  if(group&&otherGroup&&group!==otherGroup&&
   !(sameMake&&model&&text(v.model).toLowerCase()===model))continue;
  if(group&&otherGroup&&group===otherGroup)score+=23;
  if(vehicle.body&&v.body&&text(vehicle.body).toLowerCase()===text(v.body).toLowerCase())score+=17;
  if(fuel&&text(v.fuel).toLowerCase()===fuel)score+=7;
  if(drive&&text(v.drive).toLowerCase()===drive)score+=5;
  const yearDelta=Math.abs(year-Number(v.year));
  if(Number.isFinite(yearDelta)&&Number.isInteger(year)&&Number.isInteger(Number(v.year))){
   if(yearDelta<=2)score+=12;
   else if(yearDelta<=5)score+=6;
  }
  const otherPrice=cents(listing.price);
  const priceDelta=price!==null&&otherPrice!==null?Math.abs(price-otherPrice):Infinity;
  if(price!==null&&otherPrice!==null){
   if(priceDelta*100<=price*15)score+=20;
   else if(priceDelta*100<=price*35)score+=10;
  }
  const otherDistance=miles(listing.mileage);
  if(distance!==null&&otherDistance!==null){
   const milesApart=Math.abs(distance-otherDistance);
   if(milesApart<=25000)score+=6;
   else if(milesApart<=60000)score+=3;
  }
  if(current.place&&listing.place&&text(current.place).toLowerCase()===text(listing.place).toLowerCase())score+=4;
  results.push({listing,score,priceDelta});
 }
 results.sort((a,b)=>b.score-a.score||a.priceDelta-b.priceDelta||
  String(a.listing.id).localeCompare(String(b.listing.id)));
 const unique=new Set(),vins=new Set(),currentVin=vin(vehicle.vin);
 if(currentVin)vins.add(currentVin);
 const output=[];
 for(const result of results){
  const {listing}=result,otherVin=vin(listing.vehicle.vin);
  if(unique.has(listing.id)||(otherVin&&vins.has(otherVin)))continue;
  unique.add(listing.id);
  if(otherVin)vins.add(otherVin);
  output.push(listing);
  if(output.length===Math.min(limit,12))break;
 }
 return output;
}
function contactLinks(record){
 if(record?.sample||record?.status==='sold'||record?.status==='draft')return {message:null,text:null,call:null};
 const email=contactEmail(record?.contactEmail),phone=contactPhone(record?.contactPhone);
 const number=phone.replace(/[^+\d]/g,'');
 const vehicle=displayTitle(record);
 const subject='Question about '+vehicle;
 const body='Hi, is your '+vehicle+' still available?';
 return {
  message:email?'mailto:'+email+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body):null,
  text:phone?'sms:'+number+'?body='+encodeURIComponent(body):null,
  call:phone?'tel:'+number:null
 };
}
const api={STORAGE_KEY,SAVED_KEY,MAX_DRAFTS,MAX_PHOTOS,MAX_SELLER_NAME,VALID_TITLE,VALID_CONDITION,FIELD_LIMITS,text,vin,cents,amountCents,miles,location,postalCode,postalPlace,pickVehicle,epaInput,issuesStatus,fresh,validate,normalizeRecord,read,write,readSaved,writeSaved,readProfile,writeProfile,money,moneyFromCents,mileage,titleStatusLabel,conditionLabel,saleStatus,displayTitle,sellerInitials,contactEmail,contactPhone,contactLinks,similarListings,searchQuery,searchListings,containsVinLikeQuery};
if(typeof module!=='undefined')module.exports=api;
root.VinboxMarketCore=api;
})(typeof window!=='undefined'?window:globalThis);
