'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=require('../app.js');

const VIN='1HGCM82633A004352';
const vinRow={VIN,Make:'HONDA',Model:'Accord',ModelYear:'2003',BodyClass:'Sedan/Saloon'};
const response=(rows,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>({Results:rows})});

test('normalizes VIN text and verifies checksum',()=>{
  assert.equal(app.normalize('1hg-cm82633a004352'),VIN);
  assert.equal(app.checkDigitOk(VIN),true);
  assert.equal(app.checkDigitOk(VIN.slice(0,16)+'3'),false);
});
test('parses grouped VIN and partial VIN with year',()=>{
  assert.equal(app.squeezeVin('1HG CM826 33A 004352').vin,VIN);
  assert.deepEqual(app.parseEntries('5UXWX7C5*BA 2011'),[{vin:'5UXWX7C5*BA',partial:true,year:'2011'}]);
});
test('extracts barcodes and removes duplicate VINs',()=>{
  assert.deepEqual(app.extractVins('VIN: '+VIN),[VIN]);
  assert.deepEqual(app.extractVins('I'+VIN),[VIN]);
  assert.equal(app.parseEntries(VIN+'\n'+VIN).length,1);
});
test('limits batch decoding to 250 distinct VINs',()=>{
  const bulk=Array.from({length:251},(_,i)=>'1HGCM82633A'+String(i).padStart(6,'0')).join('\n');
  assert.equal(app.inspectInput(bulk).state,'bad');
  assert.equal(app.inspectInput(bulk).vins.length,0);
});
test('VIN origin lookup has offline reference entries',()=>{
  assert.equal(app.countryOfVin(VIN),'United States');
  assert.equal(app.countryOfVin('JHMCM82633C000000'),'Japan');
});
test('CSV escapes formulas, leading whitespace and quotes',()=>{
  const csv=app.toCsv([{vin:VIN,flat:{Make:'=1+2',Model:'@HYPERLINK',Trim:'\n-CMD',BodyClass:'A"b'}}]);
  assert.ok(csv.includes("'=1+2"));
  assert.ok(csv.includes("'@HYPERLINK"));
  assert.ok(csv.includes("'\n-CMD"));
  assert.ok(csv.includes('"A""b"'));
});
test('decodes a single vehicle with a mocked NHTSA response',async()=>{
  let requested='';
  const results=await app.decodeVins([{vin:VIN}],async url=>{requested=url;return response([vinRow]);});
  assert.match(requested,/DecodeVinValues/);
  assert.equal(results[0].vin,VIN);
  assert.equal(results[0].make,'Honda');
});
test('batch decoder sends POST and preserves input/result mapping',async()=>{
  const vins=[VIN,'1HGCM82633A004353'];
  let options;
  const results=await app.decodeVins(vins,async(url,init)=>{
    options=init;return response(vins.map(v=>({...vinRow,VIN:v})));
  });
  assert.equal(results.length,2);
  assert.equal(results[1].vin,vins[1]);
  assert.equal(options.method,'POST');
  assert.match(options.body,/data=/);
});
test('partial API batches cannot silently lose vehicles',async()=>{
  await assert.rejects(app.decodeVins([VIN,'1HGCM82633A004353'],async()=>response([vinRow])),/incomplete batch/);
});
test('empty API results display a recoverable failure',async()=>{
  await assert.rejects(app.decodeVins([VIN],async()=>response([])),/no vehicle data/);
});
test('retryable 503 response backs off and recovers',async()=>{
  let calls=0,sleeps=0;
  await app.fetchRetry('https://example.test',{},async()=>{calls++;return calls===1?response([],503):response([]);},async()=>{sleeps++;});
  assert.equal(calls,2);assert.equal(sleeps,1);
});
test('bad-request HTTP 400 is not retried',async()=>{
  let calls=0;
  await assert.rejects(app.fetchRetry('https://example.test',{},async()=>{calls++;return response([],400);},async()=>{}),/400/);
  assert.equal(calls,1);
});
test('caller abort prevents request execution',async()=>{
  const c=new AbortController();c.abort();
  let called=false;
  await assert.rejects(app.decodeVins([VIN],async()=>{called=true;return response([]);},undefined,c.signal),{name:'AbortError'});
  assert.equal(called,false);
});
test('offline assets, scripts and deployment security configuration',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
  assert.ok(manifest.icons.length>=2);
  assert.match(html,/src="app\.js\?v=\d+"/);
  assert.ok(html.includes('href="styles.css"'));
  assert.equal(html.includes('<script>'),false);
  new vm.Script(sw);
  assert.ok(sw.includes("'app.js'"));
  assert.ok(sw.includes("'styles.css'"));
  assert.ok(sw.includes('vinbox-'));
  const csp=config.headers.flatMap(x=>x.headers).find(x=>x.key==='Content-Security-Policy')?.value||'';
  assert.ok(csp.includes("script-src 'self' https://unpkg.com"));
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(csp.includes('https://vpic.nhtsa.dot.gov'));
  assert.ok(csp.includes('https://api.nhtsa.gov'));
});
