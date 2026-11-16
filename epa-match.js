/* Deterministic VIN→EPA evidence matching. No make/model/trim guesses. */
(function(root){
'use strict';
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
const tokens=s=>norm(s).split(' ').filter(Boolean);
const truth=s=>/^(yes|true|1)$/i.test(String(s||'').trim());
const no=s=>/^(no|false|0)$/i.test(String(s||'').trim());
function body(it){
  const s=norm(it.flat?.BodyClass);
  if(/sedan|saloon/.test(s))return 'sedan';
  if(/hatchback|liftback|wagon/.test(s))return 'hatch';
  if(/coupe/.test(s))return 'coupe';
  if(/convertible|cabriolet|roadster/.test(s))return 'convertible';
  return '';
}
function drive(s){
  const v=norm(s);
  if(/\b(front wheel|fwd)\b/.test(v))return 'fwd';
  if(/\b(rear wheel|rwd)\b/.test(v))return 'rwd';
  if(/\b(all wheel|awd)\b/.test(v))return 'awd';
  if(/\b(4 wheel|four wheel|4wd|4x4)\b/.test(v))return '4wd';
  if(/\b(2 wheel|two wheel|2wd)\b/.test(v))return '2wd';
  return '';
}
function trans(s){
  const v=norm(s);
  if(/\b(manual|man|m6|m5)\b/.test(v)&&!/\bautomated manual\b/.test(v))return 'manual';
  if(/\b(automatic|auto|cvt|variable gear ratios|continuously variable|av s[0-9]+)\b/.test(v))return 'automatic';
  return '';
}
function electrification(it){
  const s=norm(it.flat?.ElectrificationLevel||'');
  const f=norm(it.flat?.FuelTypePrimary||'')+' '+norm(it.flat?.FuelTypeSecondary||'');
  if(/plug in hybrid|phev/.test(s))return 'phev';
  if(/battery electric|bev/.test(s)||(/electric/.test(f)&&!/gasoline|diesel|hybrid/.test(f)))return 'electric';
  if(/\bhev\b|hybrid electric vehicle/.test(s))return 'hybrid';
  if(/not electrified|non electrified/.test(s))return 'nonhybrid';
  return '';
}
function modelQualifier(it,name){
  const base=tokens(it.flat?.Model||it.model);
  const v=tokens(name);
  if(!base.length)return {compatible:false};
  const direct=v.slice(0,base.length).join('|')===base.join('|');
  // Normalize punctuation in model designations such as F-150/F150 and
  // Model 3/Model3 without broadly treating unrelated prefixes as aliases.
  const compactAlias=!direct&&base.length>1&&v[0]===base.join('');
  if(!direct&&!compactAlias)return {compatible:false};
  const tail=(direct?v.slice(base.length):v.slice(1)).join(' ');
  const b=body(it),d=drive(it.flat?.DriveType),e=electrification(it);
  if(/\b4dr\b/.test(tail)&&b==='hatch')return {compatible:false};
  if(/\b5dr\b/.test(tail)&&b==='sedan')return {compatible:false};
  if(/\b2dr\b/.test(tail)&&b==='sedan')return {compatible:false};
  if(/\b(4dr|5dr|2dr)\b/.test(tail)&&b==='coupe'&&!/\b2dr\b/.test(tail))return {compatible:false};
  const modelDrive=drive(tail);
  if(d&&modelDrive&&d!==modelDrive&&!(d==='2wd'&&['fwd','rwd'].includes(modelDrive)))return {compatible:false};
  if(e==='nonhybrid'&&/\b(hybrid|plug in|electric)\b/.test(tail))return {compatible:false};
  if(e==='hybrid'&&/\b(plug in|ev|electric only)\b/.test(tail))return {compatible:false};
  if(e==='electric'&&/\bhybrid\b/.test(tail))return {compatible:false};
  if(e==='phev'&&/\b(ev|electric only)\b/.test(tail))return {compatible:false};
  let evidence=0,trimMatched=false;
  if((b==='sedan'&&/\b4dr\b/.test(tail))||(b==='hatch'&&/\b5dr\b/.test(tail))||(b==='coupe'&&/\b2dr\b/.test(tail)))evidence++;
  if(d&&modelDrive)evidence++;
  if((e==='hybrid'&&/\bhybrid\b/.test(tail))||(e==='phev'&&/plug in/.test(tail))||(e==='electric'&&/\bev\b/.test(tail)))evidence++;
  const trim=norm(it.flat?.Trim);
  if(trim&&/\b(sport|touring|si|type r|limited|se|xl|lx|ex)\b/.test(tail)){
    const named=['sport','touring','si','type r','limited','se','xl','lx','ex'].filter(w=>new RegExp('(?:^| )'+w+'(?: |$)').test(tail));
    if(named.length&&!named.some(w=>trim.includes(w)))return {compatible:false};
    if(named.length&&named.some(w=>trim.includes(w))){evidence++;trimMatched=true;}
  }
  return {compatible:true,evidence,trimMatched,model:name,exact:tail.length===0};
}
function candidates(it,models){
  const all=models.map(m=>({...m,...modelQualifier(it,m.value)})).filter(m=>m.compatible);
  // Official EPA models sometimes separate an explicitly decoded trim
  // (e.g. Insight Touring) from the generic non-Touring carline.
  return all.some(m=>m.trimMatched)?all.filter(m=>m.trimMatched):all;
}
function optionCompatible(it,option){
  const s=String(option.text||'');
  const displacement=Number(it.flat?.DisplacementL);
  const matchDispl=s.match(/\b(\d+(?:\.\d+)?)\s*L\b/i);
  if(displacement>0&&matchDispl&&Math.abs(displacement-Number(matchDispl[1]))>0.16)return false;
  const cyl=Number(it.flat?.EngineCylinders);
  const matchCyl=s.match(/\b(\d+)\s*-?\s*cyl\b/i);
  if(cyl>0&&matchCyl&&cyl!==Number(matchCyl[1]))return false;
  const vinTrans=trans(it.flat?.TransmissionStyle);
  const optionTrans=trans(s);
  if(vinTrans&&optionTrans&&vinTrans!==optionTrans)return false;
  if(no(it.flat?.Turbo)&&/\bturbo\b/i.test(s))return false;
  return true;
}
function assessment(it,record,model){
  const q=modelQualifier(it,model||record.model);
  if(!q.compatible||norm(record.model)!==norm(model||record.model))return {compatible:false,evidence:0};
  const f=it.flat||{},reasons=[];
  const year=Number(f.ModelYear||it.year);
  if(year&&Number(record.year)!==year)return {compatible:false};
  const make=norm(f.Make||it.make);
  if(make&&norm(record.make)!==make)return {compatible:false};
  const compareNumber=(a,b,tolerance,label)=>{
    const n=Number(a),m=Number(b);
    if(n>0&&m>0){
      if(Math.abs(n-m)>tolerance)return false;
      reasons.push(label);
    }
    return true;
  };
  if(!compareNumber(f.DisplacementL,record.displ,0.16,'engine'))return {compatible:false};
  if(!compareNumber(f.EngineCylinders,record.cylinders,0,'cylinders'))return {compatible:false};
  const actualDrive=drive(record.drive),vinDrive=drive(f.DriveType);
  if(vinDrive&&actualDrive){
    if(vinDrive!==actualDrive&&!(vinDrive==='2wd'&&['fwd','rwd'].includes(actualDrive)))
      return {compatible:false};
    reasons.push('drivetrain');
  }
  const vinTrans=trans(f.TransmissionStyle),epaTrans=trans(record.trany);
  if(vinTrans&&epaTrans){
    if(vinTrans!==epaTrans)return {compatible:false};
    reasons.push('transmission');
  }
  const ev=electrification(it);
  const kind=norm(record.atvType||record.atvtype),fuel=norm(record.fuelType1);
  if(ev==='electric'&&!/(^ev$|^electricity$)/.test(kind)&&!/\belectricity\b/.test(fuel))return {compatible:false};
  if(ev==='nonhybrid'&&/(hybrid|^ev$)/.test(kind))return {compatible:false};
  if(ev==='hybrid'&&/(plug in hybrid|^ev$)/.test(kind))return {compatible:false};
  if(ev==='phev'&&kind!=='plug in hybrid')return {compatible:false};
  if(ev==='electric'||ev==='hybrid'||ev==='phev')reasons.push('electrification');
  const mainFuel=norm(f.FuelTypePrimary);
  if(mainFuel.includes('diesel')&&fuel&&!fuel.includes('diesel'))return {compatible:false};
  if(mainFuel.includes('gasoline')&&fuel&&/diesel/.test(fuel))return {compatible:false};
  if(no(f.Turbo)&&/\bturbo\b/.test(norm(record.eng_dscr)))return {compatible:false};
  return {compatible:true,evidence:reasons.length+q.evidence,reasons,model:model||record.model};
}
function uniqueMatch(it,records){
  const valid=records.filter(r=>r&&r.record).map(r=>{
    const result=assessment(it,r.record,r.model);
    return {...r,...result};
  }).filter(x=>x.compatible);
  // Never infer a VIN-exact configuration from a partial/failed decode.
  if(it.hasError||!it.decoded)return {status:'ambiguous',remaining:valid};
  if(valid.length===1&&valid[0].evidence>0)return {status:'auto',id:Number(valid[0].record.id),model:valid[0].model,evidence:valid[0].reasons};
  return {status:valid.length?'ambiguous':'unavailable',remaining:valid};
}
const api={norm,body,drive,trans,electrification,modelQualifier,candidates,optionCompatible,assessment,uniqueMatch};
root.VinEpaMatch=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
