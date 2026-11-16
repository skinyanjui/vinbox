/* ============ Core (pure) ============ */
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
  if (vins.length > MAX_BATCH) return {state:'bad', vins:[], msg:`Too many VINs. Decode up to ${MAX_BATCH} at a time.`};
  if (vins.length > 1) return {state:'ok', vins, msg:`${vins.length} VINs found, batch decode`};
  if (vins.length === 1){
    const e = vins[0];
    if (e.partial) return {state:'warn', vins, msg: e.year ? `Partial VIN, model year ${e.year}` : 'Partial VIN. Add the model year after it, e.g. 2011'};
    const ok = checkDigitOk(e.vin);
    return {state: ok ? 'ok':'warn', vins, msg: ok ? 'Valid VIN' : 'Check digit does not match. Decode anyway if non-US.'};
  }
  if (!raw) return {state:'idle', vins:[], msg:'17 characters, no I/O/Q'};
  if (/[IOQ]/.test(raw)) return {state:'bad', vins:[], msg:'VINs never contain I, O or Q'};
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
  const out=[];
  for (let i=0;i<entries.length;i+=50){
    if (signal?.aborted) throw cancelled();
    const chunk=entries.slice(i,i+50);
    const data=chunk.map(e=>e.year ? `${e.vin},${e.year}`:e.vin).join(';');
    const r=await fetchRetry(`${API}/DecodeVINValuesBatch/`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'format=json&data='+encodeURIComponent(data),signal
    },fetchImpl,sleep);
    const j=await r.json();
    if(!Array.isArray(j.Results)||j.Results.length!==chunk.length)
      throw new Error('NHTSA returned an incomplete batch. Retry this group of VINs.');
    j.Results.forEach((x,idx)=>out.push(parseResult(x,chunk[idx].vin)));
  }
  return out;
}

/* NHTSA's WMI registry knows the maker behind most foreign VIN prefixes (Renault, VW, Nissan, Hyundai, Volvo...). */
async function fetchWmi(wmi, fetchImpl = fetch, sleep){
  const r = await fetchRetry(`${API}/DecodeWMI/${wmi}?format=json`, undefined, fetchImpl, sleep);
  const x = ((await r.json()).Results || [])[0] || {};
  return String(x.Make || '').split(',').map(s => titleCase(s.trim())).filter(Boolean).join(', ');
}
function applyMaker(it, maker){
  it.maker = maker;
  if (!it.decoded){ it.title = maker; it.facts = it.country ? [it.country] : []; }
  const v = it.groups.find(g => g.name === 'Vehicle');
  const row = ['Maker (VIN prefix)', maker];
  if (v) v.rows.unshift(row); else it.groups.unshift({name:'Vehicle', rows:[row]});
}
async function enrichMakers(items, fetchImpl = fetch, sleep){
  const cache = new Map();
  for (const it of items){
    if (it.make || !/^[A-HJ-NPR-Z0-9]{17}$/.test(it.vin || '')) continue;
    const wmi = it.vin.slice(0, 3);
    if (!cache.has(wmi)){if(cache.size>=12)continue;cache.set(wmi,fetchWmi(wmi,fetchImpl,sleep).catch(()=>''));}
    const maker = await cache.get(wmi);
    if (maker) applyMaker(it, maker);
  }
  return items;
}

/* Recalls come from a different NHTSA service and are keyed by make/model/year, not VIN. */
async function fetchRecalls(it, fetchImpl = fetch, sleep){
  const q = new URLSearchParams({make:it.flat.Make||it.make, model:it.flat.Model||'', modelYear:it.year});
  const r = await fetchRetry(`https://api.nhtsa.gov/recalls/recallsByVehicle?${q}`, undefined, fetchImpl, sleep);
  const j = await r.json();
  const parse = s => { const m = /(\d\d)\/(\d\d)\/(\d{4})/.exec(s||''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; /* NHTSA uses DD/MM/YYYY */ };
  return (j.results||[]).map(x => ({
    id:x.NHTSACampaignNumber, date:parse(x.ReportReceivedDate),
    component:String(x.Component||'').split(':')[0].toLowerCase().replace(/^\w/,c=>c.toUpperCase()),
    summary:x.Summary||'', consequence:x.Consequence||'', remedy:x.Remedy||'', parkIt:x.parkIt===true||x.parkIt==='True'
  })).sort((a,b)=>b.date.localeCompare(a.date));
}

/* Canadian-market dimensions (cm, kg) for the same make/model/year; closest match, may differ from US trims. */
async function fetchSpecs(it, fetchImpl = fetch, sleep){
  const q = new URLSearchParams({year:it.year, make:it.flat.Make||it.make, model:it.flat.Model||'', format:'json'});
  const r = await fetchRetry(`${API}/GetCanadianVehicleSpecifications/?${q}`, undefined, fetchImpl, sleep);
  const j = await r.json();
  const all = (j.Results||[]).map(x => Object.fromEntries((x.Specs||[]).map(s => [s.Name, s.Value])));
  const trim = String(it.flat.Trim||'').toUpperCase();
  const pick = (trim && all.find(x => String(x.Model||'').toUpperCase().includes(trim))) || all[0];
  if (!pick) return null;
  const n = k => { const v = parseFloat(pick[k]); return isFinite(v) && v > 0 ? v : null; };
  const inch = cm => (cm/2.54).toFixed(1) + ' in';
  const rows = [];
  [['OL','Length'],['OW','Width'],['OH','Height'],['WB','Wheelbase']].forEach(([k,l]) => { const v = n(k); if (v) rows.push([l, `${inch(v)} (${v} cm)`]); });
  const cw = n('CW'); if (cw) rows.push(['Curb weight', `${Math.round(cw*2.20462).toLocaleString('en-US')} lb (${cw} kg)`]);
  return rows.length ? {rows} : null;
}

function toCsv(items){
  const keys = ['VIN','Year','Make','Model','Trim','BodyClass','DriveType','EngineCylinders','DisplacementL','FuelTypePrimary','TransmissionStyle','PlantCountry'];
  const esc = v => {
    v=String(v==null?'':v);
    // Prevent spreadsheet formula execution from external decoded values.
    if (/^[\s\uFEFF]*[=+@-]/.test(v)) v="'"+v;
    return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  };
  const map = {Year:'ModelYear'};
  const rows = items.map(it => keys.map(k => k==='VIN' ? it.vin : it.flat[map[k]||k]).map(esc).join(','));
  return [keys.join(','), ...rows].join('\n');
}

/* plain-text summary used by Share / copy fallback */
function shareText(it, base){
  const lines = [it.title, 'VIN ' + it.vin];
  if (it.facts && it.facts.length) lines.push(it.facts.join(' · '));
  const get = k => (it.flat && it.flat[k]) || '';
  const extra = [['Engine', get('EngineModel')], ['Drive', get('DriveType')], ['Plant', [get('PlantCity'), get('PlantCountry')].filter(Boolean).join(', ')]]
    .filter(([,v]) => v).map(([k,v]) => k + ': ' + v);
  if (extra.length) lines.push(extra.join(' · '));
  if (base) lines.push(base + '#' + it.vin);
  return lines.join('\n');
}
if (typeof module !== 'undefined') module.exports = {fetchWmi,enrichMakers,squeezeVin,countryOfVin,shareText,normalize,checkDigitOk,extractVins,inspectInput,parseResult,decodeVins,fetchRetry,parseEntries,fetchRecalls,fetchSpecs,toCsv};

/* ============ UI ============ */
if (typeof document !== 'undefined') (function(){
const $ = s => document.querySelector(s);
const el = (tag, attrs={}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k==='class') n.className = v; else if (k==='text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, String(v));
  }
  kids.flat().forEach(c => c != null && n.append(c.nodeType ? c : document.createTextNode(c)));
  return n;
};
const svg = (d, cls='') => { const s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24');
  s.setAttribute('fill','none'); s.setAttribute('stroke','currentColor'); s.setAttribute('stroke-width','1.75'); s.setAttribute('stroke-linecap','round');
  s.setAttribute('stroke-linejoin','round'); if(cls) s.setAttribute('class',cls); s.innerHTML = d; return s; };

/* Icon set: 24px grid, 1.75 stroke, round caps and joins, one visual weight. */
const ICONS = {
  logo:'<path d="M4.5 8.5V7A2.5 2.5 0 0 1 7 4.5h1.5M15.5 4.5H17A2.5 2.5 0 0 1 19.5 7v1.5M19.5 15.5V17a2.5 2.5 0 0 1-2.5 2.5h-1.5M8.5 19.5H7A2.5 2.5 0 0 1 4.5 17v-1.5"/><g fill="currentColor" stroke="none"><rect x="7.5" y="9" width="1.5" height="6" rx=".4"/><rect x="10.3" y="9" width="1" height="6"/><rect x="12.3" y="9" width="2" height="6" rx=".4"/><rect x="15.5" y="9" width="1" height="6"/></g>',
  scan:'<path d="M4.5 8.5V7A2.5 2.5 0 0 1 7 4.5h1.5M15.5 4.5H17A2.5 2.5 0 0 1 19.5 7v1.5M19.5 15.5V17a2.5 2.5 0 0 1-2.5 2.5h-1.5M8.5 19.5H7A2.5 2.5 0 0 1 4.5 17v-1.5"/><path d="M8 12h8"/>',
  image:'<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9.5" r="1.5"/><path d="m20.5 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L5 20"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  copy:'<rect x="9" y="9" width="11.5" height="11.5" rx="2.5"/><path d="M5.5 15H5A2 2 0 0 1 3 13V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
  bookmark:'<path d="M18.5 20.5 12 16.5l-6.5 4V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z"/>',
  'bookmark-fill':'<path fill="currentColor" d="M18.5 20.5 12 16.5l-6.5 4V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z"/>',
  download:'<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  trash:'<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.5a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7M10 11v5M14 11v5"/>',
  shield:'<path d="M12 3.5 19.5 6v5.5c0 4.5-3 7.6-7.5 9-4.5-1.4-7.5-4.5-7.5-9V6z"/><path d="M12 8.5v4M12 15.5h.01"/>',
  share:'<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H7a2 2 0 0 0-2 2v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2h-1"/>',
  sound:'<path d="M4 9.5v5h3.5l5 4v-13l-5 4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  'sound-off':'<path d="M4 9.5v5h3.5l5 4v-13l-5 4z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>',
  'bolt-fill':'<path fill="currentColor" d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  bolt:'<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'
};
const icon = (name, cls='') => svg(ICONS[name], cls);
document.querySelectorAll('i[data-icon]').forEach(n => n.replaceWith(icon(n.dataset.icon)));

const state = { tab:'results', results:[], history:load(), makeOff:new Set(), open:new Set(), loading:0,
  recalls:new Map(), specs:new Map(), rOpen:new Set(), lastVins:[] };
const extras=window.VinboxExtras({state,el,icon,render,save,SectionHead,download,toCsv});
function load(){
  try{
    const raw=JSON.parse(localStorage.getItem('vin-history')||'[]');
    if(!Array.isArray(raw)) return [];
    return raw.filter(it=>it && typeof it.vin==='string' && it.vin.length<=17 &&
      /^[A-HJ-NPR-Z0-9*]{6,17}$/.test(it.vin) && Array.isArray(it.facts) &&
      Array.isArray(it.groups) && it.groups.every(g=>g && Array.isArray(g.rows)) &&
      it.flat && typeof it.flat==='object' && typeof it.title==='string').slice(0,100);
  }catch(e){ return []; }
}
function save(){
  try{ localStorage.setItem('vin-history', JSON.stringify(state.history)); return true; }
  catch(e){ toast('Storage unavailable. Export a CSV as backup.'); return false; }
}
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.dataset.on='true'; clearTimeout(toast.t); toast.t=setTimeout(()=>t.dataset.on='false',1800); }

/* feedback: haptics + sound. One switch, remembered. iOS Safari has no vibrate API, so it gets sound only. */
const fx = (() => {
  let on = true, ctx = null;
  try{ on = localStorage.getItem('vin-fx') !== 'off'; }catch(e){}
  const tone = (f, t0, dur, vol) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + t0;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  return {
    get on(){ return on; },
    set(v){ on = v; try{ localStorage.setItem('vin-fx', v ? 'on' : 'off'); }catch(e){} },
    arm(){ if (!on) return; try{ ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.state === 'suspended' && ctx.resume(); }catch(e){} },
    buzz(p){ if (on) try{ navigator.vibrate?.(p); }catch(e){} },
    play(kind){
      if (!on || !ctx) return;
      try{
        if (kind === 'scan'){ tone(1568, 0, .09, .22); tone(2093, .09, .14, .22); }   // bright two-note "got it"
        else if (kind === 'tick'){ tone(1200, 0, .04, .08); }
        else if (kind === 'miss'){ tone(330, 0, .16, .18); }
      }catch(e){}
    }
  };
})();

/* components */
function Notice(it){
  if (!it.note) return null;
  const [first, ...rest] = it.note.split(/(?<=[.!?])\s+/);
  const head = first + (it.suggested ? ` Suggested VIN: ${it.suggested}.` : '');
  if (!rest.length) return el('div',{class:'notice'}, head);
  const id = 'note#' + it.vin;
  return el('details',{class:'notice',open:state.rOpen.has(id)||null,ontoggle:toggler(state.rOpen,id)},
    el('summary',{}, head, el('span',{class:'more',text:'Details'})),
    el('p',{text:rest.join(' ')}));
}
function Card(it, {saved}){
  const open = state.open.has(it.vin);
  const badge = !it.decoded ? (it.maker ? el('span',{class:'badge warn',text:'Maker only',title:'Only the maker could be identified from the VIN prefix'}) : el('span',{class:'badge bad',text:'No match'})) : it.hasError ? (/^check digit/i.test(it.note||'') ? el('span',{class:'badge warn',text:'Check digit',title:'The VIN check digit does not match'}) : el('span',{class:'badge warn',text:'Partial',title:'NHTSA could not fully decode this VIN'})) : null;
  const head = el('button',{id:'card-toggle-'+it.vin,class:'card-head','aria-controls':'card-detail-'+it.vin,'aria-expanded':open,onclick:()=>{ state.open.has(it.vin)?state.open.delete(it.vin):state.open.add(it.vin); render(); document.getElementById('card-toggle-'+it.vin)?.focus(); }},
    el('div',{class:'card-main'},
      el('div',{class:'card-title'}, it.title),
      el('div',{class:'card-vin'}, it.vin, badge),
      it.facts.length ? el('div',{class:'card-facts'}, it.facts.map(f=>el('span',{text:f}))) : null),
    icon('chevron','chev'));
  const copyBtn = el('button',{class:'btn sm',onclick:async e=>{ e.stopPropagation();
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(it.vin);
      fx.buzz(10);fx.play('tick');toast('VIN copied');
      copyBtn.replaceChildren(icon('check'),'Copied');
      setTimeout(()=>{if(copyBtn.isConnected)copyBtn.replaceChildren(icon('copy'),'Copy VIN');},1200);
    }catch(err){toast('Copy unavailable. Select the VIN to copy it.');}
  }},icon('copy'),'Copy VIN');
  const saveLabel = saved ? 'Remove from saved' : 'Save';
  const saveBtn = el('button',{class:'btn sm icon ghost'+(saved?' on':''),title:saveLabel,'aria-label':saveLabel,'aria-pressed':saved,
    onclick:e=>{ e.stopPropagation(); fx.arm(); fx.buzz(saved ? 8 : [10,30,10]); fx.play('tick'); toggleSave(it); }}, icon(saved?'bookmark-fill':'bookmark'));
  const shareBtn = el('button',{class:'btn sm',onclick:async e=>{ e.stopPropagation();
    const base = /^https?:/.test(location.protocol) ? location.origin + location.pathname : '';
    const text = shareText(it, base);
    try{
      if (navigator.share){ await navigator.share({title: it.title, text}); return; }
      await navigator.clipboard.writeText(text); fx.buzz(10); toast('Summary copied');
    }catch(err){ if (err && err.name === 'AbortError') return; toast('Share unavailable'); }
  }}, icon('share'), 'Share');
  const actions = el('div',{class:'card-actions',style:'padding-right:10px'}, saveBtn);
  const row = el('div',{style:'display:flex;align-items:center'}, head, actions);
  head.style.flex='1'; head.style.minWidth='0';
  const detail = el('div',{id:'card-detail-'+it.vin,class:'detail'},
    open ? el('div',{class:'card-tools'}, copyBtn, shareBtn) : null,
    Notice(it),
    open ? RecallsPanel(it) : null,
    open ? extras.EpaPanel(it) : null,
    it.groups.map(g => el('div',{class:'group'}, el('h3',{text:g.name}),
      el('dl',{class:'kv'}, g.rows.map(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]).flat()))),
    open ? SpecsGroup(it) : null);
  return el('article',{class:'card','data-open':open}, row, detail);
}
const recallKey = it => (it.decoded && it.year && it.flat.Make && it.flat.Model) ? [it.flat.Make,it.flat.Model,it.year].join('|') : null;
function loadRecalls(it, key){
  state.recalls.set(key, {status:'loading'});
  fetchRecalls(it).then(data => state.recalls.set(key,{status:'ok',data}))
    .catch(() => state.recalls.set(key,{status:'err'})).finally(render);
}
function toggler(set, id){ return e => { e.target.open ? set.add(id) : set.delete(id); }; }
function Recall(r, key){
  const id = key+'#'+r.id;
  return el('details',{class:'recall',open:state.rOpen.has(id)||null,ontoggle:toggler(state.rOpen,id)},
    el('summary',{}, el('div',{class:'rc'}, el('b',{text:r.component||'Recall'}), r.parkIt ? el('span',{class:'badge bad',text:'Park advisory'}) : null,
      el('div',{class:'rm',text:`${r.id}${r.date?' · '+r.date:''}`})), icon('chevron','chev')),
    el('div',{class:'recall-body'},
      r.summary ? [el('h4',{text:'What'}), el('p',{text:r.summary})] : null,
      r.consequence ? [el('h4',{text:'Risk'}), el('p',{text:r.consequence})] : null,
      r.remedy ? [el('h4',{text:'Remedy'}), el('p',{text:r.remedy})] : null));
}
function RecallsPanel(it){
  const key = recallKey(it); if (!key) return null;
  const s = state.recalls.get(key) || {status:'idle'};
  const n = s.status==='ok' ? s.data.length : 0;
  const tag = s.status==='idle' ? el('span',{class:'badge',text:'Check'})
    : s.status==='loading' ? el('div',{class:'bar',style:'width:40px;height:14px'})
    : s.status==='err' ? el('span',{class:'badge warn',text:'Unavailable'})
    : el('span',{class:'badge '+(n?'warn':'ok'),text:n?String(n):'No matches'});
  let body = null;
  if (s.status==='err') body = el('div',{class:'recalls-body'}, el('p',{class:'recalls-note',text:'Could not load recalls.'}),
    el('button',{class:'btn sm',onclick:()=>{ state.recalls.delete(key); render(); }},'Retry'));
  else if (s.status==='ok') body = el('div',{class:'recalls-body'},
    el('p',{class:'recalls-note',text:'Matched by make, model and year, not this exact VIN, and does not show whether repairs were done. Confirm with a dealer or nhtsa.gov/recalls.'}),
    s.data.map(r => Recall(r,key)));
  return el('details',{class:'recalls',open:state.rOpen.has(key)||null,ontoggle:e=>{
    toggler(state.rOpen,key)(e);
    if(e.target.open && !state.recalls.has(key)){loadRecalls(it,key);queueMicrotask(render);}
  }},
    el('summary',{}, icon('shield'), 'Recalls', el('span',{class:'n'},tag), icon('chevron','chev')), body);
}
function SpecsGroup(it){
  const key = recallKey(it); if (!key) return null;
  if (!state.specs.has(key)){
    state.specs.set(key,{status:'loading'});
    fetchSpecs(it).then(d => state.specs.set(key,{status:'ok',d})).catch(() => state.specs.set(key,{status:'err'})).finally(render);
  }
  const s = state.specs.get(key);
  if (s.status==='loading') return el('div',{class:'group'}, el('h3',{text:'Dimensions'}), el('div',{class:'bar',style:'width:60%'}));
  if (s.status!=='ok' || !s.d) return null;
  return el('div',{class:'group'}, el('h3',{text:'Dimensions'}),
    el('dl',{class:'kv'}, s.d.rows.map(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]).flat()),
    el('p',{class:'recalls-note',text:'Closest Canadian-market match. US trims may differ.'}));
}
function Skeleton(){ return el('div',{class:'skel'}, el('div',{class:'bar',style:'width:55%;height:16px'}), el('div',{class:'bar',style:'width:35%;margin-top:8px'}), el('div',{class:'bar',style:'width:80%;margin-top:12px'})); }
function Empty(t,s){ return el('div',{class:'empty'}, icon('scan','empty-ic'), el('b',{text:t}), s); }
function SectionHead(title, ...acts){ return el('div',{class:'sec'}, el('h2',{text:title}), el('div',{class:'acts'},acts)); }

function toggleSave(it){
  const before=state.history.slice();
  const i = state.history.findIndex(h=>h.vin===it.vin);
  if (i>=0) state.history.splice(i,1);
  else state.history.unshift({vin:it.vin,epaId:extras.epaId(it),title:it.title,make:it.make,maker:it.maker,country:it.country,year:it.year,decoded:it.decoded,hasError:it.hasError,note:it.note,suggested:it.suggested,facts:it.facts,groups:it.groups,flat:{ModelYear:it.flat.ModelYear,Make:it.flat.Make,Model:it.flat.Model,Trim:it.flat.Trim,BodyClass:it.flat.BodyClass,DriveType:it.flat.DriveType,EngineCylinders:it.flat.EngineCylinders,DisplacementL:it.flat.DisplacementL,FuelTypePrimary:it.flat.FuelTypePrimary,TransmissionStyle:it.flat.TransmissionStyle,PlantCountry:it.flat.PlantCountry}});
  state.history=state.history.slice(0,100);
  if(!save())state.history=before;
  else extras.afterToggle(before,i>=0);
  render();
}
const isSaved = vin => state.history.some(h=>h.vin===vin);

function download(name, text){
  const url=URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8'}));
  const a=el('a',{href:url,download:name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function render(){
  // tabs
  const tabs = $('#tabs'); tabs.replaceChildren(
    ...[['results','Results'],['saved',`Saved${state.history.length?' '+state.history.length:''}`]].map(([id,l]) =>
      el('button',{id:'tab-'+id,class:'tab',role:'tab','aria-controls':'out',tabindex:state.tab===id?0:-1,'aria-selected':state.tab===id,onclick:()=>{state.tab=id;render();document.getElementById('tab-'+id)?.focus();}},l)));
  const list = state.tab==='results' ? state.results : state.history;
  // filter tokens: one removable token per make, only when comparing several
  const makes = [...new Set(list.map(i=>i.make).filter(Boolean))];
  const tk = $('#tokens');
  tk.hidden = makes.length < 2 || !!(state.tab==='results' && state.loading);
  tk.replaceChildren(el('span',{class:'tokens-label',text:'Showing'}), ...makes.map(m => el('span',{class:'token'+(state.makeOff.has(m)?' off':'')}, m,
    el('button',{'aria-label':(state.makeOff.has(m)?'Show ':'Hide ')+m,onclick:()=>{state.makeOff.has(m)?state.makeOff.delete(m):state.makeOff.add(m);render();}}, icon(state.makeOff.has(m)?'plus':'x')))));
  const shown = list.filter(i => !i.make || !state.makeOff.has(i.make));

  const out = $('#out'); out.replaceChildren(); out.setAttribute('aria-labelledby','tab-'+state.tab);out.setAttribute('aria-busy',String(Boolean(state.tab==='results'&&state.loading)));
  if (state.tab==='results'){
    if (state.loading) out.append(el('div',{class:'list',style:'margin-top:16px'}, Array.from({length:Math.min(state.loading,3)},Skeleton)));
    if (!state.results.length && state.loading) return;
    if (!state.results.length){ out.append(el('div',{style:'margin-top:24px'}, Empty('Nothing decoded yet','Scan a VIN barcode or type one above. The VIN is on the driver door jamb and the base of the windshield.'))); return; }
    out.append(SectionHead(`${shown.length} vehicle${shown.length===1?'':'s'}`,
      el('button',{class:'btn sm plain',onclick:()=>{ currentRequest?.abort(); requestSeq++; currentRequest=null; state.loading=0; state.results=[]; state.open.clear(); state.makeOff.clear(); onInput(); try{history.replaceState(null,'',location.pathname+location.search);}catch(e){} render(); }}, icon('trash'),'Clear'),
      el('button',{class:'btn sm',onclick:()=>download('vins.csv',toCsv(shown))}, icon('download'),'Export CSV')));
  } else {
    if (!state.history.length){
      out.append(extras.savedNotice());
      out.append(el('div',{style:'margin-top:24px'}, Empty('No saved vehicles','Save any result to keep it on this device. Saved vehicles are not synced to the cloud.')));
      return;
    }
    out.append(extras.savedHeader(shown),extras.savedNotice());
  }
  out.append(el('div',{class:'list'}, shown.map(i=>Card(i,{saved:isSaved(i.vin)}))));
}

/* input */
const input = $('#vin-input'), hint = $('#hint'), decodeBtn = $('#decode-btn');
function sizeInput(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,160)+'px'; }
function onInput(){
  sizeInput();
  const r = inspectInput(input.value);
  hint.textContent = r.msg; hint.className = 'hint ' + (r.state==='idle'?'':r.state);
  decodeBtn.disabled = !r.vins.length || !!state.loading;
  decodeBtn.textContent = state.loading ? 'Decoding…' : 'Decode';
}
$('#tabs').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const tabs=[...$('#tabs').querySelectorAll('[role=tab]')];
  const active=tabs.findIndex(t=>t.getAttribute('aria-selected')==='true');
  const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:
    (active+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  e.preventDefault();tabs[next].click();
});
input.addEventListener('input', onInput);
input.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); if(!decodeBtn.disabled) run(); } });
decodeBtn.addEventListener('click', () => run());

let requestSeq=0, currentRequest=null;
async function run(vins){
  vins=vins||inspectInput(input.value).vins;
  if(!vins.length || vins.length>MAX_BATCH) return;
  currentRequest?.abort();
  const controller=new AbortController(), seq=++requestSeq;
  currentRequest=controller;
  state.lastVins=vins;
  $('#err').hidden=true; state.tab='results'; state.loading=vins.length; state.makeOff.clear(); onInput(); render();
  try{
    const fresh=await decodeVins(vins,undefined,undefined,controller.signal);
    if(seq!==requestSeq) return;
    const ids=new Set(fresh.map(r=>r.vin));
    state.results=[...fresh,...state.results.filter(r=>!ids.has(r.vin))];
    state.open=new Set(fresh.length===1?[fresh[0].vin]:[]);
    fx.buzz(fresh.some(r=>!r.decoded)?[20,40,20]:12);
    input.value=''; onInput();
    const first=vins[0].vin||vins[0];
    if(vins.length===1 && /^[A-HJ-NPR-Z0-9]{17}$/.test(first))
      try{history.replaceState(null,'','#'+first);}catch(e){}
    // Show vehicle results first; optional WMI enrichment must not delay them.
    enrichMakers(fresh).then(()=>{if(seq===requestSeq)render();}).catch(()=>{});
  }catch(e){
    if(seq!==requestSeq || e.name==='AbortError') return;
    fx.buzz([40,60,40]); fx.arm(); fx.play('miss');
    const net=e instanceof TypeError || navigator.onLine===false;
    const framed=(()=>{try{return window.top!==window;}catch(x){return true;}})();
    const msg=!net ? e.message
      : framed ? 'This preview blocks NHTSA requests. Open the site in its own tab and retry.'
      : navigator.onLine===false ? 'You appear to be offline. Reconnect and retry.'
      : 'Could not reach NHTSA. Check your connection or content blocker, then retry.';
    const err=$('#err'); err.hidden=false;
    err.replaceChildren(el('span',{text:msg+' '}),el('button',{class:'btn sm',style:'margin-left:8px',onclick:()=>run(state.lastVins)},'Retry'));
  }finally{
    if(seq===requestSeq){state.loading=0;currentRequest=null;onInput();render();}
  }
}

/* ---- scanning ---- */
const FORMATS = ['code_39','code_128','pdf417','data_matrix','qr_code'];
let stream=null, rafId=0, scanning=false, scanStarting=false, preScanFocus=null;

let zxingPromise=null;
async function loadZxing(){
  if(window.ZXing)return window.ZXing;
  if(!zxingPromise)zxingPromise=new Promise((res,rej)=>{
    const script=document.createElement('script');
    script.src='https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
    script.crossOrigin='anonymous';
    script.onload=()=>window.ZXing?res(window.ZXing):rej(new Error('Scanner failed to initialize'));
    script.onerror=()=>rej(new Error('Scanner library unavailable'));
    document.head.append(script);
  }).catch(err=>{zxingPromise=null;throw err;});
  return zxingPromise;
}

let lastRead = null;
/* Live camera reads are noisy: accept a VIN at once only if its check digit passes,
   otherwise require the same read twice in a row. Photos are accepted as-is. */
function onScanText(text, live){
  const vins = extractVins(text);
  if (!vins.length) return false;
  if (live){
    const v = vins[0];
    if (!checkDigitOk(v) && lastRead !== v){ lastRead = v; fx.buzz(8); $('#scan-msg').textContent = 'Hold steady…'; return false; }
  }
  stopScan(); fx.buzz([30,40,30]); fx.play('scan');
  input.value = vins.join('\n'); onInput(); run(vins);
  return true;
}
/* ---- scanning: native BarcodeDetector first, ZXing as an automatic software fallback ---- */
let scanSession = 0, hintTimer = null, zxTimer = null, zxOn = false, zxActive = false, camAdv = {};
const ZX_FORMATS = ['CODE_39','CODE_128','PDF_417','DATA_MATRIX','QR_CODE'];
function zxHints(Z){
  const hints = new Map(); hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const fm = ZX_FORMATS.map(n => Z.BarcodeFormat[n]).filter(x => x !== undefined);
  if (fm.length) hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, fm);
  return hints;
}
/* Only ask for formats this phone supports; a bad format list makes the constructor throw. */
async function makeNativeDetector(){
  if (!('BarcodeDetector' in window)) return null;
  try{
    let opts;
    try{
      const sup = await BarcodeDetector.getSupportedFormats();
      const ok = FORMATS.filter(f => sup.includes(f));
      if (ok.length) opts = {formats: ok};
    }catch(e){}
    return new BarcodeDetector(opts);
  }catch(e){ return null; }
}
/* Ask the camera to keep refocusing; barcodes are small and phones often lock focus far away. */
async function tuneCamera(track){
  camAdv = {};
  try{
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) camAdv.focusMode = 'continuous';
    if (Object.keys(camAdv).length) await track.applyConstraints({advanced:[camAdv]});
  }catch(e){ camAdv = {}; }
}
async function startZxing(session, v){
  if (zxOn || session !== scanSession) return;
  zxOn = true;
  let Z;
  try{ Z = await loadZxing(); }
  catch(e){ if (session === scanSession){ zxOn = false; if (!nativeLive){ stopScan(); toast('Scanner unavailable. Use the photo button.'); } } return; }
  if (session !== scanSession) return;
  const reader = new Z.MultiFormatReader(); reader.setHints(zxHints(Z)); zxActive=true;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', {willReadFrequently:true});
  const step = () => {
    if (!scanning || session !== scanSession) return;
    try{
      if (v.readyState >= 2 && v.videoWidth){
        const k = Math.min(1, 1280 / v.videoWidth);
        const w=Math.round(v.videoWidth*k),h=Math.round(v.videoHeight*k);
        if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
        cx.drawImage(v, 0, 0, cv.width, cv.height);
        const r = reader.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv))));
        if (r && onScanText(r.getText(), true)) return;
      }
    }catch(e){ /* "not found" on every frame without a barcode */ }
    zxTimer = setTimeout(step, 100);
  };
  step();
}
let nativeLive = false;
async function startScan(){
  if(scanning||scanStarting)return;
  if(!navigator.mediaDevices?.getUserMedia){toast('Camera unavailable. Try scanning a photo.');return;}
  const session=++scanSession;scanStarting=true;
  preScanFocus=document.activeElement;
  $('#scan').dataset.on='true';document.body.classList.add('scanning');
  $('#scan-msg').textContent='Opening camera…';$('#scan-close').focus();
  let acquired;
  try{
    acquired=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
    });
  }catch(e){
    if(session!==scanSession)return;
    stopScan();
    toast(e.name==='NotAllowedError'?'Allow camera access in your browser, or scan a photo.':
      e.name==='NotFoundError'?'No camera detected. Try scanning a photo.':
      'Could not open camera. Close other camera apps or scan a photo.');
    return;
  }
  if(session!==scanSession){acquired.getTracks().forEach(t=>t.stop());return;}
  stream=acquired;
  const v=$('#video');v.srcObject=stream;
  try{await v.play();}catch(e){if(session===scanSession){stopScan();toast('Could not start camera preview. Try a photo.');}return;}
  if(session!==scanSession)return;
  fx.arm();scanning=true;scanStarting=false;lastRead=null;nativeLive=false;zxOn=false;zxActive=false;
  $('#scan-msg').textContent='Point at the VIN barcode on the door jamb or windshield';
  const track=stream.getVideoTracks()[0];
  setTorchUi(false);await tuneCamera(track);
  if(session!==scanSession)return;
  hintTimer=setTimeout(()=>{
    if(!scanning||session!==scanSession)return;
    $('#scan-msg').textContent='Hold the barcode flat, 6 to 8 inches away. Try Light if dim.';
    startZxing(session,v);
  },6000);
  const native=await makeNativeDetector();
  if(session!==scanSession)return;
  if(!native){startZxing(session,v);return;}
  nativeLive=true;
  let busy=false,fails=0,good=0,lastFrame=0;
  const tick=async(now=0)=>{
    if(!scanning||session!==scanSession||zxActive)return;
    if(now&&now-lastFrame<170){rafId=requestAnimationFrame(tick);return;}
    lastFrame=now;
    if(!busy&&v.readyState>=2){
      busy=true;
      try{
        const codes=await native.detect(v);good++;fails=0;
        for(const c of codes){if(onScanText(c.rawValue,true))return;}
      }catch(e){fails++;}
      busy=false;
    }
    if(fails>=5&&good===0){nativeLive=false;startZxing(session,v);return;}
    rafId=requestAnimationFrame(tick);
  };
  tick();
}
function stopScan(){
  const wasOpen=scanning||scanStarting;
  scanning=false;scanStarting=false;scanSession++;
  cancelAnimationFrame(rafId);clearTimeout(hintTimer);clearTimeout(zxTimer);
  zxOn=false;zxActive=false;nativeLive=false;
  stream?.getTracks().forEach(t=>t.stop());stream=null;
  $('#video').srcObject=null;$('#scan').dataset.on='false';document.body.classList.remove('scanning');torchOn=false;
  if(wasOpen){preScanFocus?.focus?.();preScanFocus=null;}
}

$('#scan-btn').addEventListener('click', startScan);
function syncFx(){ const b=$('#fx-btn'); b.replaceChildren(icon(fx.on?'sound':'sound-off')); b.setAttribute('aria-pressed', fx.on); b.title = fx.on ? 'Sound and haptics on' : 'Sound and haptics off'; }
$('#fx-btn').addEventListener('click', () => { fx.set(!fx.on); fx.arm(); fx.play('tick'); fx.buzz(10); syncFx(); });
syncFx();
$('#scan-close').addEventListener('click', stopScan);
/* Logo = home: back to a clean Results screen. Decoded vehicles stay in the list (nothing is thrown away). */
$('#home-link').addEventListener('click', e => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;      // let "open in new tab" work
  e.preventDefault();
  if (scanning) stopScan();
  state.tab = 'results'; input.value = ''; onInput(); render();
  try{ history.replaceState(null, '', location.pathname + location.search); }catch(err){}
  scrollTo({top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  if (matchMedia('(pointer:fine)').matches) input.focus();
});
document.addEventListener('keydown',e=>{
  if(!(scanning||scanStarting))return;
  if(e.key==='Escape'){e.preventDefault();stopScan();return;}
  if(e.key==='Tab'){
    const targets=['#scan-close','#fx-btn','#torch-btn'].map($);
    const i=targets.indexOf(document.activeElement);
    if(e.shiftKey&&i<=0){e.preventDefault();targets[targets.length-1].focus();}
    else if(!e.shiftKey&&i===targets.length-1){e.preventDefault();targets[0].focus();}
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(scanning||scanStarting))stopScan();});
addEventListener('pagehide',()=>{if(scanning||scanStarting)stopScan();});
/* flashlight: reflects real state, tries both constraint shapes, says why when unsupported */
let torchOn = false;
function setTorchUi(on){ torchOn = on; const b = $('#torch-btn'); b.setAttribute('aria-pressed', on); b.classList.toggle('lit', on);
  b.replaceChildren(icon(on ? 'bolt-fill' : 'bolt'), document.createTextNode('Light')); }
$('#torch-btn').addEventListener('click', async () => {
  const t = stream?.getVideoTracks()[0]; if (!t) return;
  const want = !torchOn;
  const caps = t.getCapabilities?.() || {};
  if (caps.torch === undefined && !('torch' in (t.getSettings?.() || {}))){
    toast("This camera doesn't support the flashlight here. Try Chrome on Android."); fx.buzz([20,40,20]); return;
  }
  try{
    try{ await t.applyConstraints({advanced:[{...camAdv, torch:want}]}); }
    catch(e){ await t.applyConstraints({torch:want}); }
    setTorchUi(want); fx.buzz(10);
  }catch(e){ toast('Could not switch the flashlight.'); fx.buzz([20,40,20]); }
});

/* photo fallback: decode a still image */
$('#photo-btn').addEventListener('click', () => $('#photo-file').click());
async function readImageFile(f){
  if(!f.type.startsWith('image/')||f.size>15*1024*1024)throw new Error('Select an image smaller than 15 MB.');
  try{
    const det=await makeNativeDetector();
    if(det){
      const bitmap=await createImageBitmap(f);
      try{
        const codes=await det.detect(bitmap), text=codes.map(c=>c.rawValue).join(' ');
        if(extractVins(text).length)return text;
      }finally{bitmap.close?.();}
    }
  }catch(e){ /* Fall back to ZXing. */ }
  const Z = await loadZxing(); const url = URL.createObjectURL(f);
  try{ return (await new Z.BrowserMultiFormatReader(zxHints(Z)).decodeFromImageUrl(url)).getText(); }
  finally{ URL.revokeObjectURL(url); }
}
$('#photo-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value=''; if(!f) return;
  toast('Reading photo…');
  try{
    const text = await readImageFile(f);
    if (!onScanText(text)) toast('Barcode read, but no VIN in it');
  }catch(err){ toast(err.message?.includes('15 MB')?err.message:'No barcode found. Try a closer, sharper photo.'); }
});

render(); onInput();
// deep link: index.html#<VIN> decodes on load
const h0 = extractVins(location.hash.slice(1));
if (h0.length===1) run(h0);
else if (matchMedia('(pointer:fine)').matches) input.focus();
})();


/* Install as a PWA when the page is served over HTTP(S). */
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

