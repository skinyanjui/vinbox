'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../epa-match.js');
const E=require('../epa.js');
const X=require('../extras.js');
const vin=(f={},v={})=>({vin:'1HGCM82633A004352',title:'Honda Civic',decoded:true,hasError:false,flat:{
  ModelYear:'2022',Make:'Honda',Model:'Civic',BodyClass:'Sedan/Saloon',DisplacementL:'2.0',
  EngineCylinders:'4',DriveType:'Front-Wheel Drive',FuelTypePrimary:'Gasoline',
  TransmissionStyle:'Automatic',...f},...v});
const epa=(f={})=>({id:44133,year:2022,make:'Honda',model:'Civic 4Dr',displ:2,cylinders:4,
  drive:'Front-Wheel Drive',trany:'Automatic (variable gear ratios)',
  fuelType1:'Regular Gasoline',comb08:35,...f});
const result=(v,rs)=>M.uniqueMatch(v,rs.map(record=>({record,model:record.model}))).status;
const cases=[
  ['matching vehicle',()=>result(vin(),[epa()]),'auto'],
  ['duplicate EPA ID deduped',()=>result(vin(),[epa(),epa()]),'auto'],
  ['different EPA IDs stay ambiguous',()=>result(vin(),[epa(),epa({id:44134})]),'ambiguous'],
  ['wrong year',()=>result(vin(),[epa({year:2023})]),'unavailable'],
  ['wrong make',()=>result(vin(),[epa({make:'Toyota'})]),'unavailable'],
  ['wrong model',()=>result(vin(),[epa({model:'Accord'})]),'unavailable'],
  ['wrong engine',()=>result(vin({DisplacementL:'1.5'}),[epa()]),'unavailable'],
  ['wrong cylinders',()=>result(vin({EngineCylinders:'6'}),[epa()]),'unavailable'],
  ['wrong drivetrain',()=>result(vin({DriveType:'All-Wheel Drive'}),[epa()]),'unavailable'],
  ['wrong transmission type',()=>result(vin({TransmissionStyle:'Manual'}),[epa()]),'unavailable'],
  ['six-speed vs ten-speed',()=>result(vin({TransmissionSpeeds:'6'}),[epa({trany:'Automatic (S10)'})]),'unavailable'],
  ['matching ten-speed',()=>result(vin({TransmissionSpeeds:'10'}),[epa({trany:'Automatic (S10)'})]),'auto'],
  ['10-speed option filtered before API fetch',()=>M.optionCompatible(vin({TransmissionSpeeds:'6'}),{text:'Auto (S10), 4 cyl, 2.0 L'}),false],
  ['gasoline vs electric',()=>result(vin(),[epa({atvType:'EV',fuelType1:'Electricity'})]),'unavailable'],
  ['CNG vs gasoline',()=>result(vin({FuelTypePrimary:'CNG'}),[epa()]),'unavailable'],
  ['LPG vs gasoline',()=>result(vin({FuelTypePrimary:'Propane'}),[epa()]),'unavailable'],
  ['diesel vs gasoline',()=>result(vin({FuelTypePrimary:'Diesel'}),[epa()]),'unavailable'],
  ['gasoline vs diesel',()=>result(vin(),[epa({fuelType1:'Diesel'})]),'unavailable'],
  ['BEV vs gasoline',()=>result(vin({FuelTypePrimary:'Electricity',ElectrificationLevel:'BEV'}),[epa()]),'unavailable'],
  ['BEV vs EV',()=>result(vin({FuelTypePrimary:'Electricity',ElectrificationLevel:'BEV'}),[epa({atvType:'EV',fuelType1:'Electricity'})]),'auto'],
  ['HEV vs nonhybrid',()=>result(vin({ElectrificationLevel:'HEV'}),[epa()]),'unavailable'],
  ['HEV vs hybrid',()=>result(vin({ElectrificationLevel:'HEV'}),[epa({atvType:'Hybrid'})]),'auto'],
  ['PHEV vs HEV',()=>result(vin({ElectrificationLevel:'PHEV'}),[epa({atvType:'Hybrid'})]),'unavailable'],
  ['PHEV vs PHEV',()=>result(vin({ElectrificationLevel:'PHEV'}),[epa({atvType:'Plug-in Hybrid'})]),'auto'],
  ['unverified hybrid requires selection',()=>result(vin(),[epa({atvType:'Hybrid'})]),'ambiguous'],
  ['unknown turbo requires selection when VIN says yes',()=>result(vin({Turbo:'Yes'}),[epa()]),'ambiguous'],
  ['turbo no vs EPA turbo',()=>result(vin({Turbo:'No'}),[epa({tCharger:'T'})]),'unavailable'],
  ['turbo yes vs naturally aspirated',()=>result(vin({Turbo:'Yes'}),[epa({eng_dscr:'Naturally Aspirated',tCharger:'N'})]),'unavailable'],
  ['turbo yes and EPA turbo yes',()=>result(vin({Turbo:'Yes'}),[epa({tCharger:'T'})]),'auto'],
  ['partial VIN',()=>result(vin({}, {hasError:true}),[epa()]),'ambiguous'],
  ['missing model',()=>result(vin({Model:''}),[epa()]),'unavailable'],
  ['executive not EX',()=>M.modelQualifier(vin({Trim:'Executive'}),'Civic EX').compatible,false],
  ['EX is EX',()=>M.modelQualifier(vin({Trim:'EX'}),'Civic EX').compatible,true],
  ['F-150 alias',()=>M.modelQualifier(vin({Model:'F-150',DriveType:'4-Wheel Drive'}),'F150 4WD').compatible,true],
  ['mixed gas and electric HEV labels still match verified hybrid',()=>result(vin({FuelTypePrimary:'Gasoline / Electricity',ElectrificationLevel:'HEV'}),[epa({atvType:'Hybrid'})]),'auto'],
  ['mixed gas and electric without electrification cannot auto match',()=>result(vin({FuelTypePrimary:'Gasoline / Electricity'}),[epa({atvType:'Hybrid'})]),'ambiguous'],
  ['AWD and part-time 4WD are not automatically treated as identical',()=>result(vin({DriveType:'4-Wheel Drive'}),[epa({drive:'All-Wheel Drive'})]),'unavailable'],
  ['hatch VIN vs sedan EPA',()=>result(vin({BodyClass:'Hatchback/Liftback'}),[epa()]),'unavailable']
];
for(const [name,fn,expected] of cases)test(name,()=>assert.equal(fn(),expected));
const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...parts){this.children.push(...parts)}});
const nodes=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(nodes)]:[];
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const setup=saved=>{const state={history:saved,makeOff:new Set()};let writes=0;const ui=X({
  state,el,icon:()=>({}),render(){},save(){writes++;return true},SectionHead:()=>({}),download(){},toCsv(){return ''},toast(){}});
  return {state,ui,writes:()=>writes};
};
test('saved EPA ID from wrong model does not display MPG',async()=>{
  const v=vin();v.epaId=1234;v.epaModel='Accord';
  const h=setup([v]),prev={vehicle:E.vehicle,resolve:E.resolve};
  E.vehicle=async()=>epa({id:1234,model:'Accord'});
  E.resolve=async()=>({status:'unavailable',message:'No compatible EPA record was found.'});
  try{h.ui.EpaPanel(v);await flush();const dom=nodes(h.ui.EpaPanel(v));
    assert.ok(!dom.some(n=>n.attrs?.class==='epa-metrics'));
    assert.ok(dom.some(n=>String(n.attrs?.text||'').includes('No compatible EPA record')));
    assert.equal(v.epaId,undefined);
    assert.equal(h.writes(),1);
  }finally{Object.assign(E,prev);}
});
test('saved correct EPA ID displays verified rating',async()=>{
  const v=vin();v.epaId=44133;v.epaModel='Civic 4Dr';
  const h=setup([v]),prev=E.vehicle;E.vehicle=async()=>epa();
  try{h.ui.EpaPanel(v);await flush();assert.ok(nodes(h.ui.EpaPanel(v)).some(n=>n.attrs?.class==='epa-metrics'));}
  finally{E.vehicle=prev;}
});
test('manual engine conflict cannot display incorrect MPG',async()=>{
  const v=vin(),h=setup([]),prev={resolve:E.resolve,vehicle:E.vehicle};
  E.resolve=async()=>({status:'choose-option',model:'Civic 4Dr',options:[{text:'1.5 L',value:'1234'}]});
  E.vehicle=async()=>epa({id:1234,displ:1.5,comb08:42});
  try{h.ui.EpaPanel(v);await flush();const selector=nodes(h.ui.EpaPanel(v)).find(n=>n.tag==='select');
    assert.ok(selector);selector.attrs.onchange({target:{value:'1234'}});await flush();
    assert.ok(!nodes(h.ui.EpaPanel(v)).some(n=>n.attrs?.class==='epa-metrics'));
    assert.equal(v.epaId,undefined);
  }finally{Object.assign(E,prev);}
});
test('single-option model chosen with conflicting engine fails validation',async()=>{
  const v=vin(),h=setup([]),prev={resolve:E.resolve,choices:E.choices,vehicle:E.vehicle};
  E.resolve=async()=>({status:'choose-model',year:2022,make:'Honda',models:[{text:'Civic 4Dr',value:'Civic 4Dr'}]});
  E.choices=async()=>({status:'choose-option',model:'Civic 4Dr',options:[{text:'1.5L',value:'1234'}]});
  E.vehicle=async()=>epa({id:1234,displ:1.5});
  try{h.ui.EpaPanel(v);await flush();const selector=nodes(h.ui.EpaPanel(v)).find(n=>n.tag==='select');
    assert.ok(selector);selector.attrs.onchange({target:{value:'Civic 4Dr'}});await flush();
    assert.ok(!nodes(h.ui.EpaPanel(v)).some(n=>n.attrs?.class==='epa-metrics'));
    assert.equal(v.epaId,undefined);
  }finally{Object.assign(E,prev);}
});
test('manual valid selection displays and persists EPA id/model',async()=>{
  const v=vin(),h=setup([v]),prev={resolve:E.resolve,vehicle:E.vehicle};
  E.resolve=async()=>({status:'choose-option',model:'Civic 4Dr',options:[{text:'2L',value:'44133'}]});
  E.vehicle=async()=>epa();
  try{h.ui.EpaPanel(v);await flush();const selector=nodes(h.ui.EpaPanel(v)).find(n=>n.tag==='select');
    assert.ok(selector);selector.attrs.onchange({target:{value:'44133'}});await flush();
    assert.equal(v.epaId,44133);assert.equal(v.epaModel,'Civic 4Dr');
    assert.equal(h.writes(),1);assert.ok(nodes(h.ui.EpaPanel(v)).some(n=>n.attrs?.class==='epa-metrics'));
  }finally{Object.assign(E,prev);}
});

test('duplicate EPA menu IDs cause just one vehicle record fetch',async()=>{
  const v=vin({ModelYear:'2027'});
  const calls=[];
  const response=payload=>({ok:true,status:200,text:async()=>JSON.stringify(payload)});
  const fetchImpl=async(url)=>{
    calls.push(url);
    if(url.includes('/menu/make'))return response({menuItem:[{text:'Honda',value:'Honda'}]});
    if(url.includes('/menu/model'))return response({menuItem:[{text:'Civic 4Dr',value:'Civic 4Dr'}]});
    if(url.includes('/menu/options'))return response({menuItem:[
      {text:'Auto CVT, 4 cyl, 2.0 L',value:'99321'},
      {text:'Auto CVT, 4 cyl, 2.0 L',value:'99321'}]});
    return response({...epa({id:99321,year:2027})});
  };
  const result=await E.resolve(v,fetchImpl);
  assert.equal(result.status,'auto');
  assert.equal(result.id,99321);
  assert.equal(calls.filter(x=>x.endsWith('/vehicle/99321')).length,1);
});
