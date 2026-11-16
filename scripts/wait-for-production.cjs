'use strict';
/* Ensure a production benchmark measures the files in this workflow commit,
 * not the previous release while Vercel is still deploying.
 * Only public static assets are fetched; no credentials or VINs are sent.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const samples=require('../marketplace-samples.js');

const ASSETS=[
  'index.html','styles.css','app.js','backup.js',
  'epa-match.js','epa.js','extras.js','sw.js',
  'marketplace.html','marketplace.css','marketplace-core.js','marketplace-samples.js','marketplace.js',
  ...new Set(samples.flatMap(sample=>[...sample.photoSources,sample.sellerAvatarSrc]).filter(Boolean))
];
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

async function checkProduction(base,options={}){
  const fetchFn=options.fetchFn||fetch;
  const readFn=options.readFn||((file)=>fs.readFileSync(path.join(__dirname,'..',file)));
  const assets=options.assets||ASSETS;
  const mismatches=[];
  const checks=await Promise.all(assets.map(async file=>{
    let expected=readFn(file);
    if(!Buffer.isBuffer(expected))expected=Buffer.from(expected);
    const url=new URL(file,base);
    url.searchParams.set('release_check',options.sha||process.env.GITHUB_SHA||'latest');
    try{
      const response=await fetchFn(url.href,{
        method:'GET',redirect:'error',
        headers:{'cache-control':'no-cache','pragma':'no-cache'},
        signal:AbortSignal.timeout(12000)
      });
      if(!response.ok)return {asset:file,issue:'HTTP '+response.status};
      const actual=Buffer.from(await response.arrayBuffer());
      return digest(actual)===digest(expected)?
        {asset:file,ok:true}:{asset:file,issue:'content differs from checked-out commit'};
    }catch(err){
      return {asset:file,issue:err.message||String(err)};
    }
  }));
  for(const result of checks)if(!result.ok)mismatches.push(result);
  return {ready:mismatches.length===0,assetsChecked:checks.length,mismatches};
}

async function waitForProduction(options={}){
  const site=options.site||process.env.BENCHMARK_URL||'https://vinbox-eight.vercel.app/';
  const deadlineMs=options.deadlineMs??180000;
  const delayMs=options.delayMs??7000;
  const now=options.now||Date.now;
  const sleep=options.sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const start=now();
  let attempts=0,last=null;
  do{
    attempts++;
    last=await checkProduction(site,options);
    if(last.ready)return {ready:true,attempts,elapsedMs:now()-start};
    if(now()-start>=deadlineMs)break;
    const remaining=deadlineMs-(now()-start);
    await sleep(Math.min(delayMs,remaining));
  }while(now()-start<deadlineMs);
  const issues=last?.mismatches.map(x=>x.asset+': '+x.issue).join('; ')||'unknown';
  throw new Error('Vercel production did not match the checked-out commit after '+attempts+
    ' checks ('+Math.round((now()-start)/1000)+'s): '+issues);
}

if(require.main===module){
  waitForProduction().then(result=>console.log('PRODUCTION_READY '+JSON.stringify(result)))
    .catch(e=>{console.error('PRODUCTION_NOT_READY '+e.message);process.exitCode=1;});
}
module.exports={ASSETS,digest,checkProduction,waitForProduction};
