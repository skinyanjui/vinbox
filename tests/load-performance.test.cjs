'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('above-the-fold page no longer waits for cross-origin web fonts',()=>{
  const html=file('index.html'),css=file('styles.css'),config=JSON.parse(file('vercel.json'));
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.google\.com/.test(html+css));
  assert.ok(/--sans:-apple-system,BlinkMacSystemFont/.test(css));
  assert.ok(/--mono:ui-monospace/.test(css));
  assert.match(html,/rel="stylesheet" href="styles\.css\?v=\d+"/);
  assert.ok(!html.includes('<script>'));
  const csp=config.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
  assert.ok(!csp.includes('fonts.googleapis.com')&&!csp.includes('fonts.gstatic.com'));
  assert.ok(csp.includes("font-src 'self'"));
});
test('early NHTSA connection hint and lazy optional integrations remain intact',()=>{
  const html=file('index.html'),app=file('app.js');
  assert.ok(/rel="preconnect" href="https:\/\/vpic\.nhtsa\.dot\.gov" crossorigin/.test(html));
  assert.match(html,/src="app\.js\?v=\d+" defer/);
  const head=html.slice(0,html.indexOf('</head>'));
  const ordered=['backup.js','epa-match.js','epa.js','vin-lookup.js','extras.js','app.js'];
  const starts=ordered.map(file=>head.indexOf('src="'+file));
  assert.ok(starts.every(i=>i>=0),'all deferred scripts should be discovered from head');
  assert.deepEqual(starts,[...starts].sort((a,b)=>a-b),'preserve module dependency order');
  assert.ok(!html.includes('src="https://unpkg.com'));
  assert.ok(app.includes('loadZxing'));
});
test('installed PWA receives the new asset set',()=>{
  const sw=file('sw.js');
  const revision=sw.match(/const VERSION='vinbox-v(\d+)'/)?.[1];
  assert.ok(revision&&Number(revision)>=30);
  assert.ok(file('index.html').includes('styles.css?v='+revision));
  assert.ok(sw.includes("'styles.css'"));
  assert.ok(sw.includes("'app.js'"));
});
test('deep-linked VIN starts an early lookup once without affecting marketplace routes',async()=>{
  const vm=require('node:vm');
  const vin='WDC0G4KB8GF018636',source=file('vin-lookup.js');
  let requests=0;
  const browser={location:{pathname:'/index.html',hash:'#'+vin}};
  const config={window:browser,AbortController,setTimeout,clearTimeout,
   fetch:async()=>{requests++;return {ok:true,json:async()=>({Results:[{
    VIN:vin,ModelYear:'2016',Make:'Mercedes-Benz',Model:'GLC-Class',ErrorCode:'0'
   }]})};}};
  vm.runInNewContext(source,config);
  assert.equal(requests,1);
  const result=await browser.VinboxEarlyLookup.result;
  assert.equal(result.error,undefined);
  assert.equal(result.vehicles.length,1);
  assert.equal(result.vehicles[0].vin,vin);
  const marketplace={location:{pathname:'/marketplace.html',hash:'#car/'+vin}};
  vm.runInNewContext(source,{...config,window:marketplace});
  assert.equal(marketplace.VinboxEarlyLookup,undefined);
  assert.equal(requests,1);
  const app=file('app.js');
  assert.ok(app.includes('const early=window.VinboxEarlyLookup'));
  assert.ok(app.includes('controller.signal.addEventListener(\'abort\''));
});
test('mobile benchmark records LCP candidates and enforces 2.5s target',()=>{
  const bench=file('scripts/mobile-benchmark.cjs');
  const workflow=file('.github/workflows/mobile-performance.yml');
  assert.ok(bench.includes('lcpElement'));
  assert.ok(bench.includes('slow3g.lcpMedianMs>=2500'));
  assert.ok(workflow.includes('BENCHMARK_RUNS: "3"'));
  for(const fileName of ['index.html','styles.css','sw.js','vercel.json'])
    assert.ok(workflow.includes('      - '+fileName));
});
