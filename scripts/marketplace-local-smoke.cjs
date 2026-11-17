'use strict';
/* Local, deterministic UI smoke and screenshots. Does not need a live deployment. */
const {chromium}=require('playwright-core');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css',
 '.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer((req,res)=>{
 let decoded;
 try{decoded=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}
 catch{res.writeHead(400).end();return;}
 const file=path.resolve(root,'.'+(decoded==='/'?'/marketplace.html':decoded));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,bytes)=>{
  if(error){res.writeHead(error.code==='ENOENT'?404:500).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream',
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(bytes);
 });
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=()=>new Promise(resolve=>server.close(resolve));
const count=page=>page.locator('.market-browse .market-card:visible').count();
async function main(){
 await listen();
 const url='http://127.0.0.1:'+server.address().port+'/marketplace.html';
 const browser=await chromium.launch({
  ...(process.env.BENCHMARK_CHROME_PATH?{executablePath:process.env.BENCHMARK_CHROME_PATH}:{channel:'chrome'}),
  headless:true,args:['--no-sandbox','--disable-dev-shm-usage']
 });
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  colorScheme:'light',reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await ctx.newPage(),errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 // The covered screens do not require cross-origin APIs or credentials.
 await page.route(/^https?:\/\//,route=>{
  if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();
  return route.abort();
 });
 try{
  await page.goto(url+'#browse',{waitUntil:'domcontentloaded'});
  await page.getByText('10 samples',{exact:true}).waitFor();
  assert.equal(await count(page),10);
  const nav=page.getByRole('navigation',{name:'Marketplace navigation'});
  const search=page.getByRole('searchbox',{name:'Search vehicles or locations'});
  const links=await nav.locator('a').evaluateAll(nodes=>nodes.map(n=>({
   href:n.getAttribute('href'),accessible:n.getAttribute('aria-label'),
   visibleText:getComputedStyle(n.querySelector('span')||n).display==='none'?'':n.textContent.trim(),
   icon:n.querySelector('svg')&&getComputedStyle(n.querySelector('svg')).display!=='none',
   height:n.getBoundingClientRect().height
  })));
  assert.deepEqual(links.map(x=>x.href),['#browse','#saved','#new','#profile']);
  assert.ok(links.every(x=>x.icon&&x.accessible&&x.visibleText===''&&x.height>=44));
  const mobileLayout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,
   searchBorder:getComputedStyle(document.querySelector('.market-nav-search')).height,
   cards:getComputedStyle(document.querySelector('.market-cards')).gridTemplateColumns.split(' ').length}));
  assert.equal(mobileLayout.overflow,false);
  assert.equal(mobileLayout.cards,2);
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});
  await page.screenshot({path:path.join(root,'reports/vinbox-mobile-browse.png')});

  await search.fill('under $20k');
  assert.equal(await count(page),2);
  await search.fill('Toyota Camry');
  assert.equal(await count(page),1);
  assert.ok(page.url().includes('q=Toyota+Camry'));
  await search.fill('Mercedes GLC300 2016');
  assert.equal(new URL(page.url()).searchParams.get('q'),'Mercedes GLC300 2016',
   'Normal make, trim, and year searches remain shareable; URL was '+page.url());
  await search.fill('WDC0G4KB8GF018636');
  assert.ok(!page.url().includes('q='));
  await search.fill('no-match');
  await page.getByRole('heading',{name:'No cars found'}).waitFor();
  assert.equal(await count(page),0);
  await page.getByRole('button',{name:'Clear search'}).click();
  assert.equal(await count(page),10);
  await page.locator('#market-sort').selectOption('price-asc');
  const lowest=await page.locator('.market-card:visible').first().locator('.market-card-price-chip').innerText();
  assert.equal(lowest,'$17,450');
  await search.fill('Ford');
  assert.equal(await count(page),3);
  await page.getByRole('link',{name:'Browse',exact:true}).click();
  assert.equal(await count(page),3);
  await search.fill('');
  await page.locator('#market-sort').selectOption('relevant');
  await page.getByRole('link',{name:'2021 Ford F-150 XLT',exact:true}).click();
  assert.equal(await page.locator('.market-similar').count(),0,'No Similar cars section when no matches');
  await page.getByText('None reported by seller',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Browse',exact:true}).click();

  await search.fill('Mazda CX-5');
  await page.getByRole('link',{name:'2021 Mazda CX-5 Touring',exact:true}).click();
  await page.getByText('Lien on vehicle',{exact:true}).waitFor();
  assert.equal(await page.locator('.market-state-warning').count(),1);
  assert.equal(await page.locator('.market-state-clear').count(),0);
  assert.equal(await page.locator('.market-seller-manage').count(),0,'Examples are not editable');
  await page.screenshot({path:path.join(root,'reports/vinbox-mobile-detail.png')});

  await nav.getByRole('link',{name:'Account and sign in'}).click();
  await page.getByRole('heading',{name:'Account',exact:true}).waitFor();
  await page.locator('.market-account-listings').click();
  await page.getByRole('heading',{name:'No listings yet'}).waitFor();
  assert.ok(!errors.length,'Browser errors: '+errors.join('; '));

  await page.setViewportSize({width:1440,height:900});
  await page.goto(url+'#browse',{waitUntil:'domcontentloaded'});
  await page.getByText('10 samples',{exact:true}).waitFor();
  const desktop=await page.evaluate(()=>{
   const nav=document.querySelector('.market-links'),sell=nav.querySelector('.market-sell');
   return {fixed:getComputedStyle(nav).position==='fixed',
    sellLabel:getComputedStyle(sell.querySelector('span')).display!=='none',
    sellIcon:getComputedStyle(sell.querySelector('svg')).display!=='none',
    overflow:document.documentElement.scrollWidth>innerWidth+1,
    columns:getComputedStyle(document.querySelector('.market-cards')).gridTemplateColumns.split(' ').length};
  });
  assert.equal(desktop.fixed,false);
  assert.equal(desktop.sellLabel,true);
  assert.equal(desktop.sellIcon,false);
  assert.equal(desktop.overflow,false);
  assert.equal(desktop.columns,6);
  await page.screenshot({path:path.join(root,'reports/vinbox-desktop-browse.png')});
  assert.ok(!errors.length,'Browser errors: '+errors.join('; '));
  console.log('MARKETPLACE_LOCAL_SMOKE_OK',JSON.stringify({mobileColumns:2,desktopColumns:6,
   iconOnlyMobile:true,searchSort:true,privateVinUrl:true,emptySections:true,screenshots:3}));
 }finally{
  await ctx.close();
  await browser.close();
 }
}
main().then(()=>close(),async err=>{console.error('MARKETPLACE_LOCAL_SMOKE_FAILED',err.stack||String(err));await close();process.exitCode=1;});
