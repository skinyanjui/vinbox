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

  const filters=page.getByRole('group',{name:'Vehicle type'});
  assert.deepEqual(await filters.locator('button').allTextContents(),
   ['All','SUVs','Trucks','Cars','Vans','Electric']);
  const typeLayout=await filters.evaluate(node=>({
   grid:getComputedStyle(node).display,
   overflow:document.documentElement.scrollWidth>innerWidth+1,
   minTarget:Math.min(...[...node.querySelectorAll('button')].map(x=>x.getBoundingClientRect().height))
  }));
  assert.equal(typeLayout.grid,'grid');
  assert.equal(typeLayout.overflow,false);
  assert.ok(typeLayout.minTarget>=44);
  await filters.getByRole('button',{name:'Trucks'}).click();
  assert.equal(await count(page),1);
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('type')==='truck');
  await search.fill('Ford');
  assert.equal(await count(page),1);
  await page.reload({waitUntil:'domcontentloaded'});
  await filters.getByRole('button',{name:'Trucks'}).waitFor();
  assert.equal(await filters.getByRole('button',{name:'Trucks'}).getAttribute('aria-pressed'),'true');
  assert.equal(await count(page),1);
  await search.fill('');
  await filters.getByRole('button',{name:'Electric'}).click();
  assert.equal(await count(page),1);
  await page.getByRole('link',{name:'2022 Hyundai Ioniq 5 SEL',exact:true}).waitFor();
  await filters.getByRole('button',{name:'All',exact:true}).click();
  assert.equal(await count(page),10);

  await search.fill('under $20k');
  assert.equal(await count(page),2);
  await search.fill('Toyota Camry');
  assert.equal(await count(page),1);
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Toyota Camry');
  await search.fill('Mercedes GLC300 2016');
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Mercedes GLC300 2016');
  await search.fill('WDC0G4KB8GF018636');
  await page.waitForFunction(()=>!new URLSearchParams(location.search).has('q'));
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
  // Backup is exportable offline. Restores require an inline review and preserve existing data.
  const downloadStarted=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download backup'}).click();
  const download=await downloadStarted;
  assert.match(download.suggestedFilename(),/^vinbox-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await page.getByText('Backup download started.',{exact:false}).waitFor();
  const jpeg=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
   canvas.getContext('2d').fillStyle='#d0d0d0';canvas.getContext('2d').fillRect(0,0,4,4);
   return canvas.toDataURL('image/jpeg',.8);
  });
  const backupId='bbbbbbbb-0000-4000-8000-000000000001';
  const photoId='aaaaaaa0-0000-4000-8000-000000000001';
  const backup={
   format:'vinbox-marketplace-backup',version:1,createdAt:'2026-11-17T01:00:00.000Z',
   listings:[{id:backupId,vehicle:{vin:'WDC0G4KB8GF018636',year:2016,make:'Mercedes-Benz',model:'GLC-Class',trim:'GLC300'},
    status:'preview',price:'14900',mileage:'92400',place:'Evansville, IN',
    sellerName:'Backup Seller',sellerType:'private',titleStatus:'clean',condition:'good',
    authorized:true,photoIds:[photoId]}],
   photos:[{id:photoId,data:jpeg}],saved:[backupId,'sample-camry'],
   profile:{sellerName:'Backup Seller',sellerType:'private'}
  };
  await page.getByLabel('Choose VINBOX backup JSON file').setInputFiles({
   name:'vinbox-backup-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))
  });
  await page.getByText('1 new listing · 0 already on this device',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Restore to this device'}).click();
  await page.getByText('Backup restored: 1 new listings.',{exact:false}).waitFor();
  await page.locator('.market-account-listings').click();
  await page.getByText('2016 Mercedes-Benz GLC300',{exact:false}).first().waitFor();
  assert.equal(await page.locator('.market-vehicle-summary').count(),1);
  await page.getByRole('link',{name:'View preview'}).click();
  await page.waitForFunction(()=>document.querySelector('.market-detail-gallery img')?.naturalWidth>0);
  assert.ok(await page.locator('.market-detail-gallery img').count(),'Restored JPEG must be readable from IndexedDB');
  await nav.getByRole('link',{name:'Account and sign in'}).click();
  await page.getByLabel('Choose VINBOX backup JSON file').setInputFiles({
   name:'vinbox-backup-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))
  });
  await page.getByText('0 new listings · 1 already on this device',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('.market-account-listings').click();
  assert.equal(await page.locator('.market-vehicle-summary').count(),1);
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
