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
  assert.ok(sw.includes("const VERSION='vinbox-v30'"));
  assert.ok(sw.includes("'styles.css'"));
  assert.ok(sw.includes("'app.js'"));
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
