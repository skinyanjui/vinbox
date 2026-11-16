'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const EPA=require('../epa.js');
const extrasFactory=require('../extras.js');
const honda={flat:{ModelYear:'2022',Make:'HONDA',Model:'Civic'}};
const json=(payload,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload)});
const menu=(values)=>({menuItems:{menuItem:values.map(x=>({value:String(x),text:String(x)}))}});
const unique=(url)=>{
  if(url.includes('/menu/make'))return json(menu(['Honda','Toyota']));
  if(url.includes('/menu/model'))return json(menu(['Civic','Accord']));
  if(url.includes('/menu/options'))return json({menuItem:[{text:'2.0L, Automatic',value:'12345'},{text:'1.5L Turbo, CVT',value:'12346'}]});
  return json({id:12345,year:2022,make:'Honda',model:'Civic',comb08:34,city08:30,highway08:40,fuelCost08:1650,atvtype:'Hybrid'});
};
test('EPA menu normalization accepts singleton and array formats',()=>{
  assert.deepEqual(EPA.menuItems({menuItem:{text:'Fit',value:'Fit'}}),[{text:'Fit',value:'Fit'}]);
  assert.equal(EPA.menuItems(menu(['Civic','Accord'])).length,2);
  assert.equal(EPA.match('F-150',[{text:'F150',value:'F150'}]).length,1);
});
test('EPA matching uses year/make/model then requires selection for multiple trims',async()=>{
  const urls=[];
  const found=await EPA.discover(honda,async(url)=>{urls.push(url);return unique(url);});
  assert.equal(found.status,'choose-option');
  assert.equal(found.options.length,2);
  assert.equal(found.options[0].value,'12345');
  assert.equal(urls.length,2); // decoded make allows direct EPA model lookup
  assert.ok(urls.every(url=>url.startsWith('/api/epa/')));
  assert.ok(urls.every(url=>!url.includes('VIN')));
});
test('unsupported model years do not trigger requests',async()=>{
  let invoked=false;
  const found=await EPA.discover({flat:{ModelYear:'1970',Make:'Honda',Model:'Civic'}},async()=>{invoked=true;return unique('');});
  assert.equal(found.status,'unavailable');
  assert.equal(invoked,false);
});
test('EPA model mismatch surfaces a deliberate model picker',async()=>{
  const r=await EPA.discover({flat:{ModelYear:'2024',Make:'Honda',Model:'Nonexistent'}},async(url)=>{
    if(url.includes('menu/make'))return json(menu(['Honda']));
    return json(menu(['Accord','Civic']));
  });
  assert.equal(r.status,'choose-model');
  assert.equal(r.models.length,2);
});
test('EPA record lookup validates numerical ID and parses MPG, cost, EV and PHEV',async()=>{
  await assert.rejects(EPA.vehicle('1;DROP TABLE'),/Invalid EPA vehicle ID/);
  const obj=await EPA.vehicle(12345,async()=>json({id:12345,year:2022,make:'Honda',model:'Civic',comb08:34,city08:30,highway08:40,fuelCost08:1650}));
  const m=EPA.metrics(obj);
  assert.equal(m.combined,34);
  assert.equal(m.yearlyCost,1650);
  assert.equal(m.unit,'MPG');
  const ev=EPA.metrics({id:12346,year:2023,atvtype:'EV',comb08:115,combE:28,rangeA:270});
  assert.equal(ev.unit,'MPGe');
  assert.equal(ev.kwhPer100,28);
  const phev=EPA.metrics({id:12347,atvtype:'Plug-in Hybrid',comb08:35,phevComb:95});
  assert.equal(phev.unit,'MPG');
  assert.equal(phev.phevCombined,95);
});
test('failed EPA HTTP requests surface recoverable errors',async()=>{
  await assert.rejects(EPA.vehicle(55555,async()=>json({},404)),/EPA record not found/);
});
function fixture(){
  const state={history:[{vin:'A',title:'A'},{vin:'B',title:'B'}],makeOff:new Set()};
  let stored=0,fail=false;
  const el=(tag,attrs={},...kids)=>({tag,attrs,kids,append(...parts){this.kids.push(...parts);}});
  const icon=()=>({tag:'icon'});
  const SectionHead=(title,...actions)=>({title,actions});
  const extras=extrasFactory({state,el,icon,render:()=>{},save:()=>{stored++;return !fail;},SectionHead,download:()=>{},toCsv:()=>''});
  return {state,extras,counts:()=>stored,fail:()=>{fail=true;},el};
}
test('Clear all deletes only saved vehicles and Undo restores the complete list',()=>{
  const x=fixture();const before=x.state.history;
  const header=x.extras.savedHeader(before);
  assert.ok(header.actions.length>=2);
  const clearButton=header.actions.at(-1);
  assert.equal(clearButton.kids.at(-1),'Clear all');
  clearButton.attrs.onclick();
  const confirm=x.extras.savedNotice();
  assert.equal(confirm.kids[0].attrs.class,'saved-confirm');
  x.extras.clearSaved();
  assert.equal(x.state.history.length,0);
  assert.equal(x.counts(),1);
  x.extras.undoSaved();
  assert.deepEqual(x.state.history,before);
  assert.equal(x.counts(),2);
});
test('storage rejection rolls back entire clear operation',()=>{
  const x=fixture();x.fail();
  x.extras.clearSaved();
  assert.equal(x.state.history.length,2);
});
test('undo after single removal restores previous saved collection',()=>{
  const x=fixture(),before=x.state.history.slice();
  x.state.history.splice(0,1);
  x.extras.afterToggle(before,true);
  x.extras.undoSaved();
  assert.deepEqual(x.state.history,before);
});
test('electric ranges use EV primary range and PHEV electric-mode range',()=>{
  const ev=EPA.metrics({id:701,atvtype:'EV',fuelType1:'Electricity',range:280,rangeA:40});
  assert.equal(ev.electricRange,280);
  const phev=EPA.metrics({id:702,atvtype:'Plug-in Hybrid',range:550,rangeA:38});
  assert.equal(phev.electricRange,38);
  const gasoline=EPA.metrics({id:703,atvtype:'',fuelType1:'Regular',range:480,rangeA:270});
  assert.equal(gasoline.electricRange,null);
});
test('concurrent EPA lookups share one request',async()=>{
  let calls=0;
  const [a,b]=await Promise.all([
    EPA.vehicle(99123,async()=>{calls++;return json({id:99123,year:2022,make:'Honda'});}),
    EPA.vehicle(99123,async()=>{calls++;return json({id:99123,year:2022,make:'Honda'});})
  ]);
  assert.equal(calls,1);
  assert.equal(a.id,b.id);
});
test('EPA rejects mismatched record identity and malformed payload',async()=>{
  await assert.rejects(EPA.vehicle(99997,async()=>json({id:99998})),/does not match/);
  await assert.rejects(EPA.vehicle(99996,async()=>({ok:true,text:async()=>'<not valid'})),/EPA returned XML|Invalid EPA|Unrecognized|not defined/);
});
test('app startup order, proxy, cache version, and CSP integration',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.ok(html.indexOf('src="epa.js"')<html.indexOf('src="extras.js"'));
  assert.ok(html.indexOf('src="extras.js"')<html.indexOf('src="app.js"'));
  assert.ok(app.includes('extras.EpaPanel(it)'));
  assert.ok(app.includes('extras.savedHeader(shown)'));
  assert.ok(sw.includes('vinbox-v20'));
  assert.ok(sw.includes("'epa.js','extras.js'"));
  const epaRoutes=vercel.rewrites.filter(r=>r.source.startsWith('/api/epa/'));
  assert.equal(epaRoutes.length,2);
  assert.ok(epaRoutes.every(r=>r.destination.startsWith('https://www.fueleconomy.gov/ws/rest/')));
  assert.ok(vercel.rewrites.some(r=>r.source==='/api/postal/us/:zip'&&
    r.destination==='https://api.zippopotam.us/us/:zip'));
  assert.ok(vercel.headers[0].headers.some(h=>h.key==='Content-Security-Policy'&&h.value.includes("connect-src 'self'")));
});
