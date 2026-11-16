/* VINBOX Cars — safe device-local marketplace pilot.
   Public publication and buyer messaging are intentionally unavailable until
   a dedicated authenticated backend is provisioned and verified. */
(function(){
'use strict';
const C=window.VinboxMarketCore;
const vinLookup=window.VinboxVinLookup;
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
 if(!response.ok)throw Error('Could not look up that ZIP code.');
 const result=C.postalPlace(zip,await response.json());
 if(result)postalCache.set(zip,result);
 return result;
}

let listings=C.read(localStorage),photoUrls=[],renderEpoch=0,statusTimeout;
let savedIds=C.readSaved(localStorage);
let activeScreen,browseScroll=0,savedScroll=0,filterBrowse=null;
let vinRequest=null;
const {el,template}=window.VinboxUI;
const components=window.VinboxMarketComponents;
const {heading,empty,field,section,detailsHeader,conditionSection,
 sellerSection,vehicleSpecs,economyPanel,recallsPanel,link,detailsUrl:urlFor}=components;
const {photoSlot,photoCarousel,sellerAvatar}=components.createMedia(showStoredPhoto);
const uuid=()=>crypto.randomUUID();
const galleryPositions=new Map();
const openedFromSaved=new Set();
const msg=s=>{
 status.textContent=s;status.dataset.on='true';
 clearTimeout(statusTimeout);statusTimeout=setTimeout(()=>status.dataset.on='false',3600);
};
function persist(){
 try{C.write(localStorage,listings);return true}
 catch{msg('Could not save changes on this device. Check your browser storage.');return false}
}
function route(){
 const [view,id,index]=location.hash.slice(1).split('/');
 if(view==='inbox')return ['profile'];
 if(['mine','saved','profile'].includes(view)||view==='new'&&!id)return [view];
 if(!id)return ['browse'];
 let listingId;
 try{listingId=decodeURIComponent(id);}catch{return ['browse'];}
 if(view==='photos')return ['photos',listingId,Number.isSafeInteger(Number(index))?Number(index):0];
 if(view==='car')return ['detail',listingId];
 if(view==='edit')return ['edit',listingId];
 if(view==='new')return ['new',listingId];
 return ['browse'];
}
function selectNav(key,id){
 const destination=['detail','photos'].includes(key)?
  (openedFromSaved.has(id)?'saved':'browse'):key==='edit'?'mine':key;
 document.querySelectorAll('[data-nav]').forEach(a=>{
  if(a.dataset.nav===destination){
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
  tx.oncomplete=()=>resolve(req.result);
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
function updateSaveButtons(){
 for(const button of main.querySelectorAll('[data-saved-listing]')){
  components.setSaved(button,savedIds.includes(button.dataset.savedListing));
 }
}
function toggleSaved(id,button){
 const ids=C.readSaved(localStorage);
 const removing=ids.includes(id);
 const next=removing?ids.filter(saved=>saved!==id):[id,...ids];
 try{C.writeSaved(localStorage,next);}
 catch{msg('Could not save this change. Try again.');return;}
 savedIds=next;
 if(activeScreen==='saved'&&removing){
  const index=[...main.querySelectorAll('[data-saved-listing]')].indexOf(button);
  render();
  const remaining=main.querySelectorAll('[data-saved-listing]');
  (remaining[Math.min(index,remaining.length-1)]||main).focus({preventScroll:true});
 }else updateSaveButtons();
 msg(removing?'Removed from Saved.':'Saved on this device.');
}
function saveControl(r,compact=false){
 return components.saveButton(r,savedIds.includes(r.id),toggleSaved,compact);
}
function listingCard(r){return components.card(r,photoCarousel,saveControl(r,true));}
function renderSaved(){
 const byId=new Map([...currentList(),...samples].map(r=>[r.id,r]));
 const items=savedIds.map(id=>byId.get(id)).filter(Boolean);
 main.append(heading('Saved'));
 if(!items.length){
  main.append(empty('No saved cars','Save a car to find it here later.',link('Browse cars','#browse','market-primary')));
  return;
 }
 main.append(el('div',{class:'market-cards'},items.map(listingCard)));
}
function renderProfile(){
 const {root,slots}=template('market-profile-template');
 const profile=C.readProfile(localStorage);
 slots.type.value=profile.sellerType;
 slots.name.value=profile.sellerName;
 const update=()=>{
  const dealer=slots.type.value==='dealership';
  slots.nameLabel.textContent=dealer?'Dealership name':'Seller name';
  slots.name.autocomplete=dealer?'organization':'name';
  slots.feedback.textContent='';
  slots.name.removeAttribute('aria-invalid');
 };
 slots.type.addEventListener('change',update);
 slots.name.addEventListener('input',update);
 root.querySelector('form').addEventListener('submit',event=>{
  event.preventDefault();
  try{
   const saved=C.writeProfile(localStorage,{sellerType:slots.type.value,sellerName:slots.name.value});
   slots.name.value=saved.sellerName;
   slots.feedback.textContent='Profile saved on this device.';
  }catch(error){
   if(error instanceof RangeError){
    slots.name.setAttribute('aria-invalid','true');
    slots.name.focus();
    slots.feedback.textContent=error.message;
   }else slots.feedback.textContent='Could not save your profile. Try again.';
  }
 });
 update();
 main.append(root);
}
function fromScanner(){
 try{
  const str=sessionStorage.getItem(TRANSFER);
  if(!str)return null;
  const raw=JSON.parse(str),v=C.pickVehicle(raw);
  sessionStorage.removeItem(TRANSFER);
  if(v)try{vinLookup.rememberVehicles(sessionStorage,[raw]);}catch{}
  return v;
 }catch{return null}
}
function savedVehicles(){
 try{const records=JSON.parse(localStorage.getItem('vin-history')||'[]');
  return Array.isArray(records)?records.map(C.pickVehicle).filter(Boolean):[]}
 catch{return []}
}
function findOrCreateDraft(vehicle){
 const vin=C.vin(vehicle.vin);
 const existing=listings.find(r=>r.status==='draft'&&r.id&&C.vin(r.vehicle.vin)===vin);
 if(existing)return existing;
 if(listings.length>=C.MAX_DRAFTS){
  msg('You can keep up to 30 listings. Delete one to start another.');
  return null;
 }
 const r={...C.fresh(vehicle),...C.readProfile(localStorage)};
 r.id=uuid();listings.unshift(r);
 if(!persist()){listings.shift();return null}
 return r;
}
function renderBrowse(){
 const {root,slots:{count,cards:grid}}=template('market-browse-template');
 const items=[...currentList(),...samples];
 grid.append(...items.map(listingCard));
 const noResults=empty('No matching vehicles','Try a different vehicle, seller, or city.');
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
 root.append(noResults);
 main.append(root);
}
function renderMine(){
 const {root,slots:{listings:stack}}=template('market-mine-template');
 main.append(root);
 if(!listings.length){
  stack.append(empty('No listings yet','Enter a VIN to start a listing.',link('Sell a car','#new','market-primary')));
  return;
 }
 for(const r of listings){
  const draft=r.status==='draft';
  const actions=el('div',{class:'market-manage'},
   link(draft?'Continue draft':'Edit','#edit/'+r.id),
   draft?null:link('View preview',urlFor(r.id)));
  const changeStatus=next=>{
   const previous=r.status,updatedAt=r.updatedAt;
   r.status=next;r.updatedAt=new Date().toISOString();
   if(!persist()){r.status=previous;r.updatedAt=updatedAt;return;}
   render();
  };
  if(r.status==='preview'){
   actions.append(el('button',{class:'market-secondary',onclick:()=>changeStatus('sold')},'Mark sold'));
  }
  if(r.status==='sold')actions.append(el('button',{class:'market-secondary',onclick:()=>changeStatus('preview')},'Mark available'));
  const remove=el('button',{class:'market-plain'},'Delete');
  remove.addEventListener('click',()=>{
   remove.replaceWith(el('span',{class:'market-muted'},'Delete this local listing? '),
     el('button',{class:'market-secondary',onclick:async()=>{
      const previous=listings;
      listings=listings.filter(x=>x.id!==r.id);
      if(!persist()){listings=previous;return;}
      galleryPositions.delete(r.id);
      openedFromSaved.delete(r.id);
      const ids=C.readSaved(localStorage);
      if(ids.includes(r.id)){
       const remaining=ids.filter(id=>id!==r.id);
       try{C.writeSaved(localStorage,remaining);savedIds=remaining;}catch{/* Deleted records are filtered in Saved. */}
      }
      for(const pid of [...r.photoIds,r.sellerAvatarId].filter(Boolean))photoOp('delete',pid).catch(()=>{});
      render();
     }},'Confirm delete'),
     el('button',{class:'market-plain',onclick:()=>render()},'Cancel'));
  });
  stack.append(el('section',{class:'market-vehicle-summary'},
   el('strong',{},C.displayTitle(r)),el('span',{},r.status==='draft'?'Draft':r.status==='sold'?'Sold':'Preview',
    ' · ',C.money(r.price)),actions,remove));
 }
}
function renderNew(id){
 if(id){
  const listing=listings.find(r=>r.id===id);
  if(listing){renderEditor(listing,true);return;}
 }
 const transferred=fromScanner();
 const {root,slots}=template('market-vin-picker-template');
 const {input,find,feedback,vehicles,historyHeading}=slots;
 const recent=vinLookup.recentVehicles(sessionStorage).map(C.pickVehicle).filter(Boolean);
 const choices=new Map();
 for(const draft of listings){
  if(draft.status!=='draft'||!draft.id)continue;
  const vin=C.vin(draft.vehicle.vin);
  if(vin&&!choices.has(vin))choices.set(vin,{vehicle:draft.vehicle,draft});
 }
 if(choices.size)historyHeading.textContent='Your vehicles';
 for(const vehicle of [transferred,...recent,...savedVehicles()]){
  if(vehicle&&!choices.has(vehicle.vin))choices.set(vehicle.vin,{vehicle});
 }
 function showVehicles(selected){
  const ordered=[...choices].filter(([vin])=>vin!==selected);
  if(choices.has(selected))ordered.unshift([selected,choices.get(selected)]);
  vehicles.replaceChildren(...ordered.map(([vin,{vehicle,draft}])=>
   components.vinChoice(vehicle,draft?'Continue draft':'Use vehicle',()=>{
    const listing=findOrCreateDraft(vehicle);
    if(listing)location.hash='new/'+listing.id;
   },vin===selected)));
  slots.empty.hidden=choices.size>0;
 }
 if(transferred)input.value=transferred.vin;
 showVehicles(transferred?.vin);
 input.addEventListener('input',()=>{
  vinRequest?.abort();
  vinRequest=null;
  find.disabled=false;find.textContent='Find vehicle';
  input.removeAttribute('aria-invalid');
  feedback.textContent='Enter all 17 characters.';
 });
 root.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(vinRequest)return;
  const vin=C.vin(input.value.replace(/[\s-]/g,''));
  if(!vin){
   input.setAttribute('aria-invalid','true');
   feedback.textContent='Enter a 17-character VIN. VINs never use I, O, or Q.';
   input.focus();
   return;
  }
  input.value=vin;input.removeAttribute('aria-invalid');
  if(choices.has(vin)){
   showVehicles(vin);
   feedback.textContent=choices.get(vin).draft?'Draft found. Continue below.':'Vehicle found. Choose it below.';
   return;
  }
  const request=vinRequest=new AbortController();
  const timeout=setTimeout(()=>request.abort(),15000);
  find.disabled=true;find.textContent='Finding vehicle…';
  feedback.textContent='Looking up this VIN…';
  try{
   const [raw]=await vinLookup.decodeVins([vin],undefined,undefined,request.signal);
   if(vinRequest!==request||!root.isConnected)return;
   const vehicle=C.pickVehicle(raw);
   if(!vehicle||vehicle.vin!==vin){
    input.setAttribute('aria-invalid','true');
    feedback.textContent='Could not find this vehicle. Check the VIN and try again.';
    return;
   }
   try{vinLookup.rememberVehicles(sessionStorage,[raw]);}catch{}
   choices.set(vin,{vehicle});
   showVehicles(vin);
   feedback.textContent='Vehicle found. Choose it below.';
  }catch{
   if(vinRequest===request&&root.isConnected)feedback.textContent='Could not look up this VIN. Check your connection and try again.';
  }finally{
   clearTimeout(timeout);
   if(vinRequest===request){
    vinRequest=null;
    find.disabled=false;find.textContent='Find vehicle';
   }
  }
 });
 main.append(root);
}
function bindField(record,key,label,control){
 const wrapper=field(key,label,control);
 const error=wrapper.querySelector('small');
 const event=control.matches('select')?'change':'input';
 control.value=record[key]||'';
 control.addEventListener(event,()=>{
  record[key]=control.value;record.updatedAt=new Date().toISOString();
  error.textContent='';control.removeAttribute('aria-invalid');
  persist();
 });
 return wrapper;
}
function makeInput(record,key,label,placeholder,kind='text',required=true){
 return bindField(record,key,label,el('input',{type:kind,placeholder,autocomplete:'off',
  required,'inputmode':['price','dealerFee'].includes(key)?'decimal':key==='mileage'?'numeric':null,
  maxlength:C.FIELD_LIMITS[key]||(key==='dealerFee'?30:null)}));
}
function textField(record,key,label,placeholder){
 return bindField(record,key,label,el('textarea',{maxlength:C.FIELD_LIMITS[key],placeholder}));
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
     hint.textContent='Could not find a city. Enter your city or town.';
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
function fieldSelect(record,key,label,options,placeholder='Choose one'){
 const select=el('select',{},el('option',{value:''},placeholder),
  options.map(([value,name])=>el('option',{value},name)));
 return bindField(record,key,label,select);
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
  if(saveAvatar(null)){choose.focus();feedback.textContent='Photo or logo removed.';}
 });
 const storeAvatar=async file=>{
  choose.disabled=true;remove.disabled=true;
  feedback.textContent='Processing image…';
  try{
   const blob=await processImage(file,256),id=uuid();
   await photoOp('put',id,blob);
   if(!fieldset.isConnected||!saveAvatar(id)){
    await photoOp('delete',id);
    if(fieldset.isConnected)feedback.textContent='Could not save the photo or logo. Try again.';
    return;
   }
   feedback.textContent='Photo or logo saved.';
  }catch(error){
   feedback.textContent=error.message||'Could not save the photo or logo. Try another image.';
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
  feedback,
  el('div',{class:'market-fields-two'},
   makeInput(record,'contactEmail','Email for messages','name@example.com','email',false),
   makeInput(record,'contactPhone','Phone for calls or texts','e.g. (812) 555-0123','tel',false)),
  el('p',{class:'market-muted market-contact-note'},'Optional · Contact details stay on this device in the private preview. They are not published.'));
 return {fieldset,ready:()=>pending};
}
function conditionFields(r){
 const knownIssues=textField(r,'knownIssues','Describe the known issues','For example, a warning light or visible damage');
 const issueStatus=fieldSelect(r,'issuesStatus','Known issues',[
  ['none','None known'],['listed','Issues to disclose']
 ],'Not disclosed');
 const select=issueStatus.querySelector('select');
 const initial=C.issuesStatus(r);
 select.value=initial==='unknown'?'':initial;
 function update(){
  knownIssues.hidden=select.value!=='listed';
  knownIssues.querySelector('textarea').required=!knownIssues.hidden;
 }
 select.addEventListener('change',()=>{
  if(select.value!=='listed'){r.knownIssues='';knownIssues.querySelector('textarea').value='';persist();}
  update();
 });
 update();
 return [
  el('div',{class:'market-fields-two'},
   fieldSelect(r,'titleStatus','Title',C.VALID_TITLE.map(value=>[value,C.titleStatusLabel(value)])),
   fieldSelect(r,'condition','Condition',C.VALID_CONDITION.map(value=>[value,C.conditionLabel(value)]))),
  el('div',{class:'market-fields-two'},
   fieldSelect(r,'lienStatus','Lien',[['no','No lien'],['yes','Lien on vehicle'],['unknown','Not sure']],'Not disclosed'),
   issueStatus),
  knownIssues
 ];
}
function optionalFields(r,seller){
 const optional=components.disclosure('Add more details (optional)');
 optional.root.className='market-optional';
 const dealer=el('div',{class:'market-fields-two market-dealer-fields'},
  makeInput(r,'stockNumber','Stock number','e.g. 2415A','text',false),
  makeInput(r,'dealerFee','Dealer fees added to asking price (USD)','e.g. 199.00','text',false));
 const type=seller.fieldset.querySelector('select');
 const update=()=>dealer.hidden=type.value!=='dealership';
 type.addEventListener('change',update);
 update();
 optional.body.className='market-edit-fields';
 optional.body.append(
  makeInput(r,'exteriorColor','Exterior color','e.g. Blue','text',false),dealer,
  textField(r,'maintenance','Recent maintenance','What was done and when?'),
  textField(r,'description','About this vehicle','Add features, modifications, or other useful details.'));
 return optional.root;
}
function renderEditor(r,fromSell=false){
 main.append(el('a',{href:fromSell?'#new':'#mine',class:'market-back'},fromSell?'← Back to vehicles':'← My listings'),
  heading(r.status==='draft'?'Create listing':'Edit listing'));
 main.append(el('div',{class:'market-vehicle-summary'},el('strong',{},C.displayTitle(r)),
  el('span',{},[r.vehicle.drive,r.vehicle.transmission].filter(Boolean).join(' · '))));
 const {root,slots:{fields,permission,errors}}=template('market-editor-template');
 const form=root.querySelector('form');
 const postal=postalField(r);
 const seller=sellerControl(r);
 const optional=optionalFields(r,seller);
 fields.append(photoControl(r),
  el('div',{class:'market-fields-two'},
   makeInput(r,'price','Asking price (USD)','e.g. 14900'),
   makeInput(r,'mileage','Mileage','e.g. 92400')),
  postal.field,...conditionFields(r),seller.fieldset,optional);
 permission.checked=r.authorized;
 permission.addEventListener('change',()=>{r.authorized=permission.checked;persist();});
 form.addEventListener('submit',async evt=>{
  evt.preventDefault();
  // Do not allow a ZIP still being resolved to become an invalid public place.
  await Promise.all([postal.resolve(),seller.ready()]);
  if(!form.isConnected)return;
  const result=C.validate(r);
  form.querySelectorAll('[id^="err-"]').forEach(x=>x.textContent='');
  form.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));
  if(!result.valid){
   errors.hidden=false;errors.textContent='Fill in the marked fields to preview your listing.';
   for(const [key,value] of Object.entries(result.errors)){
    const target=form.querySelector('#err-'+key);if(target)target.textContent=value;
    const control=form.querySelector('#m-'+key);if(control)control.setAttribute('aria-invalid','true');
   }
   if(result.errors.dealerFee)optional.open=true;
   const first=form.querySelector('[aria-invalid="true"]')||form.querySelector('#err-photos');
   first?.focus?.();
   return;
  }
  const previousStatus=r.status,previousUpdatedAt=r.updatedAt;
  if(r.status==='draft')r.status='preview';
  r.updatedAt=new Date().toISOString();
  if(!persist()){
   r.status=previousStatus;r.updatedAt=previousUpdatedAt;
   errors.hidden=false;errors.textContent='Could not save this listing. Check your browser storage and try again.';
   return;
  }
  location.hash=urlFor(r.id);msg('Your listing preview is ready.');
 });
 main.append(root);
}
function rememberPhoto(id,index){galleryPositions.set(id,index);}
function detail(r){
 main.classList.add('market-detail-page');
 const gallery=photoCarousel(r,'detail',galleryPositions.get(r.id)||0,index=>rememberPhoto(r.id,index));
 const condition=conditionSection(r);
 condition.classList.add('market-detail-disclosures');
 const seller=sellerSection(r,sellerAvatar);
 seller.classList.add('market-detail-seller');
 const research=el('div',{class:'market-detail-research'});
 if(r.maintenance)research.append(section('Recent maintenance',el('p',{},r.maintenance)));
 if(r.description)research.append(section('Seller notes',el('p',{},r.description)));
 research.append(vehicleSpecs(r),economyPanel(r),recallsPanel(r));
 main.append(el('div',{class:'market-detail-gallery'},gallery),
  detailsHeader(r,r.status==='draft'?null:saveControl(r),openedFromSaved.has(r.id)),condition,seller,research,similarCars(r));
}
function similarCars(r){
 const matches=C.similarListings(r,[...currentList(),...samples],4);
 const headingId='market-similar-heading';
 const header=el('div',{class:'market-similar-header'},
  el('h2',{id:headingId},'Similar cars'),
  link('View all cars','#browse','market-similar-view-all'));
 const content=matches.length?
  el('div',{class:'market-cards market-similar-cards'},matches.map(listingCard)):
  el('p',{class:'market-muted market-similar-empty'},'No similar cars available right now.');
 const result=el('section',{class:'market-similar','aria-labelledby':headingId},header,content);
 if(matches.some(item=>item.sample))
  result.append(el('p',{class:'market-muted market-similar-note'},'Includes example listings for demonstration.'));
 return result;
}
function renderPhotos(r,index){
 const {root,slots}=template('market-photo-view-template');
 const count=(r.photoSources||r.photoIds||[]).length;
 const selected=Math.min(Math.max(index,0),Math.max(count-1,0));
 rememberPhoto(r.id,selected);
 slots.back.href=urlFor(r.id);
 slots.heading.textContent=C.displayTitle(r)+' photos';
 slots.gallery.append(photoCarousel(r,'large',selected,position=>rememberPhoto(r.id,position)));
 main.append(root);
}
function render(){
 vinRequest?.abort();
 vinRequest=null;
 cleanupImages();
 const [screen,id,index]=route();selectNav(screen,id);
 activeScreen=screen;filterBrowse=null;
 main.classList.remove('market-detail-page');
 main.replaceChildren();
 if(screen==='browse')renderBrowse();
 else if(screen==='saved')renderSaved();
 else if(screen==='profile')renderProfile();
 else if(screen==='mine')renderMine();
 else if(screen==='new')renderNew(id);
 else if(screen==='edit'){
  const r=listings.find(x=>x.id===id);
  if(!r){main.append(empty('Listing not found','This listing may have been deleted from this device.',link('My listings','#mine')));return}
  renderEditor(r);
 }else if(screen==='detail'||screen==='photos'){
  const r=listings.find(x=>x.id===id)||samples.find(x=>x.id===id);
  if(!r){main.append(empty('Listing not found','Open a listing saved on this device or browse cars.',link('Browse','#browse')));return}
  if(screen==='photos')renderPhotos(r,index);
  else detail(r);
 }
 const titles={browse:'Cars',saved:'Saved',profile:'Profile',mine:'My listings',profile:'Account',photos:'Vehicle photos',detail:'Vehicle details'};
 document.title=(titles[screen]||'Sell your car')+' · VINBOX';
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
 const [next,id]=route();
 if(previous==='browse')browseScroll=window.scrollY;
 if(previous==='saved')savedScroll=window.scrollY;
 if(next==='detail'){
  if(previous==='saved')openedFromSaved.add(id);
  else if(previous==='browse'||previous==='mine'||previous==='new'||previous==='edit')openedFromSaved.delete(id);
 }
 render();
 if(next==='new'||next==='edit')main.focus({preventScroll:true});
 const scroll=previous==='detail'?(activeScreen==='browse'?browseScroll:activeScreen==='saved'?savedScroll:0):0;
 window.scrollTo({top:scroll,behavior:'instant'});
});
window.addEventListener('storage',event=>{
 if(event.key!==C.SAVED_KEY&&event.key!==null)return;
 savedIds=C.readSaved(localStorage);
 if(activeScreen==='saved')render();
 else updateSaveButtons();
});
window.addEventListener('pagehide',cleanupImages);
render();
})();
