/* VIN parsing and NHTSA lookup shared by the scanner and posting flow. */
(function(root){
'use strict';
const API = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const MAX_BATCH = 250;

const TRANSLIT = {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

function normalize(s){ return String(s||'').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,''); }
/* One VIN printed in groups or with dashes ("WVW ZZZ 1KZ AW1 23456", "WBA-3A5-C51-CF2-56985"), optionally followed by a model year. */
function squeezeVin(text){
  const t = String(text||'').normalize('NFKC').trim();
  if (!/[\s-]/.test(t)) return null;
  const m = t.match(/^(.*?)[\s,;]+((?:19[89]|20[0-3])\d)$/);
  const core = normalize(m && /[\s-]/.test(m[1]) ? m[1] : t);
  let vin = null;
  if (core.length === 17 && !/[IOQ]/.test(core)) vin = core;
  else if (core.length === 18 && /^[I1]/.test(core) && !/[IOQ]/.test(core.slice(1))) vin = core.slice(1);
  return vin ? {vin, year: m && /[\s-]/.test(m[1]) ? m[2] : undefined} : null;
}

function checkDigitOk(vin){
  let sum = 0;
  for (let i=0;i<17;i++){
    const c = vin[i];
    const v = /\d/.test(c) ? +c : TRANSLIT[c];
    if (v === undefined) return false;
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

/* Pull every plausible VIN out of free text or scanned barcode payloads.
   Handles a leading "I" or "1" prefix some Code 39 labels add (18-char payloads). */
function extractVins(text){
  const sq = squeezeVin(text); if (sq) return [sq.vin];
  const t = String(text||'').normalize('NFKC').toUpperCase();
  const found = new Set();
  const take = n => {
    if (n.length === 17 && !/[IOQ]/.test(n)) found.add(n);
    else if (n.length === 18 && /^[I1]/.test(n) && !/[IOQ]/.test(n.slice(1))) found.add(n.slice(1));   // Code 39 labels often lead with I or 1
  };
  // 1) whitespace-separated chunks, tolerating dashes inside a VIN ("1HG-CM826-33A004352")
  for (const chunk of t.split(/[\s,;]+/)) take(normalize(chunk));
  if (found.size) return [...found];
  // 2) QR codes and links wrap the VIN in other text (urls, JSON, "VIN:..."): split on every non-alphanumeric
  const tokens = t.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const tok of tokens) take(tok);
  if (found.size) return [...found];
  // 3) a VIN glued to a word ("VIN1HGCM82633A004352"): only trust a 17-character window whose check digit passes.
  //    Never take an unchecked slice: it silently decodes the wrong vehicle.
  //    If more than one window in a token passes (about 1 in 11 slices pass by chance), the text is ambiguous: take none.
  for (const tok of tokens){
    const ok = [];
    for (let i = 0; i + 17 <= tok.length; i++){
      const w = tok.slice(i, i + 17);
      if (!/[IOQ]/.test(w) && checkDigitOk(w)) ok.push(w);
    }
    if (ok.length === 1) found.add(ok[0]);
  }
  return [...found];
}

/* Full VINs plus partial VINs with one "*" wildcard (e.g. 5UXWX7C5*BA).
   A 4-digit model year after a VIN applies to it: "5UXWX7C5*BA 2011". */
function parseEntries(text){
  const sq = squeezeVin(text); if (sq) return [sq.year ? {vin:sq.vin, year:sq.year} : {vin:sq.vin}];
  const toks = String(text||'').normalize('NFKC').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const t of toks){
    const last = out[out.length-1];
    if (/^(19[89]\d|20[0-3]\d)$/.test(t) && last && !last.year){ last.year = t; continue; }
    const n = t.replace(/[^A-Z0-9*]/g,'');
    if (n.length===17 && !/[IOQ*]/.test(n)) out.push({vin:n});
    else if (n.length===18 && /^[I1]/.test(n) && !/[IOQ*]/.test(n.slice(1))) out.push({vin:n.slice(1)});
    else if (n.length>=6 && n.length<=17 && (n.match(/\*/g)||[]).length===1 && !/[IOQ]/.test(n)) out.push({vin:n, partial:true});
  }
  if (!out.length) extractVins(text).forEach(v => out.push({vin:v}));
  const seen = new Set();
  return out.filter(e => { const k = e.vin+'|'+(e.year||''); return seen.has(k) ? false : (seen.add(k), true); });
}

function inspectInput(text){
  const vins = parseEntries(text);
  const raw = normalize(text);
  if (vins.length > MAX_BATCH) return {state:'bad', vins:[], msg:`Too many VINs. Look up to ${MAX_BATCH} at a time.`};
  if (vins.length > 1) return {state:'ok', vins, msg:`${vins.length} VINs ready to look up`};
  if (vins.length === 1){
    const e = vins[0];
    if (e.partial) return {state:'warn', vins, msg: e.year ? `Partial VIN, model year ${e.year}` : 'Enter the full VIN, or add the model year after the partial VIN (for example, 2011).'};
    const ok = checkDigitOk(e.vin);
    return {state: ok ? 'ok':'warn', vins, msg: ok ? 'Valid VIN' : 'This VIN may have a typo. You can still look up a VIN from outside the U.S.'};
  }
  if (!raw) return {state:'idle', vins:[], msg:'A VIN has 17 characters and never uses I, O, or Q.'};
  if (/[IOQ]/.test(raw)) return {state:'bad', vins:[], msg:'VINs never use I, O, or Q.'};
  return {state: raw.length > 17 ? 'bad':'idle', vins:[], msg: raw.length > 17 ? `${raw.length} characters, expected 17` : `${raw.length} / 17`};
}

const GROUPS = [
  ['Vehicle', ['Series','VehicleType','BodyClass','Doors','Seats','GVWR','BasePrice','Manufacturer']],
  ['Powertrain', ['DriveType','EngineModel','EngineCylinders','DisplacementL','DisplacementCC','EngineHP','EngineKW','FuelTypePrimary','FuelTypeSecondary','ElectrificationLevel','TransmissionStyle','TransmissionSpeeds','Turbo','BatteryKWh']],
  ['Built', ['PlantCity','PlantState','PlantCountry','PlantCompanyName','Manufacturer Name']],
  ['Safety', ['ABS','ESC','TractionControl','TPMS','AirBagLocFront','AirBagLocSide','AirBagLocCurtain','AirBagLocKnee','AirBagLocSeatCushion','SeatBeltsAll','ForwardCollisionWarning','CrashImminentBraking','BlindSpotMon','LaneDepartureWarning','LaneKeepSystem','AdaptiveCruiseControl','ParkAssist','RearVisibilitySystem','Pretensioner']]
];
const SKIP = new Set(['ModelYear','Make','Model','Trim','MakeID','ModelID','ManufacturerId','VehicleDescriptor','DisplacementCI','ErrorCode','ErrorText','AdditionalErrorText','SuggestedVIN','PossibleValues','VIN','Note','ActiveSafetySysNote','Notes']);
const LABELS = {ModelYear:'Year',BodyClass:'Body',DriveType:'Drive',EngineCylinders:'Cylinders',DisplacementL:'Displacement (L)',DisplacementCC:'Displacement (cc)',
  EngineHP:'Horsepower',EngineKW:'Power (kW)',FuelTypePrimary:'Fuel',FuelTypeSecondary:'Fuel (secondary)',TransmissionStyle:'Transmission',
  TransmissionSpeeds:'Speeds',PlantCity:'Plant city',PlantState:'Plant state',PlantCountry:'Plant country',PlantCompanyName:'Plant company',
  ManufacturerName:'Manufacturer',GVWR:'GVWR',ESC:'Stability control',TPMS:'Tire pressure',ABS:'ABS',VehicleType:'Type',
  AirBagLocFront:'Airbags front',AirBagLocSide:'Airbags side',AirBagLocCurtain:'Airbags curtain',AirBagLocKnee:'Airbags knee',
  AirBagLocSeatCushion:'Airbags seat',SeatBeltsAll:'Seat belts',ElectrificationLevel:'Electrification',BatteryKWh:'Battery (kWh)'};
Object.assign(LABELS, {
  EngineModel:'Engine model',
  EngineConfiguration:'Engine layout', EngineManufacturer:'Engine maker', FuelInjectionType:'Fuel injection', ValveTrainDesign:'Valvetrain',
  OtherEngineInfo:'Engine notes', BodyCabType:'Cab', SteeringLocation:'Steering', CurbWeightLB:'Curb weight', GVWR_to:'GVWR (max class)',
  OtherRestraintSystemInfo:'Other restraints', AutoReverseSystem:'Auto reverse', BrakeSystemType:'Brakes'});
const EXTRA = {
  Vehicle:['BodyCabType','SteeringLocation','CurbWeightLB','GVWR_to'],
  Powertrain:['EngineConfiguration','EngineManufacturer','OtherEngineInfo','FuelInjectionType','ValveTrainDesign'],
  Safety:['BrakeSystemType','AutoReverseSystem','OtherRestraintSystemInfo']
};
const FMT = { CurbWeightLB: v => isNaN(+v) ? v : `${Math.round(+v).toLocaleString('en-US')} lb (${Math.round(+v*0.45359237).toLocaleString('en-US')} kg)` };
const labelOf = k => LABELS[k] || k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');

/* Country a VIN was assigned in, from its first two characters (ISO 3780 WMI blocks). Offline, no API call.
   Ranges run along A-Z (no I, O, Q) then 1-9, 0, e.g. "KL-KR" = KL, KM, KN, KP, KR. */
const WMI_SEQ = 'ABCDEFGHJKLMNPRSTUVWXYZ1234567890';
const WMI_BLOCKS = [
  ['A','A','H','South Africa'],['A','J','N','Ivory Coast'],['B','A','E','Angola'],['B','F','K','Kenya'],['B','L','R','Tanzania'],
  ['C','A','E','Benin'],['C','F','K','Madagascar'],['C','L','R','Tunisia'],['D','A','E','Egypt'],['D','F','K','Morocco'],['D','L','R','Zambia'],
  ['E','A','E','Ethiopia'],['E','F','K','Mozambique'],['F','A','E','Ghana'],['F','F','K','Nigeria'],
  ['J','A','0','Japan'],['K','A','E','Sri Lanka'],['K','F','K','Israel'],['K','L','R','South Korea'],['K','S','0','Kyrgyzstan'],['L','A','0','China'],
  ['M','A','E','India'],['M','F','K','Indonesia'],['M','L','R','Thailand'],['M','S','W','Myanmar'],['M','X','0','Kazakhstan'],
  ['N','A','E','Iran'],['N','F','G','Pakistan'],['N','L','R','Turkey'],
  ['P','A','E','Philippines'],['P','F','G','Singapore'],['P','L','R','Malaysia'],
  ['R','A','E','United Arab Emirates'],['R','F','K','Taiwan'],['R','L','R','Vietnam'],
  ['S','A','M','United Kingdom'],['S','N','T','Germany'],['S','U','Z','Poland'],['S','1','4','Latvia'],
  ['T','A','H','Switzerland'],['T','J','P','Czech Republic'],['T','R','V','Hungary'],['T','W','1','Portugal'],
  ['U','H','M','Denmark'],['U','N','T','Ireland'],['U','U','Z','Romania'],['U','5','7','Slovakia'],
  ['V','A','E','Austria'],['V','F','R','France'],['V','S','W','Spain'],['V','X','2','Serbia'],['V','3','5','Croatia'],['V','6','0','Estonia'],
  ['W','A','0','Germany'],
  ['X','A','E','Bulgaria'],['X','F','K','Greece'],['X','L','R','Netherlands'],['X','S','W','Russia'],['X','X','2','Luxembourg'],['X','3','0','Russia'],
  ['Y','A','E','Belgium'],['Y','F','K','Finland'],['Y','S','W','Sweden'],['Y','X','2','Norway'],['Y','3','5','Belarus'],['Y','6','0','Ukraine'],
  ['Z','A','R','Italy'],['Z','X','2','Slovenia'],['Z','3','5','Lithuania'],['Z','6','0','Russia'],
  ['1','A','0','United States'],['2','A','0','Canada'],['3','A','W','Mexico'],['3','X','7','Costa Rica'],['3','8','0','Cayman Islands'],
  ['4','A','0','United States'],['5','A','0','United States'],
  ['6','A','W','Australia'],['7','A','E','New Zealand'],
  ['8','A','E','Argentina'],['8','F','K','Chile'],['8','L','R','Ecuador'],['8','S','W','Peru'],['8','X','2','Venezuela'],
  ['9','A','E','Brazil'],['9','F','K','Colombia'],['9','L','R','Paraguay'],['9','S','W','Uruguay'],['9','X','2','Trinidad and Tobago'],['9','3','9','Brazil']
];
function countryOfVin(vin){
  const v = String(vin||'').toUpperCase();
  if (v.length < 2) return null;
  const i = WMI_SEQ.indexOf(v[1]); if (i < 0) return null;
  for (const [a, from, to, name] of WMI_BLOCKS)
    if (v[0] === a && i >= WMI_SEQ.indexOf(from) && i <= WMI_SEQ.indexOf(to)) return name;
  return null;
}
const NORTH_AMERICA = ['United States','Canada','Mexico'];

/* Turn one raw vPIC result row into a view model. */
function parseResult(row, fallbackVin){
  row = Object.assign({}, row);
  if (row.DisplacementL && !isNaN(+row.DisplacementL)) row.DisplacementL = (+row.DisplacementL).toFixed(1);
  if (row.DisplacementCC && !isNaN(+row.DisplacementCC)) row.DisplacementCC = String(Math.round(+row.DisplacementCC));
  const val = k => (row[k] == null ? '' : String(row[k]).trim());
  const codes = val('ErrorCode').split(',').map(s => s.trim()).filter(Boolean);
  const hasError = codes.some(c => c !== '0');
  const decoded = !!(val('Make') || val('Model'));
  const used = new Set();
  const groups = [];
  for (const [name, keys] of GROUPS){
    const rows = [];
    for (const k of keys.concat(EXTRA[name] || [])){
      const v = row[k] === undefined ? '' : val(k);
      used.add(k);
      if (k === 'GVWR_to' && v === val('GVWR')) continue;   // same class both ends: show once
      if (v && v !== 'Not Applicable'){ rows.push([labelOf(k), (FMT[k] || (x => x))(v)]); }
    }
    if (rows.length) groups.push({name, rows});
  }
  used.add('ManufacturerName');
  const other = [];
  for (const k of Object.keys(row)){
    if (used.has(k) || SKIP.has(k) || /ID$/.test(k)) continue;
    const v = val(k);
    if (v && v !== 'Not Applicable') other.push([labelOf(k), v]);
  }
  if (other.length) groups.push({name:'More', rows:other});

  const vinStr = val('VIN') || fallbackVin;
  const country = countryOfVin(vinStr);
  if (country){
    const built = groups.find(g => g.name === 'Built');
    if (built) built.rows.unshift(['VIN country', country]); else groups.push({name:'Built', rows:[['VIN country', country]]});
  }
  const outside = country && !NORTH_AMERICA.includes(country);
  let marketNote = '';
  if (outside && !decoded) marketNote = `This VIN was assigned in ${country}. NHTSA only holds vehicle data for North American markets, so there is nothing to show for it.`;
  else if (outside && !val('Model')) marketNote = `This VIN was assigned in ${country}. NHTSA has limited data for vehicles sold outside North America, so only the basics are available.`;
  const eng = [val('DisplacementL') && val('DisplacementL')+'L', val('EngineCylinders') && val('EngineCylinders')+'-cyl'].filter(Boolean).join(' ');
  const facts = [val('BodyClass').replace(/\s*\/.*$/,'').replace(/\s*\(.*\)/,''), eng, val('DriveType').replace(/\/.*$/,'').trim(), val('FuelTypePrimary')].filter(Boolean).slice(0,4);
  const title = [val('ModelYear'), val('Make') && titleCase(val('Make')), val('Model'), val('Trim')].filter(Boolean).join(' ');
  return {
    vin: val('VIN') || fallbackVin,
    title: title || 'Unrecognized vehicle',
    make: val('Make') ? titleCase(val('Make')) : '',
    year: val('ModelYear'),
    decoded, hasError,
    note: joinSentences(marketNote, hasError ? joinSentences(val('ErrorText').replace(/^\d+\s*-\s*/,''), val('AdditionalErrorText')) : ''),
    country: country || '',
    suggested: val('SuggestedVIN'),
    facts: !decoded && country ? [country] : facts, groups, flat: row
  };
}
function joinSentences(a, b){ a = a.trim(); b = (b||'').trim(); return !b ? a : a + (/[.!?]$/.test(a) ? ' ' : '. ') + b; }
function titleCase(s){ return /^[A-Z\s-]+$/.test(s) && s.length > 3 ? s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()) : s; }

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const cancelled = () => Object.assign(new Error('Request cancelled'), {name:'AbortError'});
/* Bounded retries, abort propagation, per-attempt timeout. */
async function fetchRetry(url, init = {}, fetchImpl = fetch, sleep = sleepMs){
  init = init || {};
  const signal = init.signal;
  let delay = 800;
  for (let attempt=0; attempt<4; attempt++){
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    const relay = () => controller.abort();
    signal?.addEventListener('abort', relay, {once:true});
    const timer = setTimeout(() => controller.abort(), 20000);
    let r, failure;
    try { r = await fetchImpl(url, {...init, signal:controller.signal}); }
    catch(e){ failure=e; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
    if (signal?.aborted) throw cancelled();
    if(controller.signal.aborted && !r)failure=new Error('NHTSA timed out. Check your connection and retry.');
    if (r?.ok) return r;
    if (r && ![429,502,503,504].includes(r.status))
      throw new Error(`NHTSA returned ${r.status}. Check your VIN and try again.`);
    if (attempt === 3){
      if (r?.status === 429) throw new Error('NHTSA is rate limiting requests. Try again shortly.');
      if (r) throw new Error(`NHTSA is temporarily unavailable (HTTP ${r.status}). Try again.`);
      throw failure || new Error('Could not reach NHTSA. Check your connection and retry.');
    }
    const ra=Number(r?.headers?.get?.('Retry-After'));
    await sleep(ra>0 && Number.isFinite(ra) ? Math.min(ra,10)*1000 : delay);
    delay=Math.min(delay*2,5000);
  }
}

const asEntry = x => typeof x === 'string' ? {vin:x} : x;
async function decodeVins(list, fetchImpl = fetch, sleep, signal){
  const entries = list.map(asEntry);
  if (!entries.length || entries.length > MAX_BATCH) throw new Error(`Decode 1–${MAX_BATCH} VINs at a time.`);
  if (entries.length === 1){
    const {vin,year}=entries[0];
    const r=await fetchRetry(`${API}/DecodeVinValues/${encodeURIComponent(vin)}?format=json${year?'&modelyear='+encodeURIComponent(year):''}`, {signal}, fetchImpl, sleep);
    const j=await r.json();
    if (!Array.isArray(j.Results) || !j.Results.length) throw new Error('NHTSA returned no vehicle data. Try again.');
    return j.Results.map(x=>parseResult(x,vin));
  }
  // Two concurrent NHTSA chunks shorten larger batch decodes while avoiding
  // a burst of 5 requests and preserving the VIN order users supplied.
  const chunks=[];
  for(let i=0;i<entries.length;i+=50)chunks.push(entries.slice(i,i+50));
  const results=new Array(chunks.length);
  let cursor=0;
  async function worker(){
    while(cursor<chunks.length){
      if(signal?.aborted)throw cancelled();
      const idx=cursor++,chunk=chunks[idx];
      const data=chunk.map(e=>e.year ? `${e.vin},${e.year}`:e.vin).join(';');
      const r=await fetchRetry(`${API}/DecodeVINValuesBatch/`,{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'format=json&data='+encodeURIComponent(data),signal
      },fetchImpl,sleep);
      const j=await r.json();
      if(!Array.isArray(j.Results)||j.Results.length!==chunk.length)
        throw new Error('NHTSA returned an incomplete batch. Retry this group of VINs.');
      results[idx]=j.Results.map((x,k)=>parseResult(x,chunk[k].vin));
    }
  }
  await Promise.all(Array.from({length:Math.min(2,chunks.length)},worker));
  return results.flat();
}

const RECENT_KEY='vinbox-recent-vehicles-v1';
const RECENT_LIMIT=20;
const recentFields=['ModelYear','Make','Model','Trim','BodyClass','DriveType','DisplacementL',
  'TransmissionStyle','TransmissionSpeeds','FuelTypePrimary','FuelTypeSecondary',
  'ElectrificationLevel','EngineCylinders','Turbo'];
function recentVehicles(storage){
  try{
    const entries=JSON.parse(storage.getItem(RECENT_KEY)||'[]');
    return Array.isArray(entries)?entries.slice(0,RECENT_LIMIT):[];
  }catch{return [];}
}
function rememberVehicles(storage,vehicles){
  const merged=new Map();
  for(const v of [...vehicles,...recentVehicles(storage)]){
    if(!v?.decoded||v.hasError||!/^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin)||!v.flat?.Make||!v.flat?.Model||merged.has(v.vin))continue;
    const flat=Object.fromEntries(recentFields.map(key=>[key,String(v.flat[key]??'').slice(0,120)]));
    merged.set(v.vin,{vin:v.vin,decoded:true,hasError:false,year:flat.ModelYear,
      make:titleCase(String(v.make||flat.Make).trim()),flat});
    if(merged.size===RECENT_LIMIT)break;
  }
  storage.setItem(RECENT_KEY,JSON.stringify([...merged.values()]));
}
const api={API,MAX_BATCH,normalize,squeezeVin,checkDigitOk,extractVins,inspectInput,
  parseEntries,countryOfVin,titleCase,parseResult,fetchRetry,decodeVins,recentVehicles,rememberVehicles};
if(typeof module!=='undefined')module.exports=api;
root.VinboxVinLookup=api;
// A URL-supplied VIN is an explicit lookup request. Start it as soon as the
// shared VIN module loads; the scanner consumes this one pending request.
if(typeof window!=='undefined' && /(?:\/|\/index\.html)$/.test(window.location.pathname)){
 const initial=extractVins(window.location.hash.slice(1));
 if(initial.length===1){
  const controller=new AbortController();
  window.VinboxEarlyLookup={
   vin:initial[0],controller,
   result:decodeVins(initial,undefined,undefined,controller.signal)
    .then(vehicles=>({vehicles}),error=>({error}))
  };
 }
}
})(typeof window!=='undefined'?window:globalThis);
