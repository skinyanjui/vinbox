'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkProduction,waitForProduction,ASSETS}=require('../scripts/wait-for-production.cjs');
const content=Buffer.from('unchanged built asset');
const response=(body,status=200)=>({ok:status===200,status,arrayBuffer:async()=>body});
test('deployed static bytes must match the current Git checkout',async()=>{
 const urls=[];
 const result=await checkProduction('https://vinbox-eight.vercel.app/',{
   assets:['app.js','index.html'],
   readFn:()=>content,sha:'test-sha',
   fetchFn:async url=>{urls.push(url);return response(content);}
 });
 assert.equal(result.ready,true);
 assert.equal(result.assetsChecked,2);
 assert.ok(urls.every(u=>u.includes('release_check=test-sha')));
});
test('old deployment is rejected rather than benchmarking a stale release',async()=>{
 const result=await checkProduction('https://vinbox-eight.vercel.app/',{
   assets:['app.js'],readFn:()=>content,
   fetchFn:async()=>response(Buffer.from('previous deployment'))
 });
 assert.equal(result.ready,false);
 assert.match(result.mismatches[0].issue,/content differs/);
});
test('an outage is an explicit deployment readiness failure',async()=>{
 const result=await checkProduction('https://vinbox-eight.vercel.app/',{
   assets:['app.js'],readFn:()=>content,
   fetchFn:async()=>response(content,503)
 });
 assert.equal(result.ready,false);
 assert.match(result.mismatches[0].issue,/503/);
});
test('deployed assets are verified independently and concurrently',async()=>{
 const result=await checkProduction('https://vinbox-eight.vercel.app/',{
   assets:['app.js','sw.js'],readFn:()=>content,
   fetchFn:async url=>url.includes('sw.js')?response(content):response(Buffer.from('stale'))
 });
 assert.deepEqual(result.mismatches.map(x=>x.asset),['app.js']);
});
test('readiness polls until correct commit appears',async()=>{
 let checks=0,time=0;
 const result=await waitForProduction({
   site:'https://vinbox-eight.vercel.app/',assets:['app.js'],readFn:()=>content,
   fetchFn:async()=>response(++checks>=3?content:Buffer.from('old')),
   now:()=>time,sleep:async ms=>{time+=ms},delayMs:7,deadlineMs:40
 });
 assert.equal(result.ready,true);
 assert.equal(result.attempts,3);
});
test('readiness has a bounded timeout instead of hanging forever',async()=>{
 let time=0;
 await assert.rejects(waitForProduction({
   site:'https://vinbox-eight.vercel.app/',assets:['app.js'],readFn:()=>content,
   fetchFn:async()=>response(Buffer.from('wrong')),
   now:()=>time,sleep:async ms=>{time+=ms},delayMs:5,deadlineMs:15
 }),/did not match the checked-out commit/);
});
test('release verifier checks HTML, CSS, JS, and service-worker shell',()=>{
 for(const asset of ['index.html','styles.css','app.js','epa.js','extras.js','sw.js'])
   assert.ok(ASSETS.includes(asset));
});

test('validation CI runs on main and pull requests, with cancellation of superseded jobs',()=>{
 const workflow=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','.github/workflows/test.yml'),'utf8');
 assert.match(workflow,/push:\s*\n\s+branches:\s*\n\s+- main/);
 assert.match(workflow,/pull_request:/);
 assert.match(workflow,/cancel-in-progress: true/);
 assert.match(workflow,/node --test tests\/\*\.test\.cjs/);
});
test('mobile benchmark watches every vehicle and deployment runtime dependency',()=>{
 const workflow=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','.github/workflows/mobile-performance.yml'),'utf8');
 for(const filename of ['app.js','epa.js','epa-match.js','extras.js','backup.js','index.html','styles.css','sw.js','vercel.json'])
   assert.ok(workflow.includes('      - '+filename),'missing performance trigger for '+filename);
 assert.match(workflow,/branches:\s*\n\s+- main/);
 assert.ok(workflow.includes('cancel-in-progress: true'));
 assert.ok(workflow.includes('github.ref == '));
});
test('production asset equality is checked before every cold-network run',()=>{
 const workflow=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','.github/workflows/mobile-performance.yml'),'utf8');
 const verify=workflow.indexOf('node scripts/wait-for-production.cjs');
 const benchmark=workflow.indexOf('node scripts/mobile-benchmark.cjs');
 assert.ok(verify>0&&benchmark>verify);
 assert.match(workflow,/if: always\(\)/);
});
test('benchmark cannot pass with missing LCP or insufficient EPA samples',()=>{
 const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','scripts/mobile-benchmark.cjs'),'utf8');
 assert.ok(script.includes('lcpObservations'));
 assert.ok(script.includes('INSUFFICIENT_LCP_SAMPLES'));
 assert.ok(script.includes('INSUFFICIENT_EPA_SAMPLES'));
 assert.ok(script.includes('validLcpSamples<minValid'));
});
