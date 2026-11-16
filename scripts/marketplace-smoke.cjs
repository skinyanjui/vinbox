'use strict';
/* Real production browser smoke: no fake inventory, no public publication.
   Tests VIN→Sell transfer, IndexedDB photo, validation, preview, persistence. */
const {chromium}=require('playwright-core');
const base=process.env.BENCHMARK_URL||'https://vinbox-eight.vercel.app/';
const vin='WDC0G4KB8GF018636';
const samplePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGM8fvoMAwwwMSAB3BwAd1sCZoKJs+EAAAAASUVORK5CYII=','base64');
async function main(){
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(new URL('#'+vin,base).href,{waitUntil:'domcontentloaded',timeout:40000});
  const sell=page.locator('.card-actions button').filter({hasText:'Sell'}).first();
  await sell.waitFor({timeout:45000});
  await sell.click();
  await page.waitForURL(/marketplace\.html#new/,{timeout:15000});
  await page.getByText('2016 Mercedes-Benz GLC-Class GLC300 Base-4M').first().waitFor({timeout:12000});
  await page.locator('#m-price').fill('14900');
  await page.locator('#m-mileage').fill('92400');
  await page.locator('#m-place').fill('Evansville, Indiana');
  await page.locator('#m-titleStatus').selectOption('clean');
  await page.locator('#m-condition').selectOption('good');
  await page.locator('#m-authorized').check();
  await page.locator('.market-photos input[type=file]').setInputFiles({name:'car.png',mimeType:'image/png',buffer:samplePng});
  await page.locator('.market-thumb').first().waitFor({timeout:25000});
  await page.getByRole('button',{name:'Preview listing'}).click();
  await page.waitForURL(/marketplace\.html#car\//,{timeout:12000});
  await page.getByText('$14,900').first().waitFor({timeout:12000});
  const previewPhoto=page.locator('.market-detail-gallery img').first();
  await previewPhoto.waitFor({timeout:15000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.market-detail-gallery img').first().waitFor({timeout:15000});
  await page.locator('nav').getByText('My listings').click();
  await page.getByRole('button',{name:'Mark sold'}).click();
  await page.getByText('Sold · Local preview').first().waitFor();
  const active=await page.locator('.market-vehicle-summary').count();
  if(active!==1)throw Error('Expected one persisted local listing, got '+active);
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));

  // Verify actual browser grid styles at mobile, tablet and large-desktop sizes.
  // Populate only the isolated test browser with additional synthetic previews.
  await page.evaluate(()=>{
    const key='vinbox-marketplace-drafts-v1',saved=JSON.parse(localStorage.getItem(key)||'[]');
    const first=saved[0];if(!first)throw Error('Missing live test listing');
    for(let i=1;i<12;i++)saved.push({...first,id:crypto.randomUUID(),price:String(14000+i),createdAt:new Date().toISOString()});
    localStorage.setItem(key,JSON.stringify(saved));
  });
  await page.goto(new URL('marketplace.html#browse',base).href,{waitUntil:'domcontentloaded'});
  const viewports=[[390,2],[600,2],[768,3],[1024,4],[1280,5],[1600,6]];
  for(const [width,expected] of viewports){
    await page.setViewportSize({width,height:844});
    const result=await page.locator('.market-cards').evaluate(grid=>({
      columns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      items:grid.children.length,
      overflow:grid.scrollWidth>grid.clientWidth+1
    }));
    if(result.columns!==expected||result.items!==12||result.overflow)
      throw Error('Grid '+width+'px expected '+expected+' columns: '+JSON.stringify(result));
  }
  console.log('MARKETPLACE_SMOKE_OK '+JSON.stringify({vinLast4:vin.slice(-4),listingCount:active,photoPersisted:true,soldTransition:true,responsiveGridVerified:true}));
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error('MARKETPLACE_SMOKE_FAILED '+e.stack);process.exitCode=1;});
