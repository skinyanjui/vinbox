'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Match=require('../epa-match.js');
const EPA=require('../epa.js');
const Extras=require('../extras.js');

// This is the NHTSA model/trim designation shown in the actual VINBOX UI.
// EPA's published model designation differs despite identifying the same car.
const VIN='WDC0G4KB8GF018636';
const source={
  id:37160,year:2016,make:'Mercedes-Benz',model:'GLC300 4matic',
  displ:2,cylinders:4,trany:'Automatic 9-spd',drive:'4-Wheel Drive',
  fuelType1:'Premium Gasoline',tCharger:'T',
  city08:21,highway08:28,comb08:24,fuelCost08:3150
};
const front={
  ...source,id:37159,model:'GLC300',drive:'Front-Wheel Drive',
  city08:22,highway08:28,comb08:24
};
function vin(mods={}){
  return {vin:VIN,decoded:true,hasError:false,flat:{
    ModelYear:'2016',Make:'Mercedes-Benz',Model:'GLC-Class',
    Trim:'GLC300 Base-4M',BodyClass:'Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]',
    DisplacementL:'2.0',EngineCylinders:'4',FuelTypePrimary:'Gasoline',
    DriveType:'AWD/All-Wheel Drive',TransmissionStyle:'Automatic',
    ...mods
  }};
}
const all=['GLC300','GLC300 4matic','GLC350','GLA250 4matic'];
const options=all.map(value=>({value,text:value}));
test('real NHTSA GLC-Class / GLC300 Base-4M resolves to EPA GLC300 4matic',()=>{
  assert.deepEqual(Match.candidates(vin(),options).map(m=>m.value),['GLC300 4matic']);
  assert.equal(Match.assessment(vin(),source).compatible,true);
  assert.equal(Match.uniqueMatch(vin(),[{model:source.model,record:source}]).id,37160);
});
test('GLC300 without 4M and with FWD matches the non-4matic EPA variant',()=>{
  assert.deepEqual(Match.candidates(vin({Trim:'GLC300 Base',DriveType:'Front-Wheel Drive'}),options).map(m=>m.value),['GLC300']);
  assert.equal(Match.assessment(vin({Trim:'GLC300 Base',DriveType:'Front-Wheel Drive'}),front).compatible,true);
  assert.equal(Match.assessment(vin({Trim:'GLC300 Base',DriveType:'Front-Wheel Drive'}),source).compatible,false);
});
test('4M trim without DriveType still rules out ordinary GLC300',()=>{
  const v=vin({DriveType:''});
  assert.deepEqual(Match.candidates(v,options).map(m=>m.value),['GLC300 4matic']);
  assert.equal(Match.assessment(v,source).compatible,true);
  assert.equal(Match.assessment(v,front).compatible,false);
});
test('AWD VIN matches branded 4matic EPA 4-Wheel Drive but not generic Ford 4WD',()=>{
  assert.equal(Match.assessment(vin(),source).compatible,true);
  const unrelated={decoded:true,flat:{Make:'Ford',Model:'F-150',ModelYear:'2022',
    Trim:'XLT',DriveType:'AWD/All-Wheel Drive'}};
  const truck={id:44871,year:2022,make:'Ford',model:'F150 Pickup 4WD',drive:'Part-time 4-Wheel Drive'};
  assert.equal(Match.assessment(unrelated,truck).compatible,false);
});
test('GLC350 cannot be inferred from a VIN whose trim explicitly says GLC300',()=>{
  assert.equal(Match.modelQualifier(vin(),'GLC350 4matic').compatible,false);
  assert.equal(Match.assessment(vin(),{...source,model:'GLC350 4matic'}).compatible,false);
});
test('other class families with distinct engine identifiers match correctly',()=>{
  const c={flat:{Model:'C-Class',Trim:'C300 Base-4M',DriveType:'AWD/All-Wheel Drive'}};
  const cModels=['C300','C300 4matic','C350 4matic'].map(value=>({text:value,value}));
  assert.deepEqual(Match.candidates(c,cModels).map(x=>x.value),['C300 4matic']);
});
test('BMW series number in NHTSA Model can use exact trim designation',()=>{
  const b={flat:{Model:'3 Series',Trim:'330i xDrive',DriveType:'AWD/All-Wheel Drive'}};
  assert.equal(Match.modelQualifier(b,'330i xDrive').compatible,true);
  assert.equal(Match.modelQualifier(b,'320i xDrive').compatible,false);
});
test('manufacturer, year, fuel and engine mismatches still block derived family model',()=>{
  assert.equal(Match.assessment(vin(),{...source,year:2017}).compatible,false);
  assert.equal(Match.assessment(vin(),{...source,displ:3.0}).compatible,false);
  assert.equal(Match.assessment(vin(),{...source,fuelType1:'Diesel'}).compatible,false);
  assert.equal(Match.assessment(vin(),{...source,make:'BMW'}).compatible,false);
});
test('full official EPA menu→options→record flow returns GLC300 4matic with no user choice',async()=>{
  const calls=[],json=obj=>({ok:true,status:200,text:async()=>JSON.stringify(obj)});
  const fetched=async url=>{
    calls.push(url);
    if(url.includes('/menu/make'))return json({menuItem:[{text:'Mercedes-Benz',value:'Mercedes-Benz'}]});
    if(url.includes('/menu/model'))return json({menuItem:options});
    if(url.includes('/menu/options')){
      const model=new URL(url,'https://app.invalid').searchParams.get('model');
      if(model==='GLC300 4matic')return json({menuItem:[{text:'Auto 9-spd, 4 cyl, 2.0 L, Turbo',value:'37160'}]});
      if(model==='GLC300')return json({menuItem:[{text:'Auto 9-spd, 4 cyl, 2.0 L, Turbo',value:'37159'}]});
      throw Error('Unknown model '+model);
    }
    if(url.endsWith('/vehicle/37160'))return json(source);
    if(url.endsWith('/vehicle/37159'))return json(front);
    throw Error('Unexpected EPA URL '+url);
  };
  const selected=await EPA.resolve(vin(),fetched);
  assert.equal(selected.status,'auto');
  assert.equal(selected.id,37160);
  assert.equal(selected.model,'GLC300 4matic');
  assert.equal(calls.filter(u=>u.includes('/menu/options')).length,1);
  assert.equal(calls.filter(u=>u.endsWith('/vehicle/37160')).length,1);
  assert.equal(calls.some(u=>u.endsWith('/vehicle/37159')),false);
  assert.equal(calls.every(u=>!u.includes(VIN)),true);
});
test('EPA source record metrics are accurate for the supplied Mercedes VIN',()=>{
  const m=EPA.metrics(source);
  assert.equal(m.combined,24);
  assert.equal(m.city,21);
  assert.equal(m.highway,28);
  assert.equal(m.yearlyCost,3150);
  assert.equal(m.unit,'MPG');
});
test('card automatically displays EPA record when resolver identifies the VIN',async()=>{
  const it=vin();
  const state={history:[],makeOff:new Set()};
  const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...nodes){this.children.push(...nodes)}});
  const ui=Extras({state,el,icon:()=>({}),render(){},save(){return true},
    SectionHead(){return {}},download(){},toCsv(){return ''}});
  const old={resolve:EPA.resolve,vehicle:EPA.vehicle};
  const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...(n.children||[]).flatMap(nodes)]:[];
  EPA.resolve=async()=>({status:'auto',id:37160,model:'GLC300 4matic'});
  EPA.vehicle=async()=>source;
  try{
    ui.EpaPanel(it);
    for(let i=0;i<40;i++)await Promise.resolve();
    const all=nodes(ui.EpaPanel(it));
    assert.equal(all.some(n=>n.tag==='select'),false);
    assert.ok(all.some(n=>n.attrs?.class==='epa-metrics'));
    assert.equal(it.epaId,37160);
    assert.equal(it.epaModel,'GLC300 4matic');
  }finally{Object.assign(EPA,old);}
});
