'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Node executes test files in isolation; mirror the browser module order.
require('../epa-match.js');
const EPA=require('../epa.js');
const Core=require('../app.js');
const Extras=require('../extras.js');

const makeIt=()=>({decoded:true,hasError:false,vin:'WDC0G4KB8GF018636',
 flat:{ModelYear:'2016',Make:'Mercedes-Benz',Model:'GLC-Class',Trim:'GLC300 Base-4M',
 BodyClass:'Sport Utility Vehicle',DisplacementL:'2.0',EngineCylinders:'4',
 DriveType:'AWD/All-Wheel Drive',FuelTypePrimary:'Gasoline',TransmissionStyle:'Automatic'}});
const json=x=>({ok:true,status:200,text:async()=>JSON.stringify(x)});
test('Mercedes EPA lookup uses three endpoints instead of four on first scan',async()=>{
 const urls=[];
 const fetchImpl=async url=>{
   urls.push(url);
   if(url.includes('/menu/model'))return json({menuItem:[{text:'GLC300',value:'GLC300'},{text:'GLC300 4matic',value:'GLC300 4matic'}]});
   if(url.includes('/menu/options'))return json({menuItem:[{text:'Auto 9-spd, 4 cyl, 2.0 L, Turbo',value:'37160'}]});
   if(url.endsWith('/37160'))return json({id:37160,year:2016,make:'Mercedes-Benz',
    model:'GLC300 4matic',displ:2,cylinders:4,drive:'4-Wheel Drive',trany:'Automatic 9-spd',tCharger:'T',fuelType1:'Premium Gasoline',comb08:24,city08:21,highway08:28});
   throw Error('Unexpected endpoint '+url);
 };
 const r=await EPA.resolve(makeIt(),fetchImpl);
 assert.equal(r.status,'auto');
 assert.equal(r.id,37160);
 assert.equal(urls.length,3);
 assert.equal(urls.filter(u=>u.includes('/menu/make')).length,0);
});
test('EPA discovery uses models directly without redundant make request',async()=>{
 const urls=[],fetchImpl=async url=>{
  urls.push(url);
  if(url.includes('/menu/model'))return json({menuItem:[{text:'Civic',value:'Civic'}]});
  if(url.includes('/menu/options'))return json({menuItem:[{text:'Auto CVT',value:'777'}]});
  throw Error('Unexpected '+url);
 };
 const r=await EPA.discover({flat:{ModelYear:2024,Make:'Honda',Model:'Civic'}},fetchImpl);
 assert.equal(r.status,'choose-option');
 assert.equal(urls.length,2);
});
test('EPA make aliases fall back to manufacturer list only after an empty direct lookup',async()=>{
 const urls=[],fetchImpl=async url=>{
  urls.push(url);
  if(url.includes('/menu/model')&&(url.includes('make=Volkswagen+AG')||url.includes('make=Volkswagen%20AG')))return json({menuItems:{menuItem:[]}});
  if(url.includes('/menu/make'))return json({menuItem:[{text:'Volkswagen AG',value:'Volkswagen'}]});
  if(url.includes('/menu/model')&&url.includes('make=Volkswagen'))return json({menuItem:[{text:'Golf',value:'Golf'}]});
  throw Error('Unexpected '+url);
 };
 const r=await EPA.modelMenu(2024,'Volkswagen AG',fetchImpl);
 assert.equal(r.make,'Volkswagen');
 assert.deepEqual(r.models.map(x=>x.value),['Golf']);
 assert.equal(urls.length,3);
});
test('EPA model request server failure is not disguised as an alias miss',async()=>{
 let requests=0;
 const fetchImpl=async()=>{requests++;return {ok:false,status:400,text:async()=>''};};
 await assert.rejects(EPA.modelMenu(2011,'Acura',fetchImpl),/EPA service returned 400/);
 assert.equal(requests,1);
});
test('session cache reuses public EPA menu after page module reload',async()=>{
 const data=new Map();
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 let calls=0;
 const fetchImpl=async url=>{calls++;if(!url.includes('/menu/model'))throw Error('unexpected network request');return json({menuItem:[{text:'Civic',value:'Civic'}]});};
 const code=fs.readFileSync(path.join(__dirname,'..','epa.js'),'utf8');
 const load=()=>{
   const context={module:{exports:{}},fetch:fetchImpl,sessionStorage:storage,
     AbortController,URLSearchParams,setTimeout,clearTimeout,Date,Promise};
   vm.runInNewContext(code,context);
   return context.module.exports;
 };
 const first=load();
 assert.equal((await first.modelMenu(2024,'Honda',fetchImpl)).models[0].value,'Civic');
 assert.equal(calls,1);
 const next=load();
 assert.equal((await next.modelMenu(2024,'Honda',fetchImpl)).models[0].value,'Civic');
 assert.equal(calls,1);
 assert.ok([...data.keys()].every(key=>!key.includes('1HG')&&!key.includes('WDC')));
});
test('session storage denial never prevents API lookup',async()=>{
 let calls=0;
 const source=fs.readFileSync(path.join(__dirname,'..','epa.js'),'utf8');
 const remote=async()=>{calls++;return json({menuItem:[{text:'Accord',value:'Accord'}]});};
 const storage={getItem(){throw Error('Access blocked')},setItem(){throw Error('Quota')},removeItem(){throw Error('Blocked')}};
 const context={module:{exports:{}},fetch:remote,sessionStorage:storage,AbortController,URLSearchParams,setTimeout,clearTimeout,Date,Promise};
 vm.runInNewContext(source,context);
 const r=await context.module.exports.modelMenu(2025,'Honda',remote);
 assert.equal(r.models[0].value,'Accord');
 assert.equal(calls,1);
});
test('VIN batch concurrency capped at two with stable input order',async()=>{
 const vins=Array.from({length:125},(_,i)=>'1HGCM82633A'+String(i).padStart(6,'0'));
 const pending=[];let active=0,max=0;
 const fetchImpl=async(url,init)=>{
  active++;max=Math.max(max,active);
  return await new Promise(resolve=>pending.push({resolve,init,done:()=>{active--;const v=decodeURIComponent(init.body.split('&data=')[1]).split(';').map(x=>({VIN:x,Make:'Honda',Model:'Civic',ModelYear:'2003'}));resolve({ok:true,status:200,json:async()=>({Results:v})});}}));
 };
 const p=Core.decodeVins(vins,fetchImpl,async()=>{});
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(pending.length,2);
 pending[1].done();
 for(let i=0;i<80;i++)await Promise.resolve();
 assert.equal(pending.length,3);
 pending[2].done();
 pending[0].done();
 const out=await p;
 assert.equal(out.length,125);
 assert.deepEqual(out.map(x=>x.vin),vins);
 assert.equal(max,2);
});
test('EPA async completion sends targeted UI refresh rather than whole-page render',async()=>{
 const source={vin:'1HGCM82633A004352',decoded:true,hasError:false,
 flat:{ModelYear:'2022',Make:'Honda',Model:'Civic',DisplacementL:'2.0',EngineCylinders:'4'}};
 const state={history:[],makeOff:new Set()},calls={render:0,panel:0};
 const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...kids){this.children.push(...kids)}});
 const original={resolve:EPA.resolve,vehicle:EPA.vehicle};
 EPA.resolve=async()=>({status:'auto',id:778,model:'Civic 4Dr'});
 EPA.vehicle=async()=>({id:778,year:2022,make:'Honda',model:'Civic 4Dr',displ:2,cylinders:4,comb08:35,city08:30,highway08:40,fuelType1:'Regular Gasoline'});
 const ui=Extras({state,el,icon(){return {}},render(){calls.render++},renderPanel(){calls.panel++},
  save(){return true},SectionHead(){return {}},download(){},toCsv(){return ''}});
 try{
  ui.EpaPanel(source);
  for(let i=0;i<35;i++)await Promise.resolve();
  assert.equal(source.epaId,778);
  assert.ok(calls.panel>=1);
  assert.equal(calls.render,0);
 }finally{Object.assign(EPA,original)}
});
test('targeted repaint code exists and does not replace full result list',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 assert.ok(app.includes('function renderEpa(it)'));
 assert.ok(app.includes('previous.replaceWith(extras.EpaPanel(visible))'));
 assert.ok(app.includes('renderPanel:renderEpa'));
 assert.ok(app.includes("(state.tab==='results'?state.results:state.history).find(x=>x.vin===it.vin)"));
});
