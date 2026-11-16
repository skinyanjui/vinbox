'use strict';
/* Browser smoke for the demo catalog and private VIN-to-listing flow. */
const {chromium}=require('playwright-core');
const base=process.env.BENCHMARK_URL||'https://vinbox-eight.vercel.app/';
const vin='WDC0G4KB8GF018636';
const samplePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGM8fvoMAwwwMSAB3BwAd1sCZoKJs+EAAAAASUVORK5CYII=','base64');
async function main(){
 const executablePath=process.env.BENCHMARK_CHROME_PATH;
 const browser=await chromium.launch({...(executablePath?{executablePath}:{channel:'chrome'}),
  headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Deterministic ZIP response tests client autofill independently of provider uptime.
 await page.route('**/api/postal/us/47715',route=>route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({'post code':'47715','country abbreviation':'US',
     places:[{'place name':'Evansville','state abbreviation':'IN'}]})
 }));
 try{
  await page.goto(new URL('marketplace.html#browse',base).href,{waitUntil:'domcontentloaded'});
  await page.getByText('10 samples',{exact:true}).waitFor();
  const search=page.getByRole('searchbox',{name:'Search vehicles or locations'});
  const navigation=page.getByRole('navigation',{name:'Marketplace navigation'});
  const mobileNav=await navigation.evaluate(nav=>{
   const field=nav.parentElement.querySelector('form[role="search"]').getBoundingClientRect();
   return {position:getComputedStyle(nav).position,bottom:nav.getBoundingClientRect().bottom,
    height:window.innerHeight,center:field.left+field.width/2,width:window.innerWidth,
    middle:nav.children[1]?.dataset.nav};
  });
  if(mobileNav.position!=='fixed'||Math.abs(mobileNav.bottom-mobileNav.height)>1||
     Math.abs(mobileNav.center-mobileNav.width/2)>1||mobileNav.middle!=='new')
   throw Error('Mobile navigation or header search is misplaced: '+JSON.stringify(mobileNav));
  await search.fill('Electric');
  await page.getByText('1 sample',{exact:true}).waitFor();
  await page.getByRole('link',{name:'2022 Hyundai Ioniq 5 SEL',exact:true}).click();
  await page.getByText('Boonville, IN · Sample listing',{exact:true}).waitFor();
  if(!(await page.locator('#market-main > :first-child').evaluate(x=>x.matches('.market-detail-gallery'))))
   throw Error('The detail gallery must appear first');
  await page.waitForFunction(()=>document.querySelector('.market-detail-gallery img')?.naturalWidth>0);
  await page.getByText('Orchard Lane Auto',{exact:true}).waitFor();
  await page.getByText('Dealership',{exact:true}).waitFor();
  await page.locator('.market-seller-avatar').getByText('OL',{exact:true}).waitFor();
  if(await page.getByRole('link',{name:'Edit',exact:true}).count())throw Error('Sample listings must be read-only');
  await page.getByRole('link',{name:'Back to cars'}).click();
  await page.getByText('1 sample',{exact:true}).waitFor();
  if(await search.inputValue()!=='Electric')throw Error('Returning from a listing loses the active filter');
  await search.fill('no-matching-car');
  await page.getByRole('heading',{name:'No matching vehicles'}).waitFor();
  await page.getByRole('link',{name:'My listings',exact:true}).click();
  await page.getByRole('heading',{name:'No listings yet'}).waitFor();
  await search.fill('Ford');
  await search.press('Enter');
  await page.getByText('3 samples',{exact:true}).waitFor();

  await page.goto(new URL('#'+vin,base).href,{waitUntil:'domcontentloaded',timeout:40000});
  const sell=page.locator('.card-actions button').filter({hasText:'Sell'}).first();
  await sell.waitFor({timeout:45000});
  await sell.click();
  await page.waitForURL(/marketplace\.html#new/,{timeout:15000});
  await page.getByText('2016 Mercedes-Benz GLC300').first().waitFor({timeout:12000});
  await page.locator('#m-price').fill('14900');
  await page.locator('#m-mileage').fill('92400');
  await page.locator('#m-place').fill('47715');
  await page.waitForFunction(()=>document.querySelector('#m-place')?.value==='Evansville, IN',null,{timeout:10000});
  const cityHint=await page.locator('.market-postal-hint').innerText();
  if(!cityHint.includes('47715'))throw Error('ZIP location was not automatically populated');
  await page.locator('#m-titleStatus').selectOption('clean');
  await page.locator('#m-condition').selectOption('good');
  await page.getByLabel('Seller type').selectOption('dealership');
  await page.getByLabel('Dealership name').fill('Smoke Test Motors');
  await page.locator('#m-authorized').check();
  await page.locator('.market-photos input[type=file]').setInputFiles(
    [0,1,2,3].map(i=>({name:'car-'+i+'.png',mimeType:'image/png',buffer:samplePng})));
  await page.locator('.market-thumb').nth(3).waitFor({timeout:25000});
  await page.locator('.market-thumb img').first().waitFor({timeout:15000});
  const editor=await page.locator('.market-photos').evaluate(x=>({
    count:x.querySelectorAll('.market-thumb').length,
    scrolling:x.scrollWidth>x.clientWidth,
    removeButtons:x.querySelectorAll('.market-thumb button').length
  }));
  if(editor.count!==4||!editor.scrolling||editor.removeButtons!==4)
    throw Error('Editor photo shelf failed: '+JSON.stringify(editor));
  await page.locator('.market-avatar-actions input[type=file]').setInputFiles(
   {name:'logo.png',mimeType:'image/png',buffer:samplePng});
  await page.getByText('Seller image saved.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Preview listing'}).click();
  await page.waitForURL(/marketplace\.html#car\//,{timeout:12000});
  await page.getByText('$14,900').first().waitFor({timeout:12000});
  await page.getByText('Smoke Test Motors',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.market-seller-avatar img')?.naturalWidth>0);
  // The details page keeps important seller-reported facts visible and VIN
  // specifications collapsed until someone requests them.
  await page.getByText('Condition & title').first().waitFor();
  const disclosure=page.locator('.market-disclosure-pair');
  if(!(await disclosure.innerText()).includes('Clean')||
     !(await disclosure.innerText()).includes('Good'))
    throw Error('Expected concise reported title and condition');
  const more=page.locator('.market-specifications');
  if(await more.evaluate(node=>node.open))throw Error('Specifications should start collapsed');
  await more.locator('summary').click();
  if(!(await more.innerText()).includes('Ends in 8636'))throw Error('VIN summary should expose last four digits only');
  const previewPhoto=page.locator('.market-detail-gallery img').first();
  await previewPhoto.waitFor({timeout:15000});
  const count=page.locator('.market-detail-gallery .market-carousel-count');
  if((await count.innerText())!=='1 / 4')throw Error('Photo counter did not initialize');
  await page.locator('.market-detail-gallery .market-carousel-track').evaluate(x=>{
    x.scrollTo({left:x.clientWidth,behavior:'instant'});
    x.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(()=>document.querySelector('.market-detail-gallery .market-carousel-count')?.textContent==='2 / 4',
    null,{timeout:10000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.market-detail-gallery img').first().waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector('.market-seller-avatar img')?.naturalWidth>0);
  await page.locator('nav').getByText('My listings').click();
  await page.getByRole('button',{name:'Mark sold'}).click();
  await page.getByText('Sold').first().waitFor();
  const active=await page.locator('.market-vehicle-summary').count();
  if(active!==1)throw Error('Expected one persisted local listing, got '+active);
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));

  await page.getByRole('link',{name:'Browse',exact:true}).click();
  await page.locator('.market-card').nth(10).waitFor({timeout:12000});
  const pageCopy=await page.locator('#market-main').innerText();
  if(pageCopy.includes('Browse the photo-first listing experience.')||
     pageCopy.includes('Private preview: listings shown here exist only')||
     pageCopy.includes('Sell your car'))
    throw Error('Browse page repeats navigation labels or obsolete explanatory text');
  if(!(pageCopy.includes('on this device · Not public')))throw Error('Missing quiet private-only notice');
  const viewports=[[390,2],[600,2],[768,3],[1024,4],[1280,5],[1600,6]];
  for(const [width,expected] of viewports){
    await page.setViewportSize({width,height:844});
    const result=await page.locator('.market-cards').evaluate(grid=>({
      columns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      items:grid.children.length,
      overflow:grid.scrollWidth>grid.clientWidth+1
    }));
    if(result.columns!==expected||result.items!==11||result.overflow)
      throw Error('Grid '+width+'px expected '+expected+' columns: '+JSON.stringify(result));
  }
  if(await navigation.evaluate(nav=>getComputedStyle(nav).position)==='fixed')
   throw Error('Desktop navigation should be in the header');
  console.log('MARKETPLACE_SMOKE_OK '+JSON.stringify({vinLast4:vin.slice(-4),listingCount:active,samples:10,
   galleryFirst:true,mobileNav:true,sellerIdentityPersisted:true,photoPersisted:true,soldTransition:true,responsiveGridVerified:true,
   zipAutofill:true,scrollablePhotos:true}));
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error('MARKETPLACE_SMOKE_FAILED '+e.stack);process.exitCode=1;});
