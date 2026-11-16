'use strict';
/* Browser smoke for the demo catalog and private VIN-to-listing flow. */
const {chromium}=require('playwright-core');
const base=process.env.BENCHMARK_URL||'https://vinbox-eight.vercel.app/';
const vin='WDC0G4KB8GF018636';
const manualVin='1HGCM82633A004352';
const samplePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGM8fvoMAwwwMSAB3BwAd1sCZoKJs+EAAAAASUVORK5CYII=','base64');
async function checkCardOverlays(page,width){
 const cards=page.locator('.market-card:not([hidden])');
 const errors=await cards.evaluateAll(items=>items.flatMap(card=>{
  const photo=card.querySelector('.market-card-photo-link').getBoundingClientRect();
  const price=card.querySelector('.market-card-price-chip').getBoundingClientRect();
  const button=card.querySelector('.market-save-compact').getBoundingClientRect();
  const icon=card.querySelector('.market-save-compact svg').getBoundingClientRect();
  return Math.abs(price.top-icon.top)<1&&Math.abs(price.height-icon.height)<1&&
   price.top>=photo.top&&price.top<photo.top+20&&price.left>=photo.left&&price.left<photo.left+20&&
   price.right<=button.left&&button.right<=photo.right&&button.width>=44&&button.height>=44?
   []:[card.querySelector('.market-card-title').textContent];
 }));
 if(!await cards.count()||errors.length)
  throw Error('Price and Save must share a row with matching chip heights at '+width+'px: '+errors.join(', '));
}
async function checkSaveBorder(button,saved,compact=false,color='rgb(0, 80, 200)'){
 const border=await button.evaluate((element,isCompact)=>{
  const surface=isCompact?element.querySelector('svg'):element;
  return getComputedStyle(surface).borderTopColor;
 },compact);
 const expected=saved?color:'rgba(0, 0, 0, 0)';
 if(border!==expected)throw Error('Expected Save border '+expected+', got '+border);
}
async function main(){
 const executablePath=process.env.BENCHMARK_CHROME_PATH;
 const browser=await chromium.launch({...(executablePath?{executablePath}:{channel:'chrome'}),
  headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',colorScheme:'light'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(url=>url.hostname==='vpic.nhtsa.dot.gov'&&url.pathname.endsWith('/DecodeVinValues/'+manualVin),
  route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{Results:[
   {VIN:manualVin,Make:'Honda',Model:'Accord',Trim:'EX',ModelYear:'2003',ErrorCode:'0'}
  ]}}));
 // Deterministic ZIP response tests client autofill independently of provider uptime.
 await page.route('**/api/postal/us/47715',route=>route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({'post code':'47715','country abbreviation':'US',
     places:[{'place name':'Evansville','state abbreviation':'IN'}]})
 }));
 await page.route('**/api/epa/vehicle/**',route=>{
  const url=new URL(route.request().url());
  const record={id:10001,year:2022,make:'Hyundai',model:'Ioniq 5',drive:'Rear-Wheel Drive',
   atvType:'EV',fuelType1:'Electricity',range:303,comb08:114,city08:132,highway08:98};
  const body=url.pathname.endsWith('/model')?[{text:'Ioniq 5',value:'Ioniq 5'}]:
   url.pathname.endsWith('/options')?[{text:'Automatic, Electricity',value:'10001'}]:record;
  return route.fulfill({json:body});
 });
 let recallChecks=0;
 await page.route('https://api.nhtsa.gov/recalls/recallsByVehicle?**',route=>{
  recallChecks++;
  return route.fulfill({status:recallChecks===1?503:200,headers:{'access-control-allow-origin':'*'},
   json:{results:[{NHTSACampaignNumber:'FIXTURE',Component:'ELECTRICAL SYSTEM',Summary:'Test campaign.'}]}});
 });
 try{
  await page.goto(new URL('marketplace.html#browse',base).href,{waitUntil:'domcontentloaded'});
  await page.getByText('10 samples',{exact:true}).waitFor();
  const longTitle=page.getByRole('link',{name:'2020 Jeep Wrangler Unlimited Sport',exact:true});
  const rows=await longTitle.evaluate(title=>{
   const mileage=title.parentElement.nextElementSibling,location=mileage.nextElementSibling;
   const style=getComputedStyle(title);
   return {truncated:title.scrollWidth>title.clientWidth&&style.textOverflow==='ellipsis'&&style.whiteSpace==='nowrap',
    fullTitle:title.textContent,mileage:mileage.textContent,location:location.textContent,
    separateRows:mileage.getBoundingClientRect().top>=title.getBoundingClientRect().bottom&&
     location.getBoundingClientRect().top>=mileage.getBoundingClientRect().bottom-0.5};
  });
  if(!rows.truncated||!rows.separateRows||rows.fullTitle!=='2020 Jeep Wrangler Unlimited Sport'||
     rows.mileage!=='81,300 mi'||rows.location!=='Mount Vernon, IN')
   throw Error('Expected a single-line title above separate mileage and location rows: '+JSON.stringify(rows));
  const search=page.getByRole('searchbox',{name:'Search vehicles or locations'});
  const navigation=page.getByRole('navigation',{name:'Marketplace navigation'});
  for(const width of [320,360,390,600,750,751,768,1024,1600]){
   await page.setViewportSize({width,height:844});
   const layout=await navigation.evaluate(nav=>{
    const header=nav.parentElement,form=header.querySelector('form[role="search"]');
    const field=form.getBoundingClientRect(),brandLink=header.querySelector('.market-brand');
    const brand=brandLink.getBoundingClientRect();
    const dock=nav.getBoundingClientRect(),viewport=document.documentElement.clientWidth;
    return {fixed:getComputedStyle(nav).position==='fixed',bottomGap:window.innerHeight-dock.bottom,
     sideGap:Math.min(dock.left,viewport-dock.right),dockWidth:dock.width,
     searchWidth:form.querySelector('input').getBoundingClientRect().width,
     brandGap:field.left-brand.right,linksGap:dock.left-field.right,
     centerOffset:Math.abs(field.left+field.width/2-viewport/2),
     targets:[...nav.querySelectorAll('a')].map(link=>link.getBoundingClientRect().height),
     tabs:[...nav.querySelectorAll('[data-nav]')].map(link=>link.dataset.nav).join(','),
     scannerIcon:brandLink.querySelector('svg').getBoundingClientRect().width,
     brandWordmark:brandLink.querySelector('.brand-wordmark').getBoundingClientRect().width>0,
     brandTarget:Math.min(brand.width,brand.height),
     searchIcon:form.querySelector('button svg').getBoundingClientRect().width,
     navIcons:[...nav.querySelectorAll('a')].filter(link=>link.querySelector('svg')?.getBoundingClientRect().width>0)
      .map(link=>link.dataset.nav).join(',')};
   });
   const mobile=width<=750;
   if(layout.fixed!==mobile||layout.brandGap<0||layout.searchWidth<70||
      !layout.scannerIcon||!layout.searchIcon||layout.brandWordmark===mobile||
      layout.brandTarget<44||layout.targets.some(height=>height<44)||
      layout.navIcons!==(mobile?'browse,saved,new,profile':'browse,saved,profile')||
      (mobile&&(layout.bottomGap<10||layout.sideGap<10||layout.dockWidth>360||
       layout.tabs!=='browse,saved,new,profile'||
       layout.centerOffset>2))||
      (!mobile&&(layout.linksGap<0||layout.sideGap<0)))
    throw Error('Navigation overlaps or is misplaced at '+width+'px: '+JSON.stringify(layout));
   const navGrid=await navigation.evaluate(nav=>({
    grid:getComputedStyle(nav).display,
    labeledActions:[...nav.querySelectorAll('[data-nav]')].filter(link=>link.textContent.trim()).map(x=>x.dataset.nav),
    labeledIcons:[...nav.querySelectorAll('a:not(.market-sell)')].every(link=>link.hasAttribute('aria-label')&&!!link.querySelector('svg')),
    searchGrid:getComputedStyle(nav.parentElement.querySelector('.market-nav-search')).display
   }));
   if(navGrid.grid!=='grid'||navGrid.searchGrid!=='grid'||
      navGrid.labeledActions.join(',')!=='new'||!navGrid.labeledIcons)
    throw Error('Navigation must have accessible actions and compact grids: '+JSON.stringify(navGrid));
   await checkCardOverlays(page,width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('link',{name:'VINBOX scanner home',exact:true}).waitFor();
  const footerVisible=await navigation.evaluate(nav=>{
   window.scrollTo(0,document.documentElement.scrollHeight);
   return document.querySelector('.market-footer a').getBoundingClientRect().bottom< nav.getBoundingClientRect().top;
  });
  if(!footerVisible)throw Error('Floating navigation covers the footer link at the bottom of the page');
  await page.evaluate(()=>window.scrollTo(0,0));
  await search.fill('Electric');
  await page.getByText('1 sample',{exact:true}).waitFor();
  const priceChip=page.locator('.market-card:not([hidden]) .market-card-price-chip');
  if(await priceChip.innerText()!=='$23,500')throw Error('The photo must show the asking price');
  const saveIoniq=page.getByRole('button',{name:'Save 2022 Hyundai Ioniq 5 SEL',exact:true});
  await checkSaveBorder(saveIoniq,false,true);
  await saveIoniq.click();
  if(await saveIoniq.getAttribute('aria-pressed')!=='true'||!page.url().endsWith('#browse'))
   throw Error('Save on the card must save the car and keep Browse open');
  await checkSaveBorder(saveIoniq,true,true);
  await page.emulateMedia({colorScheme:'dark'});
  await checkSaveBorder(saveIoniq,true,true);
  await page.emulateMedia({colorScheme:'light'});
  await saveIoniq.click();
  await checkSaveBorder(saveIoniq,false,true);
  await page.getByRole('link',{name:'2022 Hyundai Ioniq 5 SEL',exact:true}).click();
  await page.getByText('Boonville, IN · Sample listing',{exact:true}).waitFor();
  if(!(await page.locator('#market-main > :first-child').evaluate(x=>x.matches('.market-detail-gallery'))))
   throw Error('The detail gallery must appear first');
  await page.waitForFunction(()=>document.querySelector('.market-detail-gallery img')?.naturalWidth>0);
  const summary=page.locator('.market-detail-header');
  if(!(await summary.locator('.market-detail-facts').innerText()).includes('Electric'))
   throw Error('Key facts should be visible near the asking price');
  await page.setViewportSize({width:1024,height:844});
  if(!await summary.evaluate(x=>{
   const gallery=x.previousElementSibling.getBoundingClientRect(),info=x.getBoundingClientRect();
   return gallery.right<info.left&&Math.abs(gallery.top-info.top)<2;
  }))throw Error('Desktop summary should sit next to the gallery');
  if(!await page.locator('.market-detail-seller').evaluate(x=>parseFloat(getComputedStyle(x).paddingInlineStart)>=12))
   throw Error('Seller information needs padding inside its border');
  await page.setViewportSize({width:390,height:844});
  await checkSaveBorder(saveIoniq,false);
  await saveIoniq.click();
  if(await saveIoniq.getAttribute('aria-pressed')!=='true')throw Error('Details did not save the car');
  await checkSaveBorder(saveIoniq,true);
  await page.emulateMedia({colorScheme:'dark'});
  await checkSaveBorder(saveIoniq,true,false,'rgb(110, 168, 255)');
  await page.emulateMedia({colorScheme:'light'});
  await page.getByText('Orchard Lane Auto',{exact:true}).waitFor();
  await page.getByText('Dealership',{exact:true}).waitFor();
  await page.locator('.market-seller-avatar').getByText('OL',{exact:true}).waitFor();
  if(await page.getByRole('link',{name:'Edit',exact:true}).count())throw Error('Sample listings must be read-only');
  await page.getByRole('link',{name:'Enlarge photo 1 of 3',exact:true}).click();
  await page.getByRole('heading',{name:'2022 Hyundai Ioniq 5 SEL photos'}).waitFor();
  await page.getByRole('button',{name:'Next photo',exact:true}).click();
  await page.getByText('2 / 3',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Back to listing'}).click();
  await page.getByText('2 / 3',{exact:true}).waitFor();
  await page.getByText('Fuel economy & range',{exact:true}).click();
  await page.getByText('303 mi',{exact:true}).waitFor();
  if(recallChecks)throw Error('Recalls should load only when opened');
  await page.getByText('Model recalls',{exact:true}).click();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Electrical system · FIXTURE',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Back to cars'}).click();
  await page.getByText('1 sample',{exact:true}).waitFor();
  if(await search.inputValue()!=='Electric')throw Error('Returning from a listing loses the active filter');
  const savedTab=navigation.getByRole('link',{name:'Saved',exact:true});
  await savedTab.click();
  await page.reload({waitUntil:'domcontentloaded'});
  const savedCar=page.getByRole('link',{name:'2022 Hyundai Ioniq 5 SEL',exact:true});
  await savedCar.waitFor();
  await checkCardOverlays(page,390);
  await checkSaveBorder(saveIoniq,true,true);
  await savedCar.click();
  await page.getByRole('link',{name:'Back to Saved'}).click();
  await savedCar.waitFor();
  await saveIoniq.click();
  await page.getByRole('heading',{name:'No saved cars'}).waitFor();
  await navigation.getByRole('link',{name:'Account and sign in',exact:true}).click();
  await page.getByLabel('Seller type').selectOption('dealership');
  await page.getByLabel('Dealership name').fill('Smoke Test Motors');
  await page.getByRole('heading',{name:'Account',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  await page.getByText('Accounts aren\'t available in this private preview.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.getByText('Profile saved on this device.',{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});
  if(await page.getByLabel('Dealership name').inputValue()!=='Smoke Test Motors')
   throw Error('Seller profile should stay available after reloading');

  await navigation.getByRole('link',{name:'Sell a car',exact:true}).click();
  const vinInput=page.getByRole('textbox',{name:'Vehicle identification number (VIN)'});
  await page.getByRole('heading',{name:'Scanned and saved vehicles'}).waitFor();
  if(!await vinInput.evaluate(input=>input.getBoundingClientRect().bottom<
   document.querySelector('.market-vin-history').getBoundingClientRect().top))
    throw Error('The VIN input should be above scanned and saved vehicles');
  const findVehicle=page.getByRole('button',{name:'Find vehicle',exact:true});
  await findVehicle.click();
  await page.getByText('Enter a 17-character VIN. VINs never use I, O, or Q.',{exact:true}).waitFor();
  await vinInput.fill(manualVin);
  await findVehicle.click();
  await page.getByRole('button',{name:/2003 Honda Accord EX/}).waitFor();
  await navigation.getByRole('link',{name:'Browse',exact:true}).click();
  await search.fill('no-matching-car');
  await page.getByRole('heading',{name:'No cars found'}).waitFor();
  await navigation.getByRole('link',{name:'Account and sign in',exact:true}).click();
  await page.locator('.market-account-listings').click();
  await page.getByRole('heading',{name:'No listings yet'}).waitFor();
  await search.fill('Ford');
  await search.press('Enter');
  await page.getByText('3 samples',{exact:true}).waitFor();

  await page.goto(new URL('#'+vin,base).href,{waitUntil:'domcontentloaded',timeout:40000});
  const scannerHome=page.getByRole('link',{name:'VIN Scanner, go to start',exact:true});
  await scannerHome.locator('svg').waitFor();
  const scannerWordmark=scannerHome.locator('.brand-wordmark');
  if(await scannerWordmark.isVisible())throw Error('The mobile scanner home link should show only the icon');
  await page.setViewportSize({width:1024,height:844});
  await scannerWordmark.waitFor({state:'visible'});
  await page.setViewportSize({width:390,height:844});
  const sell=page.locator('.card-actions button').filter({hasText:'Sell'}).first();
  await sell.waitFor({timeout:45000});
  const scannerSave=page.locator('.card-actions').getByRole('button',{name:'Save',exact:true});
  await checkSaveBorder(scannerSave,false);
  await scannerSave.click();
  const scannerSaved=page.locator('.card-actions').getByRole('button',{name:'Remove from saved',exact:true});
  await checkSaveBorder(scannerSaved,true);
  await sell.click();
  await page.waitForURL(/marketplace\.html#new/,{timeout:15000});
  if(await vinInput.inputValue()!==vin)throw Error('The scanner should fill the VIN field');
  await page.getByRole('button',{name:/2003 Honda Accord EX/}).waitFor();
  const transferred=page.locator('.market-vin-choice').filter({hasText:vin});
  if(await transferred.count()!==1)throw Error('A scanned and saved VIN should appear only once');
  if(!(await transferred.innerText()).includes('2016 Mercedes-Benz GLC300'))
   throw Error('Show the readable vehicle name next to its VIN');
  await transferred.click();
  await page.waitForURL(/marketplace\.html#new\//,{timeout:12000});
  if(await page.getByLabel('Dealership name').inputValue()!=='Smoke Test Motors')
   throw Error('New listings should use the saved seller profile');
  await page.locator('#m-price').fill('14900');
  await page.locator('#m-mileage').fill('92400');
  await page.locator('#m-place').fill('47715');
  await page.waitForFunction(()=>document.querySelector('#m-place')?.value==='Evansville, IN',null,{timeout:10000});
  const cityHint=await page.locator('.market-postal-hint').innerText();
  if(!cityHint.includes('47715'))throw Error('ZIP location was not automatically populated');
  await page.locator('#m-titleStatus').selectOption('rebuilt');
  await page.locator('#m-condition').selectOption('good');
  await page.locator('#m-lienStatus').selectOption('yes');
  await page.locator('#m-issuesStatus').selectOption('listed');
  await page.getByLabel('Describe the known issues').fill('Rear bumper scratch.');
  await page.getByLabel('Seller type').selectOption('dealership');
  await page.getByLabel('Dealership name').fill('Smoke Test Motors');
  await page.getByText('Add more details (optional)',{exact:true}).click();
  await page.getByLabel('Exterior color').fill('Silver');
  await page.getByLabel('Stock number').fill('ST-123');
  await page.getByLabel('Dealer fees added to asking price (USD)').fill('199.99');
  await page.getByLabel('Recent maintenance').fill('Brake pads replaced at 90,000 miles.');
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
  await page.getByText('Photo or logo saved.',{exact:true}).waitFor();
  const draftUrl=page.url();
  await page.getByRole('link',{name:'Back to vehicles'}).click();
  await page.getByRole('heading',{name:'Your vehicles',exact:true}).waitFor();
  if(await transferred.count()!==1||!(await transferred.innerText()).includes('Continue draft'))
   throw Error('A vehicle present in both drafts and saved VINs must have one Continue draft row');
  await page.evaluate(()=>{
   sessionStorage.clear();
   localStorage.removeItem('vin-history');
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await transferred.getByText('Continue draft',{exact:true}).waitFor();
  await vinInput.fill(vin);
  await findVehicle.click();
  await page.getByText('Draft found. Continue below.',{exact:true}).waitFor();
  await transferred.click();
  await page.waitForURL(draftUrl);
  if(await page.locator('#m-price').inputValue()!=='14900'||await page.locator('#m-place').inputValue()!=='Evansville, IN')
   throw Error('Resuming a draft must keep the saved form values');
  await page.locator('.market-thumb img').nth(3).waitFor({timeout:15000});
  await navigation.getByRole('link',{name:'Account and sign in',exact:true}).click();
  await page.locator('.market-account-listings').click();
  const continueDraft=page.getByRole('link',{name:'Continue draft',exact:true});
  await continueDraft.first().waitFor();
  if(await continueDraft.count()!==1)throw Error('Continuing from Sell must reuse the same draft');
  await continueDraft.click();
  await page.locator('#m-price').waitFor();
  await page.getByRole('button',{name:'Preview listing'}).click();
  await page.waitForURL(/marketplace\.html#car\//,{timeout:12000});
  await page.getByText('$14,900').first().waitFor({timeout:12000});
  await page.getByText('Smoke Test Motors',{exact:true}).waitFor();
  await page.locator('.market-detail-vin').getByText(vin,{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.market-seller-avatar img')?.naturalWidth>0);
  // The unified summary lists vehicle facts together; liens and issues remain below.
  const facts=page.locator('.market-detail-facts');
  await facts.getByText('Rebuilt',{exact:true}).waitFor();
  if(!(await facts.innerText()).includes('Good')||!(await facts.innerText()).includes('Transmission')||
     (await facts.innerText()).includes('Not provided'))
    throw Error('Expected title, condition, body, and trim in the vehicle facts component');
  await page.getByRole('heading',{name:'Disclosures'}).waitFor();
  if(!(await page.locator('.market-detail-disclosures').innerText()).includes('Lien on vehicle'))
    throw Error('Expected lien disclosure below the summary');
  await page.getByText('Rear bumper scratch.',{exact:false}).waitFor();
  await page.getByText('Brake pads replaced at 90,000 miles.',{exact:true}).waitFor();
  await page.getByText('ST-123',{exact:true}).waitFor();
  await page.getByText('Price breakdown',{exact:true}).click();
  await page.getByText('$15,099.99',{exact:true}).waitFor();
  const more=page.locator('details').filter({has:page.getByText('Vehicle specifications',{exact:true})});
  if(await more.evaluate(node=>node.open))throw Error('Specifications should start collapsed');
  await more.locator('summary').click();
  await page.getByText('Silver',{exact:true}).waitFor();
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
  const related=page.locator('.market-similar');
  await related.getByRole('heading',{name:'Similar cars'}).waitFor();
  const relatedCards=related.locator('.market-card');
  const relatedCount=await relatedCards.count();
  if(relatedCount<1||relatedCount>4)throw Error('Expected one to four relevant listing cards');
  for(const [width,columns] of [[390,2],[1024,4]]){
   await page.setViewportSize({width,height:844});
   const layout=await related.locator('.market-similar-cards').evaluate(grid=>({
    columns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
    overflow:grid.scrollWidth>grid.clientWidth+1
   }));
   if(layout.columns!==columns||layout.overflow)
    throw Error('Similar cars layout failed at '+width+'px: '+JSON.stringify(layout));
  }
  const originalUrl=page.url();
  await relatedCards.first().locator('.market-card-title a').click();
  await page.waitForURL(/marketplace\.html#car\//,{timeout:12000});
  if(page.url()===originalUrl)throw Error('Similar car must open its own details');
  await page.goBack({waitUntil:'domcontentloaded'});
  await page.waitForURL(originalUrl,{timeout:12000});
  await page.locator('nav').getByRole('link',{name:'Account and sign in',exact:true}).click();
  await page.locator('.market-account-listings').click();
  await page.getByRole('button',{name:'Mark sold'}).click();
  await page.getByText('Sold').first().waitFor();
  const active=await page.locator('.market-vehicle-summary').count();
  if(active!==1)throw Error('Expected one persisted local listing, got '+active);
  await page.getByRole('link',{name:'View preview'}).click();
  await page.getByText('Evansville, IN · Sold',{exact:true}).waitFor();
  await page.getByText('Rear bumper scratch.',{exact:false}).waitFor();
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));

  await page.getByRole('link',{name:'Browse',exact:true}).click();
  await page.locator('.market-card').nth(9).waitFor({timeout:12000});
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
