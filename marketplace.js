/* VINBOX Cars — safe device-local marketplace pilot.
   Public publication and buyer messaging are intentionally unavailable until
   a dedicated authenticated backend is provisioned and verified. */
(function(){
'use strict';
const C=window.VinboxMarketCore;
const main=document.getElementById('market-main');
const status=document.getElementById('market-status');
const TRANSFER='vinbox-sell-vehicle-v1';
const postalCache=new Map();
async function lookupPostal(zip,signal){
 if(!C.postalCode(zip))return null;
 if(postalCache.has(zip))return postalCache.get(zip);
 const response=await fetch('/api/postal/us/'+zip,{signal,headers:{Accept:'application/json'}});
 if(response.status===404)return null;
 if(!response.ok)throw Error('ZIP lookup is temporarily unavailable.');
 const result=C.postalPlace(zip,await response.json());
 if(result)postalCache.set(zip,result);
 return result;
}

let listings=C.read(localStorage),current=null,photoUrls=[],renderEpoch=0,statusTimeout;
const $=s=>document.querySelector(s);
const uuid=()=>crypto.randomUUID();
const node=(tag,attrs={},...kids)=>{
 const el=document.createElement(tag);
 for(const [k,v] of Object.entries(attrs)){
  if(k==='class')el.className=v;
  else if(k==='text')el.textContent=v;
  else if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2),v);
  else if(k==='value')el.value=v;
  else if(k==='checked')el.checked=!!v;
  else if(v!==null&&v!==undefined&&v!==false)el.setAttribute(k,String(v));
 }
 for(const x of kids.flat(Infinity))if(x!=null&&x!==false)el.append(x.nodeType?x:document.createTextNode(String(x)));
 return el;
};
const el=(tag,attrs,...kids)=>node(tag,attrs,...kids);
const msg=s=>{
 status.textContent=s;status.dataset.on='true';
 clearTimeout(statusTimeout);statusTimeout=setTimeout(()=>status.dataset.on='false',3600);
};
const urlFor=id=>'#car/'+encodeURIComponent(id);
const link=(label,href,klass='market-secondary')=>el('a',{href,class:klass},label);
const info=title=>el('p',{class:'market-note'},title);
const arrow=()=>document.createTextNode(' →');
function persist(){
 try{C.write(localStorage,listings);return true}
 catch(e){msg('Local storage is full or disabled. Changes may not persist.');return false}
}
function route(){let r=decodeURIComponent(location.hash.slice(1)||'browse');return r.startsWith('car/')?['detail',r.slice(4)]:r.startsWith('edit/')?['edit',r.slice(5)]:r==='new'?['new']:r==='mine'?['mine']:['browse']}
function selectNav(key){
 document.querySelectorAll('[data-nav]').forEach(a=>{
  if(a.dataset.nav===(key==='detail'?'browse':key==='edit'?'mine':key)){
   a.setAttribute('aria-current','page');
  }else a.removeAttribute('aria-current');
 });
}
function cleanupImages(){
 for(const href of photoUrls)URL.revokeObjectURL(href);
 photoUrls=[];renderEpoch++;
}
let dbPromise=null;
function photoDB(){
 if(!('indexedDB' in window))return Promise.reject(Error('Photo storage is unavailable in this browser.'));
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('vinbox-marketplace-photos',1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos')};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Unable to open photo storage.'));
 }).catch(err=>{dbPromise=null;throw err});
 return dbPromise;
}
async function photoOp(kind,id,blob){
 const db=await photoDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('photos',kind==='get'?'readonly':'readwrite');
  const store=tx.objectStore('photos');
  const req=kind==='put'?store.put(blob,id):kind==='delete'?store.delete(id):store.get(id);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Photo storage failed.'));
  tx.onabort=()=>reject(tx.error||Error('Photo storage was interrupted.'));
 });
}
function photoSlot(id,cls='market-photo',index=0){
 const box=el('div',{class:cls},el('span',{class:'market-photo-placeholder'},'Photo unavailable'));
 const expected=renderEpoch;
 photoOp('get',id).then(blob=>{
  if(!blob||!box.isConnected||expected!==renderEpoch)return;
  const src=URL.createObjectURL(blob);photoUrls.push(src);
  // Keep editor removal buttons and carousel controls when the image loads.
  const placeholder=box.querySelector('.market-photo-placeholder');
  const img=el('img',{src,alt:'Vehicle photo '+(index+1),loading:index?'lazy':'eager',decoding:'async'});
  if(placeholder)placeholder.replaceWith(img);
  else box.prepend(img);
 }).catch(()=>{});
 return box;
}
function photoCarousel(record,mode='card'){
 const ids=record.photoIds||[];
 const compact=mode==='card',count=ids.length;
 const viewport=el('div',{class:'market-carousel-view',tabindex:count>1?'0':null,
    role:'region','aria-roledescription':'carousel',
    'aria-label':(compact?'Photos of ':'Photos for ')+C.displayTitle(record)});
 const track=el('div',{class:'market-carousel-track'});
 if(count){
  ids.forEach((id,i)=>{
   const picture=photoSlot(id,'market-photo',i);
   track.append(compact?el('a',{class:'market-carousel-slide',href:urlFor(record.id),
     'aria-label':'View '+C.displayTitle(record)+' photo '+(i+1)+' of '+count},picture):
     el('div',{class:'market-carousel-slide'},picture));
  });
 }else track.append(el('div',{class:'market-carousel-slide'},el('div',{class:'market-photo'},
   el('span',{class:'market-photo-placeholder'},'No vehicle photos'))));
 viewport.append(track);
 if(count>1){
  let current=0;
  const counter=el('span',{class:'market-carousel-count','aria-hidden':'true'},'1 / '+count);
  const update=()=>{
   const width=track.clientWidth;
   if(!width)return;
   current=Math.min(count-1,Math.max(0,Math.round(track.scrollLeft/width)));
   counter.textContent=(current+1)+' / '+count;
   previous.disabled=current===0;next.disabled=current===count-1;
  };
  const go=delta=>{
   current=Math.max(0,Math.min(count-1,current+delta));
   track.scrollTo({left:current*track.clientWidth,
     behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
   update();
  };
  const previous=el('button',{class:'market-carousel-arrow market-carousel-prev',type:'button',
    'aria-label':'Previous photo',onclick:()=>go(-1)},'‹');
  const next=el('button',{class:'market-carousel-arrow market-carousel-next',type:'button',
    'aria-label':'Next photo',onclick:()=>go(1)},'›');
  previous.disabled=true;
  track.addEventListener('scroll',update,{passive:true});
  viewport.addEventListener('keydown',event=>{
   if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
    event.preventDefault();go(event.key==='ArrowLeft'?-1:1);
   }
  });
  viewport.append(previous,next,counter);
 }
 return viewport;
}
async function processImage(file){
 if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type)||file.size>12*1024*1024)
  throw Error('Use a JPEG, PNG, WebP or supported phone photo under 12 MB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})}
 catch{bitmap=await createImageBitmap(file)}
 try{
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('This device cannot process photos.');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const jpg=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Photo conversion failed.')),'image/jpeg',.78));
  return jpg;
 }finally{bitmap.close?.()}
}
function currentList(){return listings.filter(x=>x.status!=='draft')}
function fromScanner(){
 try{
  const str=sessionStorage.getItem(TRANSFER);
  if(!str)return null;
  const v=C.pickVehicle(JSON.parse(str));
  sessionStorage.removeItem(TRANSFER);
  return v;
 }catch{return null}
}
function savedVehicles(){
 try{const records=JSON.parse(localStorage.getItem('vin-history')||'[]');
  return Array.isArray(records)?records.map(C.pickVehicle).filter(Boolean):[]}
 catch{return []}
}
function newRecord(vehicle){
 if(listings.length>=C.MAX_DRAFTS){
  msg('30 listing limit. Delete an older draft before creating another.');
  return null;
 }
 const r=C.fresh(vehicle);r.id=uuid();listings.unshift(r);
 if(!persist()){listings.shift();msg('Browser storage is required to save a listing.');return null}
 return r;
}
function heading(title,desc,action=null){
 const left=el('div',{},el('h1',{text:title}),desc?el('p',{class:'market-subtitle',text:desc}):null);
 return el('div',{class:'market-intro'},left,action);
}
function empty(title,description,action){
 return el('section',{class:'market-empty'},el('h2',{text:title}),el('p',{text:description}),action);
}
function card(r){
 const photoLink=el('div',{class:'market-card-photo-link'},
  photoCarousel(r,'card'),el('span',{class:'market-local-tag'},r.status==='sold'?'Sold':'Private preview'));
 const meta=[C.mileage(r.mileage),r.vehicle.drive||'',r.vehicle.transmission||''].filter(Boolean).join(' · ');
 return el('article',{class:'market-card','data-search':(C.displayTitle(r)+' '+r.place).toLowerCase()},
  photoLink,el('div',{class:'market-card-title'},el('a',{href:urlFor(r.id)},C.displayTitle(r))),
  el('p',{class:'market-card-meta',text:meta}),
  el('p',{class:'market-card-meta',text:r.place}),
  el('p',{class:'market-card-price',text:C.money(r.price)}));
}
function renderBrowse(){
 const items=currentList();
 main.append(heading('Cars','Browse the photo-first listing experience.',link('Sell your car','#new','market-primary')));
 main.append(info('Private preview: listings shown here exist only on this device. They are not public ads and buyers cannot contact sellers yet.'));
 if(!items.length){main.append(empty('No listing previews yet','Decode a VIN and create the first private vehicle listing.',link('Scan a VIN','./','market-primary')));return}
 const search=el('input',{type:'search',class:'market-search',placeholder:'Search cars or locations','aria-label':'Search local listing previews'});
 const count=el('span',{class:'market-muted',text:items.length+' local preview'+(items.length!==1?'s':'')});
 const grid=el('div',{class:'market-cards'},items.map(card));
 search.addEventListener('input',()=>{
  let visible=0;for(const item of grid.children){
   item.hidden=!item.dataset.search.includes(search.value.trim().toLowerCase());if(!item.hidden)visible++;
  }
  count.textContent=visible+' local preview'+(visible!==1?'s':'');
 });
 main.append(el('div',{class:'market-toolbar'},search,count),grid);
}
function renderMine(){
 main.append(heading('My listings','Your drafts and previews are stored on this device.',link('New listing','#new','market-primary')));
 main.append(info('Drafts and photos are local to this browser. Backing up decoded VINs does not back up these listing drafts or photos. Do not clear site data if you need them.'));
 if(!listings.length){main.append(empty('No listings yet','Start from a saved or scanned VIN. VINBOX will fill in the vehicle details.',link('Scan a VIN','./','market-primary')));return}
 const stack=el('div',{class:'market-stacked'});
 for(const r of listings){
  const actions=el('div',{class:'market-manage'},link('Edit','#edit/'+r.id),
   r.status==='draft'?null:link('View preview',urlFor(r.id)));
  if(r.status==='preview'){
   actions.append(el('button',{class:'market-secondary',onclick:()=>{r.status='sold';r.updatedAt=new Date().toISOString();persist();render();}},'Mark sold'));
  }
  if(r.status==='sold')actions.append(el('button',{class:'market-secondary',onclick:()=>{r.status='preview';persist();render();}},'Mark available'));
  const remove=el('button',{class:'market-plain'},'Delete');
  remove.addEventListener('click',()=>{
   remove.replaceWith(el('span',{class:'market-muted'},'Delete this local listing? '),
     el('button',{class:'market-secondary',onclick:async()=>{
      listings=listings.filter(x=>x.id!==r.id);persist();
      for(const pid of r.photoIds)photoOp('delete',pid).catch(()=>{});
      render();
     }},'Confirm delete'),
     el('button',{class:'market-plain',onclick:()=>render()},'Cancel'));
  });
  stack.append(el('section',{class:'market-vehicle-summary'},
   el('strong',{},C.displayTitle(r)),el('span',{},r.status==='draft'?'Draft':r.status==='sold'?'Sold · Local preview':'Ready · Local preview',
    ' · ',C.money(r.price)),actions,remove));
 }
 main.append(stack);
}
function renderNew(){
 const transferred=fromScanner();
 if(transferred)current=newRecord(transferred);
 if(current&&!listings.some(x=>x.id===current.id))current=null;
 if(!current){
  const existing=savedVehicles();
  main.append(heading('Sell your car','Start with a VIN you already decoded.'));
  if(existing.length){
   const box=el('div',{class:'market-stacked'});
   for(const v of existing.slice(0,25))box.append(el('button',{class:'market-secondary',onclick:()=>{current=newRecord(v);render()}},v.title||[v.year,v.make,v.model].join(' ')));
   main.append(box,el('p',{class:'market-muted'},'Choose a saved vehicle to prefill its listing.'));
  }else main.append(empty('Start with your VIN','Decode your vehicle first. Its year, make, model, trim and specifications will be carried into the listing.',link('Scan or enter VIN','./','market-primary')));
  return;
 }
 renderEditor(current);
}
function makeInput(record,key,label,placeholder,kind='text',required=true){
 const input=el('input',{type:kind,id:'m-'+key,placeholder,value:record[key]||'',
   autocomplete:'off',required:required?'required':null});
 const error=el('small',{id:'err-'+key,'aria-live':'polite'});
 input.addEventListener('input',()=>{
  record[key]=input.value;record.updatedAt=new Date().toISOString();
  error.textContent='';input.removeAttribute('aria-invalid');
  persist();
 });
 return el('div',{class:'market-field'},el('label',{for:'m-'+key},label),input,error);
}
function postalField(record){
 const field=makeInput(record,'place','Location','ZIP code or city, state');
 const input=field.querySelector('input');
 const hint=el('span',{class:'market-postal-hint',role:'status','aria-live':'polite'});
 field.append(hint);
 let token=0,timer=null,controller=null,inflight=null,inflightZip='';
 const resolve=async()=>{
  const zip=C.postalCode(input.value);
  if(!zip)return;
  if(inflight&&inflightZip===zip)return inflight;
  clearTimeout(timer);
  controller?.abort();const request=new AbortController();controller=request;
  const mine=++token;
  inflightZip=zip;
  hint.textContent='Finding city…';
  const timeout=setTimeout(()=>request.abort(),6000);
  const job=(async()=>{
   try{
    const result=await lookupPostal(zip,request.signal);
    if(mine!==token||!input.isConnected||input.value.trim()!==zip)return;
    if(!result){hint.textContent='ZIP not found. Enter your city or town instead.';return;}
    input.value=result.place;
    record.place=result.place;
    record.postalCode=zip;
    record.updatedAt=new Date().toISOString();
    persist();
    field.querySelector('#err-place').textContent='';
    input.removeAttribute('aria-invalid');
    hint.textContent=result.alternatives.length?
      'Suggested for '+zip+'. If your town differs, edit the city above.':
      'Filled from ZIP '+zip+'. You can edit the city.';
   }catch(err){
    if(mine===token&&input.value.trim()===zip)
     hint.textContent='City lookup unavailable. Enter the city or town instead.';
   }finally{
    clearTimeout(timeout);
    if(mine===token){inflight=null;inflightZip='';}
   }
  })();
  inflight=job;
  return job;
 };
 input.addEventListener('input',()=>{
  token++;controller?.abort();clearTimeout(timer);inflight=null;inflightZip='';
  record.postalCode='';
  hint.textContent='';
  if(C.postalCode(input.value))timer=setTimeout(()=>void resolve(),220);
 });
 input.addEventListener('blur',()=>{if(C.postalCode(input.value))void resolve();});
 if(C.postalCode(record.place))queueMicrotask(()=>{if(input.isConnected)void resolve();});
 else if(C.postalCode(record.postalCode))hint.textContent='Filled from ZIP '+record.postalCode+'. You can edit the city.';
 return {field,resolve};
}
function fieldSelect(record,key,label,options){
 const control=el('select',{id:'m-'+key,'aria-label':label},
  el('option',{value:''},'Choose one'),options.map(([v,name])=>el('option',{value:v},name)));
 control.value=record[key]||'';
 control.addEventListener('change',()=>{record[key]=control.value;record.updatedAt=new Date().toISOString();persist();});
 return el('div',{class:'market-field'},el('label',{for:'m-'+key},label),control,el('small',{id:'err-'+key,'aria-live':'polite'}));
}
function photoControl(record){
 const group=el('div',{class:'market-field'},el('span',{class:'field-label'},'Vehicle photos'),
  el('p',{class:'market-muted'},'Add up to 12 current photos. Swipe to review them; the first is the cover. Photo metadata is removed.'));
 const gallery=el('div',{class:'market-photos',tabindex:'0',role:'region','aria-label':'Uploaded vehicle photos, scroll horizontally'});
 for(const [i,id] of record.photoIds.entries()){
  const holder=photoSlot(id,'market-thumb',i);
  holder.append(el('button',{type:'button','aria-label':'Remove photo '+(i+1),onclick:async()=>{
   record.photoIds=record.photoIds.filter(x=>x!==id);persist();
   try{await photoOp('delete',id)}catch(e){msg('Photo could not be deleted from device storage.')}
   render();
  }},'×'));
  gallery.append(holder);
 }
 if(record.photoIds.length<C.MAX_PHOTOS){
  const input=el('input',{type:'file',accept:'image/jpeg,image/png,image/webp,image/heic,image/heif',multiple:true,hidden:true});
  const tile=el('label',{class:'market-addphoto'},'+ Add photos',input);
  input.addEventListener('change',async()=>{
   const files=[...input.files];tile.textContent='Processing…';
   const capacity=C.MAX_PHOTOS-record.photoIds.length;
   for(const file of files.slice(0,capacity)){
    try{
     const blob=await processImage(file),id=uuid();
     await photoOp('put',id,blob);
     record.photoIds.push(id);persist();
    }catch(e){msg(e.message||'Could not store this photo.');}
   }
   render();
  });
  gallery.append(tile);
 }
 group.append(gallery,el('small',{id:'err-photos','aria-live':'polite'}));
 return group;
}
function renderEditor(r){
 main.append(el('a',{href:'#mine',class:'market-back'},'← My listings'));
 main.append(heading(r.status==='draft'?'Sell your vehicle':'Edit your listing','VIN details are already filled in. Add only what the VIN cannot know.'));
 main.append(el('div',{class:'market-vehicle-summary'},el('strong',{},C.displayTitle(r)),
  el('span',{},[r.vehicle.body,r.vehicle.engine?r.vehicle.engine+'L':'',r.vehicle.drive,r.vehicle.fuel].filter(Boolean).join(' · '))));
 main.append(info('Private draft only. Public publishing and secure buyer messages will be enabled after the dedicated marketplace backend is configured.'));
 const form=el('form',{class:'market-form',novalidate:true});
 const postal=postalField(r);
 form.append(photoControl(r),
  el('div',{class:'market-fields-two'},
   makeInput(r,'price','Asking price (USD)','e.g. 14900','text'),
   makeInput(r,'mileage','Mileage','e.g. 92400','text')),
  postal.field,
  el('div',{class:'market-fields-two'},
   fieldSelect(r,'titleStatus','Title status',[['clean','Clean'],['lien','Lien / financing'],['salvage','Salvage'],['rebuilt','Rebuilt'],['unknown','Not sure']]),
   fieldSelect(r,'condition','Condition',[['excellent','Excellent'],['good','Good'],['fair','Fair'],['needs-work','Needs work']])));
 const optional=el('details',{class:'market-optional'},el('summary',{},'Additional information (optional)'),
  el('p',{},'Describe known problems, recent maintenance, or anything a buyer should know.'));
 for(const [key,label,max] of [['knownIssues','Known issues',1200],['description','About this vehicle',3000]]){
  const input=el('textarea',{id:'m-'+key,maxlength:max,placeholder:key==='knownIssues'?'Disclose issues you know about.':'Add service history, modifications, or other useful information.'});
  input.value=r[key]||'';
  input.addEventListener('input',()=>{r[key]=input.value;r.updatedAt=new Date().toISOString();persist();});
  optional.append(el('div',{class:'market-field'},el('label',{for:'m-'+key},label),input));
 }
 form.append(optional);
 const permission=el('input',{type:'checkbox',id:'m-authorized',checked:r.authorized});
 permission.addEventListener('change',()=>{r.authorized=permission.checked;persist();});
 form.append(el('label',{class:'market-check'},permission,
  el('span',{},'I am the owner or authorized to sell this vehicle. The photos and disclosures are accurate to the best of my knowledge.')),
  el('small',{id:'err-authorized','aria-live':'polite',class:'market-muted'}));
 const errors=el('p',{class:'market-alert',hidden:true,role:'alert'});
 const actions=el('div',{class:'market-actions'},
  el('button',{type:'submit',class:'market-primary'},'Preview listing'),
  link('My listings','#mine','market-secondary'),
  el('span',{class:'market-muted'},'Changes saved on this device'));
 form.append(errors,actions);
 form.addEventListener('submit',async evt=>{
  evt.preventDefault();
  // Do not allow a ZIP still being resolved to become an invalid public place.
  await postal.resolve();
  const result=C.validate(r);
  form.querySelectorAll('[id^="err-"]').forEach(x=>x.textContent='');
  form.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));
  if(!result.valid){
   errors.hidden=false;errors.textContent='Finish the highlighted details to preview your listing.';
   for(const [key,value] of Object.entries(result.errors)){
    const target=form.querySelector('#err-'+key);if(target)target.textContent=value;
    const control=form.querySelector('#m-'+key);if(control)control.setAttribute('aria-invalid','true');
   }
   const first=form.querySelector('[aria-invalid="true"]')||form.querySelector('#err-photos');
   first?.focus?.();
   return;
  }
  if(!persist()){errors.hidden=false;errors.textContent='Storage failed. Resolve that before previewing.';return;}
  r.status='preview';r.updatedAt=new Date().toISOString();persist();
  current=null;location.hash=urlFor(r.id);msg('Private listing preview ready.');
 });
 main.append(el('div',{class:'market-editor'},form));
}
function dlItem(name,value){return el('div',{},el('dt',{},name),el('dd',{},value||'Not specified'))}
function detail(r){
 main.append(el('a',{href:'#browse',class:'market-back'},'← Back to cars'));
 main.append(el('div',{class:'market-detail-header'},
  el('div',{},el('h1',{class:'market-heading'},C.displayTitle(r)),el('p',{class:'market-subtitle'},r.place+' · Private listing preview')),
  el('div',{class:'market-manage'},link('Edit','#edit/'+r.id))));
 main.append(el('div',{class:'market-detail-gallery'},photoCarousel(r,'detail')));
 const left=el('div',{},
  el('div',{class:'market-detail-section'},el('h2',{},'Vehicle overview'),
   el('div',{class:'market-dl'},dlItem('Mileage',C.mileage(r.mileage)),dlItem('Transmission',r.vehicle.transmission),
    dlItem('Drive',r.vehicle.drive),dlItem('Fuel',r.vehicle.fuel),dlItem('Engine',r.vehicle.engine?r.vehicle.engine+' L':'Not specified'),
    dlItem('Body',r.vehicle.body))),
  el('div',{class:'market-detail-section'},el('h2',{},'Condition and title'),
   el('div',{class:'market-dl'},dlItem('Title status',r.titleStatus?'Seller reports '+r.titleStatus:'Not disclosed'),dlItem('Condition',r.condition?'Seller reports '+r.condition:'Not disclosed')),
   el('p',{class:'market-muted'},'All condition and title claims are seller-provided, not verified by VIN decoding.')),
  el('div',{class:'market-detail-section'},el('h2',{},'Seller details'),
   el('p',{},r.description||'No additional description provided.'),
   r.knownIssues?el('p',{},'Known issues: '+r.knownIssues):null),
  el('div',{class:'market-detail-section'},el('h2',{},'About the VIN data'),
   el('p',{class:'market-muted'},'Year, make, model, and factory specifications were decoded from NHTSA. This does not establish ownership, accident history, odometer accuracy, or title condition.'),
   dlItem('VIN','Ending in '+r.vehicle.vin.slice(-4))));
 const aside=el('aside',{class:'market-aside'},el('strong',{},C.money(r.price)),
  el('span',{class:'market-muted'},C.mileage(r.mileage)+' · '+r.place),
  el('button',{class:'market-primary',onclick:()=>{
   msg('Buyer messaging is not active in this private preview. No seller has been contacted.');
  }},'Contact seller'),
  el('p',{class:'market-muted'},'Buyer messaging starts when the public marketplace backend is connected. No phone numbers are shown.'));
 main.append(el('div',{class:'market-detail-layout'},left,aside));
 main.append(el('div',{class:'market-mobile-contact'},
  el('strong',{},C.money(r.price)),
  el('button',{class:'market-primary',onclick:()=>msg('Buyer messaging is not active in this private preview.')},'Contact seller')));
}
function render(){
 cleanupImages();
 const [screen,id]=route();selectNav(screen);
 main.replaceChildren();
 if(screen==='browse')renderBrowse();
 else if(screen==='mine')renderMine();
 else if(screen==='new'){renderNew()}
 else if(screen==='edit'){
  const r=listings.find(x=>x.id===id);
  if(!r){main.append(empty('Listing not found','This listing may have been deleted from this device.',link('My listings','#mine')));return}
  current=r;renderEditor(r);
 }else if(screen==='detail'){
  const r=listings.find(x=>x.id===id);
  if(!r){main.append(empty('Listing not found','Only listings stored on this device are available.',link('Browse','#browse')));return}
  detail(r);
 }
 document.title=(screen==='browse'?'Cars':screen==='mine'?'My listings':screen==='detail'?'Vehicle details':'Sell your car')+' · VINBOX';
}
window.addEventListener('hashchange',()=>{if(route()[0]!=='new')current=null;render();window.scrollTo({top:0,behavior:'instant'})});
window.addEventListener('pagehide',cleanupImages);
render();
})();
