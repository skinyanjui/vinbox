'use strict';
// Live network mobile lab for VINBOX. Executes against the deployed site,
// never mocks or rewrites NHTSA/EPA requests. No analytics data is uploaded.
const {chromium}=require('playwright-core');
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const SITE=process.env.BENCHMARK_URL||'https://vinbox-eight.vercel.app/';
const VIN=process.env.BENCHMARK_VIN||'WDC0G4KB8GF018636';
const RUNS=Math.max(1,Math.min(5,Number(process.env.BENCHMARK_RUNS||3)));
const PROFILES=[
 {name:'Slow 4G',latency:150,down:1_600_000,up:750_000,cpu:4,connectionType:'cellular4g'},
 {name:'Slow 3G',latency:400,down:400_000,up:400_000,cpu:4,connectionType:'cellular3g'}
];
const median=arr=>{if(!arr.length)return null;const a=[...arr].sort((a,b)=>a-b);return Math.round((a[(a.length-1)>>1]+a[a.length>>1])/2)};
const round=n=>Number.isFinite(n)?Math.round(n):null;
const isVinAPI=url=>url.includes('vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/');
const isEPA=url=>url.includes('/api/epa/vehicle/');
async function sample(browser,profile,index){
 const context=await browser.newContext({
  viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,
  serviceWorkers:'block',
  userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  locale:'en-US',reducedMotion:'reduce'
 });
 const page=await context.newPage();
 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');
 await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 await cdp.send('Network.emulateNetworkConditions',{
  offline:false,latency:profile.latency,
  downloadThroughput:profile.down/8,uploadThroughput:profile.up/8,
  connectionType:profile.connectionType
 });
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:profile.cpu});
 await page.addInitScript(()=>{
  window.__perf={lcp:0,fcp:0};
  try{
   const po=new PerformanceObserver(list=>{
    for(const e of list.getEntries()){
     if(e.entryType==='largest-contentful-paint')window.__perf.lcp=e.startTime;
     if(e.name==='first-contentful-paint')window.__perf.fcp=e.startTime;
    }
   });
   po.observe({type:'largest-contentful-paint',buffered:true});
   po.observe({type:'paint',buffered:true});
  }catch(e){}
 });
 const started=new Map(),requests=[],errors=[];
 let bytes=0;
 cdp.on('Network.loadingFinished',e=>{bytes+=e.encodedDataLength||0});
 cdp.on('Network.requestWillBeSent',e=>{
  const u=e.request.url;
  if(isVinAPI(u)||isEPA(u)){
   started.set(e.requestId,{url:u,t:performance.now()});
  }
 });
 cdp.on('Network.responseReceived',e=>{
  const s=started.get(e.requestId);if(s)s.status=e.response.status;
 });
 cdp.on('Network.loadingFinished',e=>{
  const s=started.get(e.requestId);
  if(s){requests.push({kind:isVinAPI(s.url)?'VIN':'EPA',path:new URL(s.url).pathname,status:s.status||0,ms:round(performance.now()-s.t)});started.delete(e.requestId);}
 });
 cdp.on('Network.loadingFailed',e=>{
  const s=started.get(e.requestId);
  if(s){requests.push({kind:isVinAPI(s.url)?'VIN':'EPA',path:new URL(s.url).pathname,status:'failed',ms:round(performance.now()-s.t),error:e.errorText});started.delete(e.requestId);}
 });
 page.on('pageerror',e=>errors.push(String(e).slice(0,250)));
 let navigationMs=null,uiReadyMs=null,vinVisibleMs=null,epaVisibleMs=null,errorText=null,metrics={};
 const start=performance.now();
 try{
  const url=new URL(SITE);url.hash=VIN;
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:55000});
  navigationMs=round(performance.now()-start);
  await page.locator('#tabs [role="tab"]').first().waitFor({timeout:15000});
  uiReadyMs=round(performance.now()-start);
  await page.waitForFunction(vin=>{
   const card=document.querySelector('article.card');
   return card&&card.textContent.includes(vin)&&card.textContent.includes('Mercedes');
  },VIN,{timeout:60000});
  vinVisibleMs=round(performance.now()-start);
  try{
   await page.waitForFunction(()=>{
    const node=document.querySelector('.epa .n .badge');
    return node&&(/\d+[\s–-]*\d*\s*(?:MPG|MPGe)/i.test(node.textContent||'')||
      /No match|Unavailable|Select version/i.test(node.textContent||''));
   },null,{timeout:65000});
   epaVisibleMs=round(performance.now()-start);
  }catch(e){errorText='EPA result not ready within 65 s';}
  metrics=await page.evaluate(()=>{
   const nav=performance.getEntriesByType('navigation')[0];
   const d=document.querySelector('.epa .n .badge');
   const paint=performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint');
   return {
    fcp:Math.round(window.__perf?.fcp||paint?.startTime||0)||null,
    lcp:Math.round(window.__perf?.lcp||0)||null,
    domContentLoaded:nav?Math.round(nav.domContentLoadedEventEnd):null,
    loadEvent:nav&&nav.loadEventEnd?Math.round(nav.loadEventEnd):null,
    epaBadge:d?.textContent?.trim()||null,
    vehicleTitle:document.querySelector('.card-title')?.textContent?.trim()||null
   };
  });
 }catch(e){errorText=String(e).slice(0,300);}
 const vinRequests=requests.filter(x=>x.kind==='VIN');
 const epaRequests=requests.filter(x=>x.kind==='EPA');
 const isMpg=/\d+[\s–-]*\d*\s*(?:MPG|MPGe)/i.test(metrics.epaBadge||'');
 const result={profile:profile.name,trial:index,network:{rttMs:profile.latency,downloadKbps:profile.down/1000,uploadKbps:profile.up/1000,cpuSlowdown:profile.cpu},
  page:{domContentLoadedMs:metrics.domContentLoaded??navigationMs,firstContentfulPaintMs:metrics.fcp??null,largestContentfulPaintMs:metrics.lcp??null,uiReadyMs,loadEventMs:metrics.loadEvent??null,bytes},
  journey:{vinVisibleMs,epaVisibleMs,vinHttpMs:vinRequests.length?vinRequests.reduce((n,x)=>n+x.ms,0):null,epaHttpMs:epaRequests.reduce((n,x)=>n+x.ms,0)||null,epaFromVinMs:vinVisibleMs!=null&&epaVisibleMs!=null?epaVisibleMs-vinVisibleMs:null,verifiedMpg:isMpg,epaBadge:metrics.epaBadge},
  requests,errors:errors.slice(0,5),failure:errorText};
 await context.close();
 return result;
}
async function main(){
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const results=[];
 try{
  for(const profile of PROFILES){
   for(let n=1;n<=RUNS;n++){
    const r=await sample(browser,profile,n);
    results.push(r);
    console.log('MOBILE_PERF_SAMPLE '+JSON.stringify({
      profile:r.profile,trial:r.trial,fcp:r.page.firstContentfulPaintMs,lcp:r.page.largestContentfulPaintMs,
      vinVisible:r.journey.vinVisibleMs,epaVisible:r.journey.epaVisibleMs,
      vinHttp:r.journey.vinHttpMs,epaHttp:r.journey.epaHttpMs,
      epaBadge:r.journey.epaBadge,verified:r.journey.verifiedMpg,failure:r.failure
    }));
   }
  }
 }finally{await browser.close();}
 const summary=PROFILES.map(p=>{
  const samples=results.filter(x=>x.profile===p.name);
  return {profile:p.name,samples:samples.length,complete:samples.filter(x=>x.journey.verifiedMpg).length,
   fcpMedianMs:median(samples.map(x=>x.page.firstContentfulPaintMs).filter(Number.isFinite)),
   lcpMedianMs:median(samples.map(x=>x.page.largestContentfulPaintMs).filter(Number.isFinite)),
   uiReadyMedianMs:median(samples.map(x=>x.page.uiReadyMs).filter(Number.isFinite)),
   vinVisibleMedianMs:median(samples.map(x=>x.journey.vinVisibleMs).filter(Number.isFinite)),
   vinHttpMedianMs:median(samples.map(x=>x.journey.vinHttpMs).filter(Number.isFinite)),
   epaVisibleMedianMs:median(samples.filter(x=>x.journey.verifiedMpg).map(x=>x.journey.epaVisibleMs).filter(Number.isFinite)),
   epaAfterVinMedianMs:median(samples.filter(x=>x.journey.verifiedMpg).map(x=>x.journey.epaFromVinMs).filter(Number.isFinite)),
   epaHttpMedianMs:median(samples.map(x=>x.journey.epaHttpMs).filter(Number.isFinite))
  };
 });
 fs.mkdirSync('reports',{recursive:true});
 const report={measuredAt:new Date().toISOString(),site:SITE,vin:VIN,
  method:'Headless Google Chrome on GitHub ubuntu-latest, Android viewport, Chrome CDP network emulation, CPU x4, no service worker or HTTP cache. Actual public site and live NHTSA/EPA services (no mocked responses). Cold loads. Lab, not a physical phone or real user data.',
  summary,results};
 fs.writeFileSync('reports/mobile-performance.json',JSON.stringify(report,null,2));
 console.log('MOBILE_PERF_SUMMARY '+JSON.stringify(summary));
 if(summary.some(s=>s.complete===0)){console.error('At least one profile had no confirmed EPA rating. See report for errors.');process.exitCode=1;}
}
main().catch(err=>{console.error(err);process.exitCode=1});
