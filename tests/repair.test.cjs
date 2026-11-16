'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Backup=require('../backup.js');
// Node runs each test file independently; mirror the browser script order.
require('../epa-match.js');
const EPA=require('../epa.js');
const create=require('../extras.js');
const VIN='1HGCM82633A004352';
const record={vin:VIN,title:'2003 Honda Accord',year:'2003',make:'Honda',decoded:true,
  flat:{ModelYear:'2003',Make:'Honda',Model:'Accord'},facts:['Sedan'],
  groups:[{name:'Vehicle',rows:[['Type','Sedan']]}],epaId:123,epaModel:'Accord'};
function widget(){
  let persisted=0,fail=false,renders=0;
  const state={history:[structuredClone(record)],makeOff:new Set()};
  const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...more){this.children.push(...more);}});
  const extras=create({state,el,icon:()=>({}),render:()=>{renders++;},save:()=>{persisted++;return !fail;},
    SectionHead:(title,...buttons)=>({title,buttons}),download:()=>{},toCsv:()=>'',toast:()=>{}});
  return {extras,state,el,fail:()=>{fail=true;},get writes(){return persisted;},get renders(){return renders;}};
}
test('101st saved vehicle is rejected instead of silently evicting the oldest',()=>{
  const list=Array.from({length:100},(_,i)=>({vin:'VIN'+i}));
  assert.equal(Backup.canAdd(list,'ANOTHER'),false);
  assert.equal(Backup.canAdd(list,'VIN0'),true);
  assert.equal(Backup.canAdd(list.slice(0,99),'ANOTHER'),true);
});
test('backup JSON round-trips every restored field including EPA association',()=>{
  const text=Backup.serialize([record]);
  const restored=Backup.parse(text);
  assert.equal(restored[0].epaId,123);
  assert.equal(restored[0].epaModel,'Accord');
  assert.equal(restored[0].flat.Make,'Honda');
  assert.deepEqual(restored[0].groups,record.groups);
});
test('backup parser rejects unknown format, duplicates, excess and malformed records',()=>{
  assert.throws(()=>Backup.parse('{}'),/supported VINBOX/);
  const valid=JSON.parse(Backup.serialize([record]));
  valid.vehicles.push(record);
  assert.throws(()=>Backup.parse(JSON.stringify(valid)),/duplicate VINs/);
  valid.vehicles=Array.from({length:101},()=>record);
  assert.throws(()=>Backup.parse(JSON.stringify(valid)),/100-vehicle/);
  valid.vehicles=[{vin:VIN,title:'Bad',flat:{},groups:[{name:'X',rows:[[{},'value']]}],facts:[]}];
  assert.throws(()=>Backup.parse(JSON.stringify(valid)),/invalid vehicle fields/);
});
test('clear all and undo restore exactly the saved record set',()=>{
  const x=widget(),original=structuredClone(x.state.history);
  x.extras.clearSaved();
  assert.equal(x.state.history.length,0);
  x.extras.undoSaved();
  assert.deepEqual(x.state.history,original);
  assert.equal(x.writes,2);
});
test('failed deletion never discards the saved list',()=>{
  const x=widget();x.fail();x.extras.clearSaved();
  assert.equal(x.state.history.length,1);
});
test('file restore requires explicit confirmation and preserves current list until confirmed',async()=>{
  const x=widget();
  const newer={...record,vin:'1HGCM82633A004353',title:'Another vehicle'};
  await x.extras.importFile({size:800,text:async()=>Backup.serialize([newer])});
  assert.equal(x.state.history[0].vin,VIN);
  const holder=x.extras.savedNotice();
  function find(n){
    if(!n)return null;
    if(n.tag==='button'&&n.children.includes('Restore saved vehicles'))return n;
    for(const c of n.children||[]){const v=find(c);if(v)return v;}
    return null;
  }
  const btn=find(holder);assert.ok(btn,'restore confirmation button exists');
  btn.attrs.onclick();
  assert.equal(x.state.history[0].vin,newer.vin);
  x.extras.undoSaved();
  assert.equal(x.state.history[0].vin,VIN);
});
test('rejected restore leaves saved records unchanged',async()=>{
  const x=widget();
  await x.extras.importFile({size:8,text:async()=>'{bad'});
  assert.equal(x.state.history[0].vin,VIN);
  assert.equal(x.writes,0);
});
test('EPA make/year/model all must match before presenting an estimate',()=>{
  const civic={flat:{ModelYear:'2022',Make:'Honda',Model:'Civic'}};
  const good={id:1,year:2022,make:'Honda',model:'Civic'};
  assert.equal(EPA.sameVehicle(civic,good),true);
  assert.equal(EPA.sameVehicle(civic,{...good,model:'Accord'}),false);
  assert.equal(EPA.sameVehicle(civic,{...good,year:2023}),false);
  assert.equal(EPA.sameVehicle(civic,{...good,make:'Toyota'}),false);
});
test('known VIN powertrain conflicts require confirmation',()=>{
  const car={flat:{ModelYear:'2022',Make:'Honda',Model:'Civic',DisplacementL:'2.0',
    EngineCylinders:'4',DriveType:'Front-Wheel Drive'}};
  assert.equal(EPA.conflictsWithVin(car,{displ:1.5,cylinders:4,drive:'Front-Wheel Drive'}),true);
  assert.equal(EPA.conflictsWithVin(car,{displ:2,cylinders:4,drive:'All-Wheel Drive'}),true);
  assert.equal(EPA.conflictsWithVin(car,{displ:2,cylinders:4,drive:'Front-Wheel Drive'}),false);
});
test('EPA XML-shaped record fields use correct energy equivalent units',()=>{
  assert.equal(EPA.metrics({id:1,atvType:'EV',comb08:120,combE:28}).unit,'MPGe');
  assert.equal(EPA.metrics({id:2,atvType:'CNG',comb08:35}).unit,'MPGe');
  assert.equal(EPA.metrics({id:3,atvType:'LPG',comb08:32}).unit,'MPGe');
  assert.equal(EPA.metrics({id:13,atvType:'Bifuel (CNG)',fuelType1:'Regular Gasoline',comb08:24}).unit,'MPG');
  assert.equal(EPA.metrics({id:4,atvType:'Plug-in Hybrid',phevComb:92}).phevCombined,92);
  assert.equal(EPA.metrics({id:5,atvType:'Hybrid',comb08:48}).unit,'MPG');
});
test('source code lazy-renders details and offers Undo on Results too',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  assert.ok(src.includes("out.append(extras.savedNotice())"));
  assert.ok(src.includes("open ? [el('div',{class:'card-tools'}"));
  assert.ok(src.includes("restoreFocus()"));
  assert.ok(src.includes("VinboxBackup.canAdd(state.history,it.vin)"));
});
test('service worker and HTML load backups safely before the UI',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.ok(html.indexOf('src="backup.js"')<html.indexOf('src="extras.js"'));
  assert.ok(html.includes('id="saved-import"'));
  assert.match(sw,/vinbox-v27/);
  assert.ok(sw.includes("'backup.js'"));
});
test('Vercel scanner CSP is restricted to one pinned asset path',()=>{
  const v=JSON.parse(fs.readFileSync(path.join(__dirname,'..','vercel.json'),'utf8'));
  const csp=v.headers[0].headers.find(x=>x.key==='Content-Security-Policy').value;
  assert.ok(csp.includes('https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'));
  assert.ok(!csp.includes("script-src 'self' https://unpkg.com;"));
});
