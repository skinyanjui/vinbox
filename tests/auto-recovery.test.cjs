'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Match=require('../epa-match.js');
const EPA=require('../epa.js');
const Extras=require('../extras.js');

function vehicle(vin='1HGCM82633A004352'){
  return {vin,decoded:true,hasError:false,title:'2022 Honda Civic',make:'Honda',year:'2022',
    flat:{ModelYear:'2022',Make:'Honda',Model:'Civic',BodyClass:'Sedan/Saloon',
      FuelTypePrimary:'Gasoline',DisplacementL:'2.0',EngineCylinders:'4',
      TransmissionStyle:'Automatic',DriveType:'Front-Wheel Drive'},facts:[],groups:[]};
}
function record(id,model='Civic 4Dr',overrides={}){
  return {id,year:2022,make:'Honda',model,displ:2,cylinders:4,
    trany:'Automatic (variable gear ratios)',drive:'Front-Wheel Drive',
    fuelType1:'Regular Gasoline',comb08:35,city08:31,highway08:40,fuelCost08:1700,...overrides};
}
const el=(tag,attrs={},...children)=>({tag,attrs,children,append(...nodes){this.children.push(...nodes)}});
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):
  node&&typeof node==='object'?[node,...(node.children||[]).flatMap(nodes)]:[];
async function flush(){for(let i=0;i<70;i++)await Promise.resolve();}
function harness(it,stored=it){
  const state={history:stored?[stored]:[],makeOff:new Set()},saved=[];
  const ui=Extras({state,el,icon:()=>({}),render:()=>{},save:()=>{saved.push(state.history.map(x=>({epaId:x.epaId,epaModel:x.epaModel})));return true;},
    SectionHead:()=>({}),download:()=>{},toCsv:()=>'',toast:()=>{}});
  return {ui,state,saved};
}
const rendered=(ui,it)=>nodes(ui.EpaPanel(it));
const hasMetrics=list=>list.some(n=>n.attrs?.class==='epa-metrics');
const hasSelect=list=>list.some(n=>n.tag==='select');
test('wrong saved EPA ID is replaced automatically with compatible VIN match',async()=>{
  const it=vehicle();it.epaId=901;it.epaModel='Accord';
  const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};let recovered=0;
  EPA.vehicle=async id=>id===901?record(901,'Accord'):record(902);
  EPA.resolve=async()=>{recovered++;return {status:'auto',id:902,model:'Civic 4Dr'};};
  try{
    h.ui.EpaPanel(it);await flush();
    const all=rendered(h.ui,it);
    assert.equal(recovered,1);
    assert.equal(it.epaId,902);
    assert.equal(it.epaModel,'Civic 4Dr');
    assert.equal(h.state.history[0].epaId,902);
    assert.ok(hasMetrics(all));assert.equal(hasSelect(all),false);
    assert.ok(!all.some(n=>String(n.attrs?.text||'').includes('does not correspond')));
    assert.ok(h.saved.some(snapshot=>snapshot[0].epaId===undefined));
  }finally{Object.assign(EPA,old);}
});
test('correct EPA ID with obsolete saved model text uses official EPA model without dropdown',async()=>{
  const it=vehicle();it.epaId=902;it.epaModel='Accord';
  const h=harness(it);const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.vehicle=async()=>record(902,'Civic 4Dr');
  EPA.resolve=async()=>{throw Error('Valid saved ID should not require menu lookup');};
  try{
    h.ui.EpaPanel(it);await flush();
    assert.equal(it.epaModel,'Civic 4Dr');
    assert.equal(it.epaId,902);
    assert.ok(hasMetrics(rendered(h.ui,it)));
    assert.equal(hasSelect(rendered(h.ui,it)),false);
  }finally{Object.assign(EPA,old);}
});
test('invalid saved EPA engine triggers automatic verified range, no incorrect stored ID',async()=>{
  const it=vehicle();it.epaId=903;it.epaModel='Civic 4Dr';
  const h=harness(it);const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.vehicle=async()=>record(903,'Civic 4Dr',{displ:1.5});
  EPA.resolve=async()=>({status:'estimate',reason:'range',data:{
    unit:'MPG',variants:2,combined:{min:33,max:35},city:{min:30,max:31},
    highway:{min:37,max:40},yearlyCost:{min:1700,max:1800},kwhPer100:null,
    electricRange:null,phevCombined:null}});
  try{
    h.ui.EpaPanel(it);await flush();
    const all=rendered(h.ui,it);
    assert.ok(hasMetrics(all));
    assert.equal(hasSelect(all),false);
    assert.equal(it.epaId,undefined);
    assert.equal(h.state.history[0].epaId,undefined);
    assert.ok(all.some(n=>n.attrs?.text==='33–35'));
  }finally{Object.assign(EPA,old);}
});
test('retired EPA ID (404) transparently resolves from VIN',async()=>{
  const it=vehicle();it.epaId=904;const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.vehicle=async id=>{if(id===904)throw Error('EPA record not found');return record(905)};
  EPA.resolve=async()=>({status:'auto',id:905,model:'Civic 4Dr'});
  try{
    h.ui.EpaPanel(it);await flush();
    assert.equal(it.epaId,905);
    assert.ok(hasMetrics(rendered(h.ui,it)));
  }finally{Object.assign(EPA,old);}
});
test('temporary EPA API failure preserves saved ID and offers retry',async()=>{
  const it=vehicle();it.epaId=906;const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};let lookup=0;
  EPA.vehicle=async()=>{throw Error('EPA service returned 503');};
  EPA.resolve=async()=>{lookup++;return {status:'unavailable'};};
  try{
    h.ui.EpaPanel(it);await flush();
    const all=rendered(h.ui,it);
    assert.equal(it.epaId,906);
    assert.equal(lookup,0);
    assert.ok(!hasMetrics(all));
    assert.ok(all.some(n=>String(n.attrs?.text||'').includes('503')));
  }finally{Object.assign(EPA,old);}
});
test('truly ambiguous VIN still offers manual configuration after invalid saved ID',async()=>{
  const it=vehicle();it.epaId=907;const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.vehicle=async()=>record(907,'Accord');
  EPA.resolve=async()=>({status:'choose-option',model:'Civic 4Dr',
    options:[{text:'Automatic (AV-S7) 2.0L',value:'44134'},
      {text:'Automatic CVT 2.0L',value:'44133'}]});
  try{
    h.ui.EpaPanel(it);await flush();
    assert.equal(hasSelect(rendered(h.ui,it)),true);
    assert.equal(it.epaId,undefined);
  }finally{Object.assign(EPA,old);}
});
test('automatically selected EPA ID still must match decoded VIN',async()=>{
  const it=vehicle();it.epaId=908;const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.vehicle=async id=>record(id,'Accord');
  EPA.resolve=async()=>({status:'auto',id:909,model:'Accord'});
  try{
    h.ui.EpaPanel(it);await flush();
    const all=rendered(h.ui,it);
    assert.equal(hasMetrics(all),false);
    assert.ok(all.some(n=>String(n.attrs?.text||'').includes('No verified EPA configuration')));
    assert.equal(it.epaId,undefined);
  }finally{Object.assign(EPA,old);}
});
test('no previous EPA ID flows through automatic resolver immediately',async()=>{
  const it=vehicle(),h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};let calls=0;
  EPA.resolve=async()=>{calls++;return {status:'auto',id:910,model:'Civic 4Dr'};};
  EPA.vehicle=async()=>record(910);
  try{
    h.ui.EpaPanel(it);await flush();
    assert.equal(calls,1);
    assert.ok(hasMetrics(rendered(h.ui,it)));
    assert.equal(it.epaId,910);
  }finally{Object.assign(EPA,old);}
});

test('wrong manual EPA choice retries VIN resolution and selects correct version without another prompt',async()=>{
  const it=vehicle();const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};let calls=0;
  EPA.resolve=async()=>{calls++;return calls===1?
    {status:'choose-option',model:'Civic 4Dr',options:[{text:'Accord',value:'990'},
      {text:'Civic 4Dr',value:'991'}]}:
    {status:'auto',id:991,model:'Civic 4Dr'};};
  EPA.vehicle=async id=>Number(id)===990?record(990,'Accord'):record(991);
  try{
    h.ui.EpaPanel(it);await flush();
    const select=rendered(h.ui,it).find(n=>n.tag==='select');
    assert.ok(select);
    select.attrs.onchange({target:{value:'990'}});
    await flush();
    assert.equal(it.epaId,991);
    assert.equal(calls,2);
    const all=rendered(h.ui,it);
    assert.ok(hasMetrics(all));assert.equal(hasSelect(all),false);
  }finally{Object.assign(EPA,old);}
});
test('wrong manual choice with unresolved VIN remains selectable without assigning incorrect MPG',async()=>{
  const it=vehicle();const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.resolve=async()=>({status:'choose-option',model:'Civic 4Dr',
    options:[{text:'Unverified variant',value:'992'},{text:'Second variant',value:'993'}]});
  EPA.vehicle=async id=>record(Number(id),'Accord');
  try{
    h.ui.EpaPanel(it);await flush();
    const select=rendered(h.ui,it).find(n=>n.tag==='select');
    select.attrs.onchange({target:{value:'992'}});
    await flush();
    assert.equal(it.epaId,undefined);
    assert.equal(hasMetrics(rendered(h.ui,it)),false);
    assert.equal(hasSelect(rendered(h.ui,it)),true);
  }finally{Object.assign(EPA,old);}
});
test('invalid saved EPA association does not erase other fields in saved vehicle',async()=>{
  const it=vehicle();it.epaId=994;it.epaModel='Accord';it.groups=[{name:'Engine',rows:[['Cylinders','4']]}];
  const h=harness(it);const old={vehicle:EPA.vehicle,resolve:EPA.resolve};
  EPA.vehicle=async()=>record(994,'Accord');
  EPA.resolve=async()=>({status:'unavailable',message:'No matching EPA version this year'});
  try{
    h.ui.EpaPanel(it);await flush();
    assert.equal(it.epaId,undefined);
    assert.equal(it.flat.Model,'Civic');
    assert.deepEqual(it.groups,[{name:'Engine',rows:[['Cylinders','4']]}]);
    assert.equal(h.state.history.length,1);
  }finally{Object.assign(EPA,old);}
});

test('error retry automatically resolves VIN rather than forcing a model dropdown',async()=>{
  const it=vehicle();it.epaId=995;const h=harness(it);
  const old={vehicle:EPA.vehicle,resolve:EPA.resolve};let resolutions=0;
  EPA.vehicle=async id=>{if(Number(id)===995)throw Error('EPA service returned 503');return record(996);};
  EPA.resolve=async()=>{resolutions++;return {status:'auto',id:996,model:'Civic 4Dr'};};
  try{
    h.ui.EpaPanel(it);await flush();
    const retry=rendered(h.ui,it).find(n=>n.tag==='button'&&n.children.includes('Retry VIN match'));
    assert.ok(retry);
    retry.attrs.onclick();
    await flush();
    assert.equal(resolutions,1);
    assert.equal(it.epaId,996);
    assert.ok(hasMetrics(rendered(h.ui,it)));
    assert.equal(hasSelect(rendered(h.ui,it)),false);
  }finally{Object.assign(EPA,old);}
});
