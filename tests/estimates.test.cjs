'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Match=require('../epa-match.js');
const EPA=require('../epa.js');
const Extras=require('../extras.js');

function vin(make,model,other={}){
  return {vin:'1HGCM82633A004352',title:make+' '+model,decoded:true,hasError:false,
    flat:{Make:make,Model:model,ModelYear:'2022',FuelTypePrimary:'Gasoline',TransmissionStyle:'Automatic',...other}};
}
const toyota=vin('Toyota','RAV4',{BodyClass:'Sport Utility Vehicle',DisplacementL:'2.5',EngineCylinders:'4',DriveType:'Front-Wheel Drive',TransmissionSpeeds:'8'});
const ford=vin('Ford','F-150',{DisplacementL:'2.7',EngineCylinders:'6',TransmissionSpeeds:'10',DriveType:'4-Wheel Drive'});
function car(id,make,model,displ,cyl,trany,drive,city,highway,combined,cost,extra={}){
  return {id,year:2022,make,model,displ,cylinders:cyl,trany,drive,city08:city,highway08:highway,comb08:combined,
    fuelCost08:cost,fuelType1:'Regular Gasoline',...extra};
}
const rav=[
  car(44991,'Toyota','RAV4',2.5,4,'Automatic (S8)','Front-Wheel Drive',27,35,30,2000,{startStop:'N'}),
  car(44992,'Toyota','RAV4',2.5,4,'Automatic (S8)','Front-Wheel Drive',27,35,30,2000,{startStop:'Y'})
];
const f150=[
  car(44871,'Ford','F150 Pickup 4WD',2.7,6,'Automatic (S10)','Part-time 4-Wheel Drive',19,24,21,2850,{startStop:'Y'}),
  car(44877,'Ford','F150 Pickup 4WD',2.7,6,'Automatic (S10)','Part-time 4-Wheel Drive',17,23,20,3000,{startStop:'N'})
];
const estimate=(it,records)=>EPA.estimateFromCandidates(it,Match.uniqueMatch(it,
  records.map(record=>({record,model:record.model}))));

test('official RAV4 variant ratings collapse into one combined/city/highway value',()=>{
  const r=estimate(toyota,rav);
  assert.equal(r.status,'estimate');assert.equal(r.reason,'shared-rating');
  assert.deepEqual(r.data.combined,{min:30,max:30});
  assert.deepEqual(r.data.city,{min:27,max:27});
  assert.deepEqual(r.data.highway,{min:35,max:35});
  assert.deepEqual(r.data.yearlyCost,{min:2000,max:2000});
});
test('official F150 2.7L 4WD variants yield honest range, not made-up average',()=>{
  const r=estimate(ford,f150);
  assert.equal(r.status,'estimate');assert.equal(r.reason,'range');
  assert.deepEqual(r.data.combined,{min:20,max:21});
  assert.deepEqual(r.data.yearlyCost,{min:2850,max:3000});
});
test('EPA mixed fuel types must not collapse into a fake common rating',()=>{
  const bad=[rav[0],{...rav[1],id:55123,fuelType1:'Diesel'}];
  const r=estimate(toyota,bad);
  // One incompatible EPA variant is excluded; the remaining verified record
  // is a unique match, not evidence of a shared two-option rating.
  assert.equal(r,null);
});
test('missing combined MPG on a viable candidate prohibits summary',()=>{
  assert.equal(estimate(toyota,[rav[0],{...rav[1],comb08:0}]),null);
});
test('unknown hybrid status blocks estimated MPG from mixed hybrid evidence',()=>{
  const testVin=vin('Honda','Insight',{DisplacementL:'1.5',EngineCylinders:'4'});
  const records=[car(50001,'Honda','Insight',1.5,4,'Automatic (variable gear ratios)','Front-Wheel Drive',51,45,48,1250,{atvType:'Hybrid'}),
    car(50002,'Honda','Insight',1.5,4,'Automatic (variable gear ratios)','Front-Wheel Drive',51,45,48,1250,{atvType:'Hybrid'})];
  assert.equal(estimate(testVin,records),null);
});
test('manual gear-count mismatch must be rejected before EPA fetch',()=>{
  const it=vin('Honda','Civic',{TransmissionStyle:'Automatic',TransmissionSpeeds:'6'});
  assert.equal(Match.optionCompatible(it,{text:'Auto (S10), 4 cyl, 2.0 L'}),false);
});
test('NHTSA CVT is not matched to stepped automatic EPA record',()=>{
  const it=vin('Honda','Civic',{TransmissionStyle:'Continuously Variable Transmission (CVT)'});
  const record=car(50003,'Honda','Civic 4Dr',2,4,'Automatic (S10)','Front-Wheel Drive',20,30,25,2200);
  assert.equal(Match.assessment(it,record).compatible,false);
  assert.equal(Match.assessment(it,{...record,trany:'Automatic (AV-S7)'}).compatible,true);
});
test('partial VIN and wrong year cannot yield EPA estimate',()=>{
  assert.equal(estimate({...toyota,hasError:true},rav),null);
  assert.equal(estimate({...toyota,flat:{...toyota.flat,ModelYear:'2023'}},rav),null);
});
test('EPA cost and MPG ranges respect source extrema independently',()=>{
  const r=estimate(ford,[f150[0],{...f150[1],fuelCost08:3100}]);
  assert.deepEqual(r.data.combined,{min:20,max:21});
  assert.deepEqual(r.data.yearlyCost,{min:2850,max:3100});
});
test('unavailable cost on one viable variant never invents average cost',()=>{
  const r=estimate(toyota,[rav[0],{...rav[1],fuelCost08:0}]);
  assert.equal(r.status,'estimate');assert.equal(r.data.yearlyCost,null);
});
const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...x){this.children.push(...x)}});
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...(n.children||[]).flatMap(nodes)]:[];
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
function harness(it){
  const state={history:[it],makeOff:new Set()};
  const ui=Extras({state,el,icon:()=>({}),render(){},save(){return true},SectionHead:()=>({}),download(){},toCsv(){return ''},toast(){}});
  return ui;
}
test('verified range shown without dropdown or invented EPA id',async()=>{
  const v={...ford,vin:'1FTEX1EP0NFA00000'};
  const old=EPA.resolve,ui=harness(v);
  EPA.resolve=async()=>estimate(ford,f150);
  try{
    ui.EpaPanel(v);await flush();
    const all=nodes(ui.EpaPanel(v));
    assert.equal(all.some(x=>x.tag==='select'),false);
    assert.ok(all.some(x=>x.attrs?.text==='20–21'));
    assert.ok(all.some(x=>String(x.attrs?.text||'').includes('2 compatible configurations')));
    assert.equal(v.epaId,undefined);
  }finally{EPA.resolve=old}
});
test('identical ratings displayed without selecting one RAV4 configuration',async()=>{
  const v={...toyota,vin:'2T3W1RFV0NW000000'},ui=harness(v),old=EPA.resolve;
  EPA.resolve=async()=>estimate(toyota,rav);
  try{
    ui.EpaPanel(v);await flush();
    const all=nodes(ui.EpaPanel(v));
    assert.ok(all.some(n=>n.attrs?.text==='30'));
    assert.ok(all.some(n=>String(n.attrs?.text||'').includes('Same EPA ratings')));
    assert.equal(all.some(n=>n.tag==='select'),false);
  }finally{EPA.resolve=old}
});

test('EPA network resolver returns shared RAV4 rating with no manual choice',async()=>{
  const urls=[];
  const menus=(values)=>({menuItem:values.map(v=>({text:v.text||v,value:v.value||v}))});
  const network=async(url)=>{
    urls.push(url);
    let body;
    if(url.includes('/menu/make'))body=menus(['Toyota','Ford']);
    else if(url.includes('/menu/model'))body=menus(['RAV4','RAV4 Hybrid']);
    else if(url.includes('/menu/options'))body=menus([
      {text:'Auto (S8), 4 cyl, 2.5 L',value:'44991'},
      {text:'Auto (S8), 4 cyl, 2.5 L; Stop-Start',value:'44992'}]);
    else if(url.endsWith('/vehicle/44991'))body=rav[0];
    else if(url.endsWith('/vehicle/44992'))body=rav[1];
    else throw Error('Unexpected EPA endpoint '+url);
    return {ok:true,status:200,text:async()=>JSON.stringify(body)};
  };
  const result=await EPA.resolve({...toyota,flat:{...toyota.flat,ModelYear:'2022'}},network);
  assert.equal(result.status,'estimate');
  assert.equal(result.data.combined.min,30);
  assert.equal(result.reason,'shared-rating');
  assert.equal(urls.filter(x=>x.includes('/vehicle/449')).length,2);
  assert.ok(urls.every(x=>!x.includes(toyota.vin)));
});
test('EPA network resolver returns verified 20-21 MPG Ford range',async()=>{
  const options={menuItem:[
    {text:'Auto (S10), 6 cyl, 2.7 L, Turbo',value:'44871'},
    {text:'Auto (S10), 6 cyl, 2.7 L, Turbo; Stop-Start',value:'44877'}]};
  const network=async url=>{
    let result;
    if(url.includes('/menu/make'))result={menuItem:[{text:'Toyota',value:'Toyota'},{text:'Ford',value:'Ford'}]};
    else if(url.includes('/menu/model'))result={menuItem:[{text:'F150 Pickup 4WD',value:'F150 Pickup 4WD'}]};
    else if(url.includes('/menu/options'))result=options;
    else if(url.endsWith('/44871'))result={...f150[0],tCharger:'T'};
    else if(url.endsWith('/44877'))result={...f150[1],tCharger:'T'};
    else throw Error(url);
    return {ok:true,status:200,text:async()=>JSON.stringify(result)};
  };
  const r=await EPA.resolve({...ford,flat:{...ford.flat,Turbo:'Yes'}},network);
  assert.equal(r.status,'estimate');
  assert.deepEqual(r.data.combined,{min:20,max:21});
});
test('unit-consistent range refuses to combine EV MPGe and gasoline MPG',()=>{
  const v=vin('Tesla','Model 3',{ModelYear:'2022',FuelTypePrimary:'Electricity',ElectrificationLevel:'BEV'});
  const a=car(880001,'Tesla','Model 3',0,0,'Automatic','Rear-Wheel Drive',125,112,120,750,{atvType:'EV',fuelType1:'Electricity'});
  const b=car(880002,'Tesla','Model 3',0,0,'Automatic','Rear-Wheel Drive',125,112,120,750,{fuelType1:'Regular Gasoline'});
  assert.equal(estimate(v,[a,b]),null);
});

test('redecoding the same VIN with changed NHTSA attributes invalidates stale EPA data',async()=>{
  const same=vin('Toyota','RAV4',{DisplacementL:'2.5'});
  const ui=harness(same),old=EPA.resolve;
  let lookups=0;
  EPA.resolve=async it=>({status:'unavailable',message:'VIN engine '+it.flat.DisplacementL+' result '+(++lookups)});
  try{
    ui.EpaPanel(same);await flush();
    assert.equal(lookups,1);
    const changed={...same,flat:{...same.flat,DisplacementL:'3.5'}};
    ui.EpaPanel(changed);await flush();
    assert.equal(lookups,2);
    const messages=nodes(ui.EpaPanel(changed)).map(n=>n.attrs?.text).filter(Boolean);
    assert.ok(messages.some(x=>String(x).includes('VIN engine 3.5')));
  }finally{EPA.resolve=old}
});
test('electricity consumption preserves official decimal precision',()=>{
  const result=EPA.metrics({id:80003,atvType:'EV',fuelType1:'Electricity',combE:'28.6',comb08:'118',city08:'125',highway08:'109'});
  assert.equal(result.kwhPer100,28.6);
  assert.equal(result.combined,118);
  assert.equal(result.unit,'MPGe');
});
