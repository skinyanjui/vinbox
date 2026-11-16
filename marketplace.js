/* VINBOX Cars — safe device-local marketplace pilot.
   Public publication and buyer messaging are intentionally unavailable until
   a dedicated authenticated backend is provisioned and verified. */
(function(){
'use strict';
const C=window.VinboxMarketCore;
const samples=window.VinboxMarketSamples;
const main=document.getElementById('market-main');
const status=document.getElementById('market-status');
const searchForm=document.getElementById('market-search');
const search=searchForm.querySelector('input');
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
let activeScreen,browseScroll=0,filterBrowse=null;
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
  tx.oncomplete=()=>resolve(req.result);
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
function showStoredPhoto(box,id,show){
 const expected=renderEpoch;
 void photoOp('get',id).then(blob=>{
  if(!blob||!box.isConnected||expected!==renderEpoch)return;
  const src=URL.createObjectURL(blob);photoUrls.push(src);
  show(src);
 }).catch(()=>{});
}
function photoSlot(id,cls='market-photo',index=0,sample=false,lazy=false){
 const box=el('div',{class:cls},el('span',{class:'market-photo-placeholder'},'Photo unavailable'));
 const show=src=>{
  const placeholder=box.querySelector('.market-photo-placeholder');
  const img=el('img',{src,alt:(sample?'Illustrative vehicle photo ':'Vehicle photo ')+(index+1),
   loading:lazy||index?'lazy':'eager',decoding:'async',
   onerror:()=>{if(placeholder)img.replaceWith(placeholder);}});
  if(placeholder)placeholder.replaceWith(img);
  else box.prepend(img);
 };
 if(sample)show(id);
 else showStoredPhoto(box,id,show);
 return box;
}
function photoCarousel(record,mode='card'){
 const ids=record.photoSources||record.photoIds||[];
 const compact=mode==='card',count=ids.length;
 const viewport=el('div',{class:'market-carousel-view',tabindex:count>1?'0':null,
    role:'region','aria-roledescription':'carousel',
    'aria-label':(compact?'Photos of ':'Photos for ')+C.displayTitle(record)});
 const track=el('div',{class:'market-carousel-track'});
 if(count){
  ids.forEach((id,i)=>{
   const picture=photoSlot(id,'market-photo',i,record.sample,record.sample&&compact);
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
async function processImage(file,maxSize=1600){
 if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type)||file.size>12*1024*1024)
  throw Error('Use a JPEG, PNG, WebP or supported phone photo under 12 MB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})}
 catch{bitmap=await createImageBitmap(file)}
 try{
  const scale=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));
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
 const badge=r.sample?'Sample':r.status==='sold'?'Sold':'';
 const photoLink=el('div',{class:'market-card-photo-link'},
  photoCarousel(r,'card'),badge?el('span',{class:'market-local-tag'},badge):null);
 const reported=r.titleStatus&&r.titleStatus!=='unknown'?
  'Title: '+C.titleStatusLabel(r.titleStatus)+' (reported)':'';
 const searchText=[C.displayTitle(r),r.place,r.vehicle.body,r.vehicle.fuel,r.sellerName,
  C.titleStatusLabel(r.titleStatus)].filter(Boolean).join(' ').toLowerCase();
 return el('article',{class:'market-card','data-search':searchText},
  photoLink,
  el('div',{class:'market-card-title'},el('a',{href:urlFor(r.id)},C.displayTitle(r))),
  el('p',{class:'market-card-meta',text:C.mileage(r.mileage)+' · '+r.place}),
  reported?el('p',{class:'market-card-meta market-card-disclosure',text:reported}):null,
  el('p',{class:'market-card-price',text:C.money(r.price)}));
}
function renderBrowse(){
 main.append(el('h1',{class:'market-visually-hidden'},'Cars'));
 const items=[...currentList(),...samples];
 const count=el('span',{class:'market-muted market-count',role:'status'});
 const grid=el('div',{class:'market-cards'},items.map(card));
 const noResults=empty('No matching vehicles','Try another vehicle, seller or location.');
 filterBrowse=()=>{
  let localCount=0,sampleCount=0;
  const query=search.value.trim().toLowerCase();
  items.forEach((record,index)=>{
   const item=grid.children[index];
   item.hidden=!item.dataset.search.includes(query);
   if(item.hidden)return;
   if(record.sample)sampleCount++;
   else localCount++;
  });
  noResults.hidden=localCount+sampleCount>0;
  count.textContent=[
   localCount?localCount+' on this device · Not public':'',
   sampleCount?sampleCount+(sampleCount===1?' sample':' samples'):''
  ].filter(Boolean).join(' · ');
 };
 filterBrowse();
 main.append(count,grid,noResults);
}
function renderMine(){
 main.append(el('h1',{class:'market-visually-hidden'},'My listings'));
 // The navigation already names this page and includes the Sell action.
 main.append(el('p',{class:'market-storage-note'},
  'Saved on this device only. Backing up decoded VINs does not back up these listing drafts or photos.'));
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
      const previous=listings;
      listings=listings.filter(x=>x.id!==r.id);
      if(!persist()){listings=previous;return;}
      for(const pid of [...r.photoIds,r.sellerAvatarId].filter(Boolean))photoOp('delete',pid).catch(()=>{});
      render();
     }},'Confirm delete'),
     el('button',{class:'market-plain',onclick:()=>render()},'Cancel'));
  });
  stack.append(el('section',{class:'market-vehicle-summary'},
   el('strong',{},C.displayTitle(r)),el('span',{},r.status==='draft'?'Draft':r.status==='sold'?'Sold':'Preview',
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
  main.append(heading('Choose a vehicle'));
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
   autocomplete:'off',required:required?'required':null,'aria-describedby':'err-'+key});
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
function sellerAvatar(record){
 const avatar=el('span',{class:'market-seller-avatar','aria-hidden':'true'});
 const initials=el('span',{text:C.sellerInitials(record.sellerName)||'?'});
 avatar.append(initials);
 const show=src=>{
  const img=el('img',{src,alt:'',width:56,height:56,decoding:'async',onerror:()=>img.remove()});
  avatar.append(img);
 };
 if(record.sellerAvatarSrc)show(record.sellerAvatarSrc);
 else if(record.sellerAvatarId)showStoredPhoto(avatar,record.sellerAvatarId,show);
 return avatar;
}
function sellerControl(record){
 const fieldset=el('fieldset',{class:'market-seller-fields'},
  el('legend',{},'Seller details'));
 const type=el('select',{id:'m-sellerType'},
  el('option',{value:'private'},'Private seller'),
  el('option',{value:'dealership'},'Dealership'));
 type.value=record.sellerType;
 const name=makeInput(record,'sellerName','Seller name');
 const label=name.querySelector('label'),nameInput=name.querySelector('input');
 nameInput.maxLength=C.MAX_SELLER_NAME;
 const upload=el('input',{type:'file',accept:'image/jpeg,image/png,image/webp,image/heic,image/heif',hidden:true});
 const choose=el('button',{type:'button',class:'market-secondary',onclick:()=>upload.click()});
 const remove=el('button',{type:'button',class:'market-plain'},'Remove image');
 const feedback=el('span',{class:'market-muted',role:'status'});
 const avatarSlot=el('div',{},sellerAvatar(record));
 let pending=null;
 const updateLabels=()=>{
  const dealership=record.sellerType==='dealership';
  label.textContent=dealership?'Dealership name':'Seller name';
  const image=dealership?'logo':'profile photo';
  choose.textContent=(record.sellerAvatarId?'Change ':'Add ')+image;
  remove.hidden=!record.sellerAvatarId;
 };
 const updateAvatar=()=>{avatarSlot.replaceChildren(sellerAvatar(record));updateLabels();};
 const saveAvatar=id=>{
  const previous=record.sellerAvatarId;
  const updatedAt=record.updatedAt;
  record.sellerAvatarId=id;record.updatedAt=new Date().toISOString();
  if(!persist()){
   record.sellerAvatarId=previous;record.updatedAt=updatedAt;
   return false;
  }
  if(previous)void photoOp('delete',previous).catch(()=>{});
  updateAvatar();
  return true;
 };
 type.addEventListener('change',()=>{
  record.sellerType=type.value;record.updatedAt=new Date().toISOString();persist();
  updateLabels();
 });
 nameInput.addEventListener('input',()=>{
  avatarSlot.firstElementChild.firstElementChild.textContent=C.sellerInitials(nameInput.value)||'?';
 });
 remove.addEventListener('click',()=>{
  if(saveAvatar(null)){choose.focus();feedback.textContent='Seller image removed.';}
 });
 const storeAvatar=async file=>{
  choose.disabled=true;remove.disabled=true;
  feedback.textContent='Processing image…';
  try{
   const blob=await processImage(file,256),id=uuid();
   await photoOp('put',id,blob);
   if(!fieldset.isConnected||!saveAvatar(id)){
    await photoOp('delete',id);
    if(fieldset.isConnected)feedback.textContent='Could not save the seller image. Try again.';
    return;
   }
   feedback.textContent='Seller image saved.';
  }catch(error){
   feedback.textContent=error.message||'Could not save the seller image. Try another image.';
  }finally{choose.disabled=false;remove.disabled=false;pending=null;}
 };
 upload.addEventListener('change',()=>{
  const file=upload.files[0];
  upload.value='';
  if(file)pending=storeAvatar(file);
 });
 updateLabels();
 fieldset.append(el('div',{class:'market-fields-two'},
  el('div',{class:'market-field'},el('label',{for:type.id},'Seller type'),type),name),
  el('div',{class:'market-avatar-actions'},avatarSlot,choose,remove,upload),
  feedback);
 return {fieldset,ready:()=>pending};
}
function renderEditor(r){
 main.append(el('a',{href:'#mine',class:'market-back'},'← My listings'));
 main.append(heading(r.status==='draft'?'Create listing':'Edit listing'));
 main.append(el('div',{class:'market-vehicle-summary'},el('strong',{},C.displayTitle(r)),
  el('span',{},[r.vehicle.drive,r.vehicle.transmission].filter(Boolean).join(' · '))));

 const form=el('form',{class:'market-form',novalidate:true});
 const postal=postalField(r);
 const seller=sellerControl(r);
 form.append(photoControl(r),
  el('div',{class:'market-fields-two'},
   makeInput(r,'price','Asking price (USD)','e.g. 14900','text'),
   makeInput(r,'mileage','Mileage','e.g. 92400','text')),
  postal.field,
  el('div',{class:'market-fields-two'},
   fieldSelect(r,'titleStatus','Title',[['clean','Clean'],['lien','Lien'],['salvage','Salvage'],['rebuilt','Rebuilt'],['unknown','Not sure']]),
   fieldSelect(r,'condition','Condition',[['excellent','Excellent'],['good','Good'],['fair','Fair'],['needs-work','Needs work']])),
  seller.fieldset);
 const optional=el('details',{class:'market-optional'},el('summary',{},'Seller notes (optional)'),
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
  el('span',{class:'market-muted'},'Only on this device · Not published'));
 form.append(errors,actions);
 form.addEventListener('submit',async evt=>{
  evt.preventDefault();
  // Do not allow a ZIP still being resolved to become an invalid public place.
  await Promise.all([postal.resolve(),seller.ready()]);
  if(!form.isConnected)return;
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
  const previousStatus=r.status,previousUpdatedAt=r.updatedAt;
  r.status='preview';r.updatedAt=new Date().toISOString();
  if(!persist()){
   r.status=previousStatus;r.updatedAt=previousUpdatedAt;
   errors.hidden=false;errors.textContent='Storage failed. Resolve that before previewing.';
   return;
  }
  current=null;location.hash=urlFor(r.id);msg('Private listing preview ready.');
 });
 main.append(el('div',{class:'market-editor'},form));
}
function dlItem(name,value){return el('div',{},el('dt',{},name),el('dd',{},value||'Not specified'))}
function detail(r){
 main.append(el('div',{class:'market-detail-gallery'},photoCarousel(r,'detail')));
 main.append(el('a',{href:'#browse',class:'market-back'},'← Back to cars'));
 main.append(el('div',{class:'market-detail-header'},
  el('div',{},el('h1',{class:'market-heading'},C.displayTitle(r)),
   el('p',{class:'market-subtitle'},r.place+' · '+(r.sample?'Sample listing':'Private preview')),
   el('strong',{class:'market-detail-price'},C.money(r.price))),
  r.sample?null:el('div',{class:'market-manage'},link('Edit','#edit/'+r.id))));
 const quickFacts=[C.mileage(r.mileage),r.vehicle.transmission,r.vehicle.drive].filter(Boolean);
 const disclosures=el('section',{class:'market-detail-section market-essential'},
  el('h2',{},'Condition & title'),
  el('div',{class:'market-disclosure-pair'},
   el('div',{},el('span',{class:'market-disclosure-name'},'Title'),
    el('strong',{},C.titleStatusLabel(r.titleStatus))),
   el('div',{},el('span',{class:'market-disclosure-name'},'Condition'),
    el('strong',{},C.conditionLabel(r.condition)))),
  el('p',{class:'market-muted'},'Seller-reported, not independently verified.'));
 const left=el('div',{},
  el('div',{class:'market-facts'},quickFacts.join(' · ')),
  disclosures,
  el('section',{class:'market-detail-section'},el('h2',{},'Seller'),
   el('div',{class:'market-seller-row'},sellerAvatar(r),el('div',{},
    el('strong',{},r.sellerName||'Name not provided'),
    el('span',{class:'market-muted'},r.sellerType==='dealership'?'Dealership':'Private seller')))));
 if(r.knownIssues||r.description){
  const notes=el('section',{class:'market-detail-section'},el('h2',{},'Seller notes'));
  if(r.knownIssues)notes.append(
   el('p',{},el('strong',{},'Known issues: '),r.knownIssues));
  if(r.description)notes.append(el('p',{},r.description));
  left.append(notes);
 }
 const specs=[
  ['Engine',r.vehicle.engine?r.vehicle.engine+' L':null],
  ['Fuel',r.vehicle.fuel],
  ['Body',r.vehicle.body],
  ['Transmission',r.vehicle.transmission],
  ['Drivetrain',r.vehicle.drive],
  ['Trim',r.vehicle.trim],
  ['VIN',r.vehicle.vin?'Ends in '+r.vehicle.vin.slice(-4):null]
 ].filter(([name,value])=>value);
 const specifications=el('details',{class:'market-specifications'},
  el('summary',{},'Vehicle specifications'),
  el('dl',{class:'market-dl'},specs.map(([name,value])=>dlItem(name,value))),
  r.sample?null:el('p',{class:'market-muted'},
   'Factory details from VIN decoding. Does not verify ownership, mileage, title or accident history.'));
 left.append(specifications);
 if(!r.sample)left.append(el('p',{class:'market-detail-availability'},
  'Buyer messaging is not active in this private preview.'));
 main.append(el('div',{class:'market-detail-layout'},left));
}
function render(){
 cleanupImages();
 const [screen,id]=route();selectNav(screen);
 activeScreen=screen;filterBrowse=null;
 main.replaceChildren();
 if(screen==='browse')renderBrowse();
 else if(screen==='mine')renderMine();
 else if(screen==='new'){renderNew()}
 else if(screen==='edit'){
  const r=listings.find(x=>x.id===id);
  if(!r){main.append(empty('Listing not found','This listing may have been deleted from this device.',link('My listings','#mine')));return}
  current=r;renderEditor(r);
 }else if(screen==='detail'){
  const r=listings.find(x=>x.id===id)||samples.find(x=>x.id===id);
  if(!r){main.append(empty('Listing not found','This listing may have been deleted or is unavailable on this device.',link('Browse','#browse')));return}
  detail(r);
 }
 document.title=(screen==='browse'?'Cars':screen==='mine'?'My listings':screen==='detail'?'Vehicle details':'Sell your car')+' · VINBOX';
}
search.addEventListener('input',()=>filterBrowse?.());
searchForm.addEventListener('submit',event=>{
 event.preventDefault();
 search.blur();
 if(activeScreen==='browse'){
  filterBrowse();
  window.scrollTo({top:0,behavior:'instant'});
 }else{
  browseScroll=0;
  location.hash='browse';
 }
});
window.addEventListener('hashchange',()=>{
 const previous=activeScreen;
 if(previous==='browse')browseScroll=window.scrollY;
 if(route()[0]!=='new')current=null;
 render();
 window.scrollTo({top:activeScreen==='browse'&&previous==='detail'?browseScroll:0,behavior:'instant'});
});
window.addEventListener('pagehide',cleanupImages);
render();
})();
