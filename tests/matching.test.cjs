'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Match=require('../epa-match.js');
const EPA=require('../epa.js');

const makeItem=(model,year,fields={})=>({
  vin:'1HGCM82633A004352',decoded:true,hasError:false,
  flat:{ModelYear:String(year),Make:'Honda',Model:model,...fields}
});
const menu=items=>({menuItem:items.map(text=>({text,value:text}))});
function network({models,options,vehicles,fail=[]}){
  const urls=[];
  const fetchImpl=async url=>{
    urls.push(url);
    let payload,code=200;
    if(url.includes('/menu/make'))payload=menu(['Honda']);
    else if(url.includes('/menu/model'))payload=menu(models);
    else if(url.includes('/menu/options')){
      const model=new URL(url,'https://app.invalid').searchParams.get('model');
      payload={menuItem:(options[model]||[]).map(x=>({text:x.text,value:String(x.id)}))};
    }else{
      const id=Number(url.match(/\/(\d+)$/)?.[1]);
      if(fail.includes(id))code=404;
      payload=vehicles[id]||{};
    }
    return {ok:code===200,status:code,headers:{get:()=>null},text:async()=>JSON.stringify(payload)};
  };
  return {fetchImpl,urls};
}
test('VIN decoded Touring trim selects EPA Insight Touring without user input',async()=>{
  const it=makeItem('Insight',2022,{Trim:'Touring',BodyClass:'Sedan/Saloon',
    DisplacementL:'1.5',EngineCylinders:'4',TransmissionStyle:'Automatic',
    DriveType:'Front-Wheel Drive',ElectrificationLevel:'HEV (Hybrid Electric Vehicle)'});
  const net=network({
    models:['Insight','Insight Touring','Civic 4Dr','Civic 5Dr','Civic Si'],
    options:{'Insight Touring':[{id:43947,text:'Auto (variable gear ratios), 4 cyl, 1.5 L'}]},
    vehicles:{43947:{id:43947,year:2022,make:'Honda',model:'Insight Touring',displ:1.5,
      cylinders:4,trany:'Automatic (variable gear ratios)',drive:'Front-Wheel Drive',atvType:'Hybrid',comb08:48}}
  });
  const result=await EPA.resolve(it,net.fetchImpl);
  assert.equal(result.status,'auto');
  assert.equal(result.id,43947);
  assert.equal(result.model,'Insight Touring');
  assert.ok(net.urls.every(url=>!url.includes(it.vin)));
  assert.ok(!net.urls.some(url=>url.includes('model=Insight&')));
});
test('2022 Civic: same engine and two EPA automatic ratings remains ambiguous',async()=>{
  const it=makeItem('Civic',2022,{Trim:'LX',BodyClass:'Sedan/Saloon',
    DisplacementL:'2.0',EngineCylinders:'4',DriveType:'Front-Wheel Drive',
    TransmissionStyle:'Automatic'});
  const net=network({models:['Insight','Insight Touring','Civic 4Dr','Civic 5Dr','Civic Si'],
    options:{'Civic 4Dr':[
      {id:44134,text:'Auto (AV-S7), 4 cyl, 2.0 L'},
      {id:44133,text:'Auto (variable gear ratios), 4 cyl, 2.0 L'},
      {id:44132,text:'Auto (AV-S7), 4 cyl, 1.5 L, Turbo'}]},
    vehicles:{
      44134:{id:44134,year:2022,make:'Honda',model:'Civic 4Dr',displ:2,
        cylinders:4,trany:'Automatic (AV-S7)',drive:'Front-Wheel Drive'},
      44133:{id:44133,year:2022,make:'Honda',model:'Civic 4Dr',displ:2,
        cylinders:4,trany:'Automatic (variable gear ratios)',drive:'Front-Wheel Drive'}
    }});
  const r=await EPA.resolve(it,net.fetchImpl);
  assert.equal(r.status,'choose-option');
  assert.deepEqual(r.options.map(o=>o.value),['44134','44133']);
  assert.ok(!net.urls.some(url=>url.includes('Civic%205Dr')));
  assert.ok(!net.urls.some(url=>url.endsWith('/44132')));
});
test('Hatchback VIN excludes EPA sedan and automatically selects unique hatch trim',async()=>{
  const it=makeItem('Civic',2023,{BodyClass:'Hatchback/Liftback/Notchback',Trim:'EX-L',
    DisplacementL:'1.5',EngineCylinders:'4',TransmissionStyle:'Automatic'});
  const net=network({models:['Civic 4Dr','Civic 5Dr'],
    options:{'Civic 5Dr':[{id:88001,text:'Auto CVT, 4 cyl, 1.5 L'}]},
    vehicles:{88001:{id:88001,year:2023,make:'Honda',model:'Civic 5Dr',displ:1.5,
      cylinders:4,trany:'Automatic (variable gear ratios)',drive:'Front-Wheel Drive'}}});
  const r=await EPA.resolve(it,net.fetchImpl);
  assert.equal(r.status,'auto');
  assert.equal(r.model,'Civic 5Dr');
});
test('No VIN transmission confidence means two similarly equipped variants are NOT auto matched',()=>{
  const it=makeItem('Civic',2022,{BodyClass:'Sedan/Saloon',DisplacementL:'2.0',EngineCylinders:'4'});
  const a={model:'Civic 4Dr',record:{id:44133,year:2022,make:'Honda',model:'Civic 4Dr',displ:2,cylinders:4,trany:'Automatic (variable gear ratios)'}};
  const b={model:'Civic 4Dr',record:{id:44134,year:2022,make:'Honda',model:'Civic 4Dr',displ:2,cylinders:4,trany:'Automatic (AV-S7)'}};
  assert.equal(Match.uniqueMatch(it,[a,b]).status,'ambiguous');
});
test('Manual and automatic EPA options are distinguished using the VIN',async()=>{
  const it=makeItem('Accord',2024,{TransmissionStyle:'Manual',DisplacementL:'2.0',EngineCylinders:'4'});
  const n=network({models:['Accord'],options:{Accord:[
    {id:99001,text:'Man 6-spd, 4 cyl, 2.0 L'},
    {id:99002,text:'Auto 8-spd, 4 cyl, 2.0 L'}]},
    vehicles:{99001:{id:99001,year:2024,make:'Honda',model:'Accord',displ:2,cylinders:4,trany:'Manual 6-spd'}}});
  const r=await EPA.resolve(it,n.fetchImpl);
  assert.equal(r.status,'auto');
  assert.equal(r.id,99001);
  assert.ok(!n.urls.some(u=>u.endsWith('/99002')));
});
test('Partially decoded VIN never receives an automatic EPA ID',async()=>{
  const it=makeItem('Insight',2025,{DisplacementL:'1.5'});
  it.hasError=true;
  const n=network({models:['Insight'],options:{Insight:[{id:99101,text:'Auto, 1.5 L'}]},vehicles:{}});
  const r=await EPA.resolve(it,n.fetchImpl);
  assert.equal(r.status,'choose-option');
  assert.ok(!n.urls.some(u=>u.endsWith('/99101')));
});
test('If any plausible EPA detail request fails, uniqueness cannot be asserted',async()=>{
  const it=makeItem('Insight',2026,{DisplacementL:'1.5',EngineCylinders:'4'});
  const n=network({models:['Insight'],options:{Insight:[
    {id:99201,text:'Auto, 4 cyl, 1.5 L'},{id:99202,text:'Auto, 4 cyl, 1.5 L'}]},
    vehicles:{99201:{id:99201,year:2026,make:'Honda',model:'Insight',displ:1.5,cylinders:4,trany:'Automatic'}},
    fail:[99202]});
  const r=await EPA.resolve(it,n.fetchImpl);
  assert.equal(r.status,'choose-option');
  assert.equal(r.options.length,2);
});
test('Huge option lists never fan out into excessive record requests',async()=>{
  const it=makeItem('Accord',2027,{});
  const entries=Array.from({length:18},(_,i)=>({id:99300+i,text:'Auto '+i}));
  const n=network({models:['Accord'],options:{Accord:entries},vehicles:{}});
  const r=await EPA.resolve(it,n.fetchImpl);
  assert.equal(r.status,'choose-option');
  assert.equal(n.urls.filter(u=>/\/vehicle\/[0-9]+$/.test(u)).length,0);
});
test('Diesel VIN must not auto-match a gasoline EPA record',()=>{
  const it=makeItem('Accord',2022,{FuelTypePrimary:'Diesel',DisplacementL:'2.0'});
  const r=Match.uniqueMatch(it,[{model:'Accord',record:{id:1,model:'Accord',displ:2,fuelType1:'Regular Gasoline'}}]);
  assert.equal(r.status,'unavailable');
});
test('Unknown body and transmission details do not create invented certainty',()=>{
  const it=makeItem('Civic',2022,{DisplacementL:'2.0'});
  assert.equal(Match.candidates(it,['Civic 4Dr','Civic 5Dr'].map(value=>({value,text:value}))).length,2);
});

test('UI shows an automatic VIN-to-EPA estimate without requiring dropdowns and persists EPA ID',async()=>{
  const create=require('../extras.js');
  const record=makeItem('Insight',2022,{Trim:'Touring',DisplacementL:'1.5',EngineCylinders:'4'});
  const state={history:[record],makeOff:new Set()};
  const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...nodes){this.children.push(...nodes)}});
  let saved=0;
  const ui=create({state,el,icon:()=>({}),render:()=>{},save:()=>{saved++;return true;},
    SectionHead:()=>({}),download:()=>{},toCsv:()=>''});
  const originalResolve=EPA.resolve,originalVehicle=EPA.vehicle;
  EPA.resolve=async()=>({status:'auto',id:77701,model:'Insight Touring'});
  EPA.vehicle=async()=>({id:77701,year:2022,make:'Honda',model:'Insight Touring',
    displ:1.5,cylinders:4,trany:'Automatic',comb08:49});
  function walk(n,out=[]){if(!n||typeof n!=='object')return out;out.push(n);for(const child of n.children||[])walk(child,out);return out;}
  try{
    ui.EpaPanel(record);
    for(let i=0;i<20;i++)await Promise.resolve();
    const panel=ui.EpaPanel(record),nodes=walk(panel);
    assert.equal(record.epaId,77701);
    assert.equal(record.epaModel,'Insight Touring');
    assert.equal(saved,1);
    assert.equal(nodes.some(n=>n.tag==='select'),false);
    assert.ok(nodes.some(n=>String(n.attrs?.text||'').includes('Matched automatically')));
  }finally{EPA.resolve=originalResolve;EPA.vehicle=originalVehicle;}
});
test('UI offers a configuration selector only when VIN matching is ambiguous',async()=>{
  const create=require('../extras.js');
  const record=makeItem('Civic',2022,{Trim:'LX',BodyClass:'Sedan/Saloon',DisplacementL:'2.0'});
  const state={history:[],makeOff:new Set()};
  const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...nodes){this.children.push(...nodes)}});
  const ui=create({state,el,icon:()=>({}),render:()=>{},save:()=>true,
    SectionHead:()=>({}),download:()=>{},toCsv:()=>''});
  const originalResolve=EPA.resolve;
  EPA.resolve=async()=>({status:'choose-option',model:'Civic 4Dr',
    options:[{text:'Automatic CVT',value:'44133'},{text:'Automatic (AV-S7)',value:'44134'}]});
  const walk=(n,out=[])=>{if(!n||typeof n!=='object')return out;out.push(n);for(const x of n.children||[])walk(x,out);return out;};
  try{
    ui.EpaPanel(record);
    for(let i=0;i<12;i++)await Promise.resolve();
    const nodes=walk(ui.EpaPanel(record));
    assert.equal(nodes.some(n=>n.tag==='select'),true);
    assert.equal(record.epaId,undefined);
  }finally{EPA.resolve=originalResolve;}
});

test('VIN-to-EPA model aliases handle F-150 vs F150 and refuse 2WD records for 4WD VINs',()=>{
  const it={decoded:true,flat:{Model:'F-150',Trim:'XL',DriveType:'4-Wheel Drive'}};
  const result=Match.candidates(it,['F150 2WD','F150 4WD','Fiesta'].map(value=>({value,text:value})));
  assert.deepEqual(result.map(x=>x.value),['F150 4WD']);
});
test('EPA evaluation requires the exact decoded year and make',()=>{
  const it=makeItem('Civic',2022,{BodyClass:'Sedan/Saloon',DisplacementL:'2.0'});
  const record={id:88811,year:2022,make:'Honda',model:'Civic 4Dr',displ:2};
  assert.equal(Match.assessment(it,record,'Civic 4Dr').compatible,true);
  assert.equal(Match.assessment(it,{...record,year:2021},'Civic 4Dr').compatible,false);
  assert.equal(Match.assessment(it,{...record,make:'Toyota'},'Civic 4Dr').compatible,false);
});
test('new match adapter loads before EPA, preserving progressive web app cache',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const backup=fs.readFileSync(path.join(root,'backup.js'),'utf8');
  assert.ok(html.indexOf('src="epa-match.js"')<html.indexOf('src="epa.js"'));
  assert.ok(html.indexOf('src="epa.js"')<html.indexOf('src="extras.js"'));
  assert.ok(sw.includes('vinbox-v22')&&sw.includes("'epa-match.js'"));
  assert.ok(app.includes('TransmissionSpeeds:it.flat.TransmissionSpeeds'));
  assert.ok(app.includes('ElectrificationLevel:it.flat.ElectrificationLevel'));
  assert.ok(backup.includes("'ElectrificationLevel'"));
});
