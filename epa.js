/* FuelEconomy.gov adapter. Proxied by Vercel at /api/epa.
   Only decoded year/make/model and EPA IDs, never full VINs, reach EPA. */
(function(root){
'use strict';
const ORIGIN='/api/epa',TTL=24*60*60*1000;
const MAX_QUEUE=40;
const cache=new Map(),pending=new Map(),queue=[];
let active=0;
const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const match=(value,items)=>items.filter(x=>normalized(x.value)===normalized(value)||normalized(x.text)===normalized(value));
function menuItems(data){
  const a=Array.isArray(data)?data:(data?.menuItems?.menuItem??data?.menuItem??data?.menuItems??[]);
  return (Array.isArray(a)?a:[a]).filter(x=>x&&typeof x==='object')
    .map(x=>({text:String(x.text??x.value??'').trim(),value:String(x.value??'').trim()}))
    .filter(x=>x.text&&x.value).slice(0,500);
}
function xmlData(raw){
  if(typeof DOMParser==='undefined')throw new Error('EPA returned XML instead of JSON');
  const xml=new DOMParser().parseFromString(raw,'application/xml');
  if(xml.querySelector('parsererror'))throw new Error('Invalid EPA response');
  const nodes=[...xml.documentElement.children];
  if(xml.documentElement.localName==='menuItems')
    return {menuItem:nodes.filter(n=>n.localName==='menuItem').map(item=>Object.fromEntries(
      [...item.children].map(n=>[n.localName,n.textContent||''])
    ))};
  return Object.fromEntries(nodes.map(n=>[n.localName,n.textContent||'']));
}
function parseResponse(raw){
  const value=raw.trim();
  if(value.startsWith('{')||value.startsWith('['))return JSON.parse(value);
  if(value.startsWith('<'))return xmlData(value);
  throw new Error('Unrecognized EPA response');
}
function schedule(job){
  if(queue.length>=MAX_QUEUE)return Promise.reject(new Error('Too many EPA requests. Try again shortly.'));
  return new Promise((resolve,reject)=>{queue.push({job,resolve,reject});drain();});
}
function drain(){
  while(active<3&&queue.length){
    const {job,resolve,reject}=queue.shift();active++;
    Promise.resolve().then(job).then(resolve,reject).finally(()=>{active--;drain();});
  }
}
async function request(path,fetchImpl=fetch){
  if(!/^\/(vehicle\/menu\/(make|model|options)|vehicle\/[0-9]+)(\?|$)/.test(path))
    throw new Error('Unsupported EPA endpoint');
  const url=ORIGIN+path;
  if(cache.has(url)){
    const hit=cache.get(url);
    if(hit.expires>Date.now())return hit.value;
    cache.delete(url);
  }
  if(pending.has(url))return pending.get(url);
  const task=schedule(async()=>{
    for(let i=0;i<2;i++){
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
      try{
        const r=await fetchImpl(url,{headers:{Accept:'application/json'},signal:ctrl.signal});
        if(!r.ok){
          if(i===0&&[429,502,503,504].includes(r.status)){
            const retryAfter=Number(r.headers?.get?.('Retry-After'));
            await new Promise(done=>setTimeout(done,Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter,5)*1000:700));
            continue;
          }
          throw new Error(r.status===404?'EPA record not found':'EPA service returned '+r.status);
        }
        const value=parseResponse(await r.text());
        cache.set(url,{value,expires:Date.now()+TTL});
        if(cache.size>120)cache.delete(cache.keys().next().value);
        return value;
      }catch(e){
        if(i===0&&(e.name==='AbortError'||e instanceof TypeError)){
          await new Promise(done=>setTimeout(done,700));continue;
        }
        throw e.name==='AbortError'?new Error('EPA request timed out'):e;
      }finally{clearTimeout(timer);}
    }
    throw new Error('EPA service unavailable');
  });
  pending.set(url,task);
  try{return await task;}finally{pending.delete(url);}
}
const query=(path,fields)=>path+'?'+new URLSearchParams(fields).toString();
async function makes(year,fetchImpl){
  return menuItems(await request(query('/vehicle/menu/make',{year}),fetchImpl));
}
async function models(year,make,fetchImpl){
  return menuItems(await request(query('/vehicle/menu/model',{year,make}),fetchImpl));
}
async function options(year,make,model,fetchImpl){
  return menuItems(await request(query('/vehicle/menu/options',{year,make,model}),fetchImpl))
    .filter(x=>/^[0-9]+$/.test(x.value)&&Number(x.value)>0);
}
function sameVehicle(decoded,record,allowedModel){
  const f=carFields(decoded);
  if(Number(record.year)!==f.year||match(f.make,[{text:record.make,value:record.make}]).length!==1)return false;
  const model=String(allowedModel||f.model);
  return !!model&&match(model,[{text:record.model,value:record.model}]).length===1;
}
function conflictsWithVin(it,record){
  const expected=Number(it.flat?.DisplacementL);
  const actual=Number(record.displ);
  if(expected>0&&actual>0&&Math.abs(expected-actual)>0.2)return true;
  const cyl=Number(it.flat?.EngineCylinders),epaCyl=Number(record.cylinders);
  if(cyl>0&&epaCyl>0&&cyl!==epaCyl)return true;
  const vinDrive=normalized(it.flat?.DriveType),epaDrive=normalized(record.drive);
  if(vinDrive&&epaDrive){
    const four=s=>/allwheel|4wheel|fourwheel|4wd|awd/.test(s);
    const two=s=>/frontwheel|rearwheel|2wheel|2wd|fwd|rwd/.test(s);
    if((four(vinDrive)&&two(epaDrive))||(two(vinDrive)&&four(epaDrive)))return true;
  }
  return false;
}
function carFields(it){
  return {
    year:Number(it.flat?.ModelYear||it.year),
    make:String(it.flat?.Make||it.make||'').trim(),
    model:String(it.flat?.Model||'').trim()
  };
}
async function discover(it,fetchImpl){
  const {year,make,model}=carFields(it);
  if(!Number.isInteger(year)||year<1984||year>new Date().getFullYear()+2||!make||!model)
    return {status:'unavailable',message:'EPA ratings require a US-market model year (1984 or newer), make and model.'};
  const foundMake=match(make,await makes(year,fetchImpl));
  if(foundMake.length!==1)return {status:'unavailable',message:'No matching EPA make for this model year.'};
  const actualMake=foundMake[0].value;
  const availableModels=await models(year,actualMake,fetchImpl);
  const foundModel=match(model,availableModels);
  const relevant=root.VinEpaMatch?.candidates(it,availableModels)||[];
  if(foundModel.length===1)return choices(year,actualMake,foundModel[0].value,fetchImpl);
  if(relevant.length===1)return choices(year,actualMake,relevant[0].value,fetchImpl);
  const displayed=relevant.length?relevant:availableModels;
  return {
    status:displayed.length?'choose-model':'unavailable',
    message:displayed.length?'Choose the model variation that matches your vehicle.':'No EPA models found for this make and year.',
    year,make:actualMake,models:displayed
  };
}
/* VIN-first EPA resolution. Fetch only a bounded set of plausible official
   records; no automatic choice when the VIN cannot distinguish variants. */
async function resolve(it,fetchImpl){
  const matcher=root.VinEpaMatch;
  if(!matcher)return discover(it,fetchImpl);
  const {year,make,model}=carFields(it);
  if(!Number.isInteger(year)||year<1984||year>new Date().getFullYear()+2||!make||!model)
    return {status:'unavailable',message:'EPA ratings need a supported model year, make and model.'};
  if(it.hasError||!it.decoded)return discover(it,fetchImpl);
  const foundMake=match(make,await makes(year,fetchImpl));
  if(foundMake.length!==1)return {status:'unavailable',message:'No EPA manufacturer match.'};
  const actualMake=foundMake[0].value;
  const possible=matcher.candidates(it,await models(year,actualMake,fetchImpl));
  const fallbackModels=possible.map(x=>({text:x.text,value:x.value}));
  if(!possible.length)return {status:'choose-model',year,make:actualMake,
    models:await models(year,actualMake,fetchImpl),
    message:'EPA uses a different model designation. Choose the equivalent model.'};
  const selectModel=()=>({
    status:'choose-model',year,make:actualMake,models:fallbackModels,
    message:'The VIN does not identify one EPA model version. Select the matching body or trim.'
  });
  if(possible.length>4)return selectModel();
  const optionSets=await Promise.all(possible.map(async m=>({
    model:m.value,options:(await options(year,actualMake,m.value,fetchImpl))
      .filter(option=>matcher.optionCompatible(it,option))
  })));
  const total=optionSets.reduce((n,m)=>n+m.options.length,0);
  if(!total)return {
    status:'unavailable',message:'No EPA configurations matched the decoded engine and transmission.'
  };
  const fallback=()=>{
    if(optionSets.length>1)return selectModel();
    const one=optionSets[0];
    return {status:'choose-option',year,make:actualMake,model:one.model,options:one.options,
      message:'The VIN cannot distinguish every EPA configuration.'};
  };
  // Rate-limit impact and time-to-result are bounded even on large vehicle
  // families (which can have hundreds of EPA engine/transmission choices).
  if(total>16)return fallback();
  const records=await Promise.allSettled(optionSets.flatMap(m=>
    m.options.map(o=>vehicle(o.value,fetchImpl).then(record=>({model:m.model,record})))));
  // An incomplete fetch cannot establish uniqueness: unseen records might
  // match equally well. Fall back to a choice instead of guessing.
  if(records.some(r=>r.status!=='fulfilled'))return fallback();
  const matched=matcher.uniqueMatch(it,records.map(r=>r.value));
  if(matched.status==='auto')return {...matched,year,make:actualMake};
  return fallback();
}
async function choices(year,make,model,fetchImpl){
  const found=await options(year,make,model,fetchImpl);
  if(!found.length)return {status:'unavailable',message:'EPA has no rated configurations for this model.',year,make,model};
  return {status:'choose-option',year,make,model,options:found};
}
async function vehicle(id,fetchImpl){
  const number=Number(id);
  if(!Number.isSafeInteger(number)||number<=0)throw new Error('Invalid EPA vehicle ID');
  const raw=await request('/vehicle/'+number,fetchImpl);
  if(!raw||Number(raw.id)!==number)throw new Error('EPA vehicle record does not match the selected ID');
  return raw;
}
const metric=x=>Number.isFinite(Number(x))&&Number(x)>0?Math.round(Number(x)):null;
function metrics(raw){
  const type=String(raw.atvType||raw.atvtype||'').toLowerCase(),fuel=String(raw.fuelType1||'');
  const electric=type==='ev'||(fuel.toLowerCase()==='electricity'&&type!=='plug-in hybrid');
  const bifuel=type.includes('bifuel');
  const equivalent=electric||(!bifuel&&/cng|lpg|natural gas|propane/i.test(type+' '+fuel));
  const phev=type==='plug-in hybrid',scores=Number(raw.ghgScore);
  return {
    id:Number(raw.id),year:String(raw.year||''),make:String(raw.make||''),model:String(raw.model||''),
    configuration:[raw.displ&&Number(raw.displ)>0?raw.displ+'L':null,
      raw.cylinders&&Number(raw.cylinders)>0?raw.cylinders+' cyl':null,
      raw.trany,raw.drive,raw.fuelType].filter(Boolean).map(String).join(' · '),
    unit:equivalent?'MPGe':'MPG',
    city:metric(raw.city08),highway:metric(raw.highway08),combined:metric(raw.comb08),
    phev,phevCombined:phev?metric(raw.phevComb):null,
    kwhPer100:metric(raw.combE),electricRange:(electric||phev)?metric(electric?(raw.range||raw.rangeA):raw.rangeA):null,
    yearlyCost:metric(raw.fuelCost08),
    ghgScore:Number.isInteger(scores)&&scores>=1&&scores<=10?scores:null,
    fuel:String(raw.fuelType||fuel)
  };
}
const api={menuItems,normalized,match,parseResponse,carFields,sameVehicle,conflictsWithVin,discover,resolve,choices,vehicle,metrics,request};
root.VinEpa=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
