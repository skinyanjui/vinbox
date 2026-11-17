/* Reusable presentation for every marketplace route. */
(function(root){
'use strict';
const C=root.VinboxMarketCore;
const {el,template}=root.VinboxUI;
const detailsUrl=id=>'#car/'+encodeURIComponent(id);
const photoUrl=(id,index)=>'#photos/'+encodeURIComponent(id)+'/'+index;
const link=(label,href,klass='market-secondary')=>el('a',{href,class:klass},label);

function heading(title){
 const {root,slots}=template('market-heading-template');
 slots.heading.textContent=title;
 return root;
}
function empty(title,description,action){
 const {root,slots}=template('market-empty-template');
 slots.heading.textContent=title;
 slots.description.textContent=description;
 if(action)root.append(action);
 return root;
}
function field(key,label,control){
 const {root,slots}=template('market-field-template');
 control.id='m-'+key;
 control.setAttribute('aria-describedby','err-'+key);
 slots.label.htmlFor=control.id;
 slots.label.textContent=label;
 slots.error.id='err-'+key;
 slots.error.before(control);
 return root;
}
function section(title,...content){
 const {root,slots}=template('market-section-template');
 slots.heading.textContent=title;
 slots.body.append(...content);
 return root;
}
function disclosure(title,...content){
 const {root,slots}=template('market-disclosure-template');
 slots.heading.textContent=title;
 slots.body.append(...content);
 return {root,body:slots.body};
}
function facts(rows,className='market-dl'){
 const list=el('dl',{class:className});
 for(const [name,value] of rows){
  if(value!=null&&String(value).trim()&&!/^(?:not provided|not available|not applicable|not disclosed|n\/a|unknown|none|undefined|-)$/i.test(String(value).trim()))
   list.append(el('div',{},el('dt',{},name),el('dd',{},value)));
 }
 return list;
}
function setSaved(button,saved){
 button.setAttribute('aria-pressed',String(saved));
 button.title=saved?'Remove from Saved':'Save listing';
 button.querySelector('[data-slot="label"]').textContent=saved?'Saved':'Save';
}
function saveButton(r,saved,onToggle,compact=false){
 const {root:button}=template('market-save-template');
 button.dataset.savedListing=r.id;
 button.classList.toggle('market-save-compact',compact);
 button.setAttribute('aria-label','Save '+C.displayTitle(r));
 button.addEventListener('click',()=>onToggle(r.id,button));
 setSaved(button,saved);
 return button;
}
function vinChoice(vehicle,label,onChoose,selected){
 const {root,slots}=template('market-vin-choice-template');
 slots.name.textContent=C.displayTitle({vehicle});
 slots.vin.textContent=C.vin(vehicle.vin);
 slots.action.textContent=label;
 root.querySelector('button').addEventListener('click',onChoose);
 if(selected)root.dataset.selected='true';
 return root;
}
function detailsHeader(r,save,fromSaved){
 const {root,slots}=template('market-detail-header-template');
 slots.back.href=fromSaved?'#saved':'#browse';
 slots.back.textContent=fromSaved?'← Back to Saved':'← Back to cars';
 slots.heading.textContent=C.displayTitle(r);
 slots.location.textContent=r.place+' · '+C.saleStatus(r);
 slots.price.textContent=C.money(r.price);
 const {fuel,transmission,drive}=r.vehicle;
 slots.facts.append(facts([
  ['Mileage',C.miles(r.mileage)!==null?C.mileage(r.mileage):null],
   ['Drivetrain',drive],['Transmission',transmission],['Fuel',fuel],
   ['Title',r.titleStatus?C.titleStatusLabel(r.titleStatus):null],
   ['Condition',r.condition?C.conditionLabel(r.condition):null],
   ['Body',r.vehicle.body],['Trim',r.vehicle.trim]
 ],'market-detail-facts'));
 if(save)slots.actions.append(save);

 const channels=C.contactLinks(r);
 if(channels.message||channels.text||channels.call){
  slots.contact.append(el('button',{type:'button',class:'market-primary market-contact-jump',
   onclick:()=>{
    const target=document.getElementById('market-seller-contact');
    target?.scrollIntoView({block:'start',behavior:'smooth'});
    target?.focus({preventScroll:true});
   }},'Contact seller'),
   el('span',{class:'market-muted market-contact-entry-hint'},'Email, text or call the seller'));
 }else if(r.sample){
  // Demo inventory still shows the customer journey, but never provides a
  // contact destination for a fictional person.
  slots.contact.append(el('button',{type:'button',class:'market-primary market-contact-jump',
   onclick:()=>{
    const target=document.getElementById('market-seller-contact');
    target?.scrollIntoView({block:'start',behavior:'smooth'});
    target?.focus({preventScroll:true});
   }},'Contact seller'),
   el('span',{class:'market-muted market-contact-entry-hint'},
    'Example vehicle · Contact options shown for demonstration only'));
 }else if(r.status==='sold'){
  slots.contact.append(el('p',{class:'market-muted market-contact-entry-hint'},
   'Sold · Seller contact is unavailable.'));
 }else if(r.status==='draft'){
  slots.contact.append(link('Finish listing','#edit/'+encodeURIComponent(r.id),'market-secondary'));
 }else{
  slots.contact.append(link('Add seller contact details',
   '#edit/'+encodeURIComponent(r.id)+'/contacts','market-secondary'));
 }
 const price=priceDetails(r);
 if(price)slots.fees.append(price);
 const vin=C.vin(r.vehicle.vin);
 if(vin){
  slots.vinValue.textContent=vin;
  slots.vin.hidden=false;
 }
 return root;
}
function conditionSection(r){
 const status=C.issuesStatus(r);
 const disclosed=el('div',{class:'market-disclosure-grid'});
 if(r.lienStatus==='yes'||r.lienStatus==='no'){
  disclosed.append(el('div',{class:'market-disclosure-state '+(r.lienStatus==='yes'?'market-state-warning':'market-state-clear')},
   el('span',{class:'market-disclosure-label'},'Lien'),
   el('strong',{},r.lienStatus==='yes'?'Lien on vehicle':'No lien reported')));
 }else if(r.lienStatus==='unknown'){
  disclosed.append(el('div',{class:'market-disclosure-state market-state-neutral'},
   el('span',{class:'market-disclosure-label'},'Lien'),el('strong',{},'Seller is unsure')));
 }
 if(status==='none'){
  disclosed.append(el('div',{class:'market-disclosure-state market-state-clear'},
   el('span',{class:'market-disclosure-label'},'Known issues'),el('strong',{},'None reported by seller')));
 }else if(status==='listed'&&C.text(r.knownIssues)){
  disclosed.append(el('div',{class:'market-disclosure-state market-state-warning'},
   el('span',{class:'market-disclosure-label'},'Known issues'),el('p',{},r.knownIssues)));
 }
 return disclosed.childElementCount?section('Disclosures',disclosed):null;
}
function priceDetails(r){
 const asking=C.cents(r.price),fee=C.amountCents(r.dealerFee);
 if(r.sellerType!=='dealership'||asking===null||fee===null)return null;
 return disclosure('Price breakdown',facts([
  ['Asking price',C.moneyFromCents(asking)],['Additional dealer fees',C.moneyFromCents(fee)],
  ['Subtotal before taxes and registration',C.moneyFromCents(asking+fee)]
 ])).root;
}
function sellerSection(r,avatar){
 const contact=C.contactPresentation(r);
 const channels=C.contactLinks(r);
 const headingId='market-seller-heading';
 const seller=el('section',{class:'market-contact-card',id:'market-seller-contact',
  tabindex:'-1','aria-labelledby':headingId},
  el('h2',{class:'market-contact-heading',id:headingId},'Seller'),
  el('div',{class:'market-seller-row'},avatar(r),
   el('div',{},el('strong',{},r.sellerName||'Seller name unavailable'),
    el('span',{class:'market-muted'},r.sellerType==='dealership'?'Dealership':'Private seller'))));
 if(r.sellerType==='dealership'&&r.stockNumber)
  seller.append(facts([['Stock number',r.stockNumber]]));
 if(contact.mode==='sample'){
  seller.append(el('p',{class:'market-muted market-contact-note'},
   'This is an example vehicle. There is no real seller to contact.'),
   el('p',{class:'market-contact-demo-explanation'},
    'On a real listing, you can contact the seller by email, text, or phone when they provide those details.'),
   el('div',{class:'market-contact-demo-methods','aria-label':'Example contact methods'},
    el('span',{},'Email seller'),el('span',{},'Text seller'),el('span',{},'Call seller')));
  return seller;
 }
 if(contact.mode==='sold'){
  seller.append(el('p',{class:'market-contact-note'},'Sold · Seller contact is unavailable.'),
   link('Edit listing','#edit/'+encodeURIComponent(r.id),'market-seller-manage'));
  return seller;
 }
 if(contact.mode==='draft'){
  seller.append(el('p',{class:'market-muted market-contact-note'},
   'Finish the listing to review your seller details.'),
   link('Continue draft','#edit/'+encodeURIComponent(r.id),'market-seller-manage'));
  return seller;
 }
 seller.append(el('p',{class:'market-muted market-contact-note'},
  'Private preview · Only on this device. This listing is not public.'));
 if(contact.hasMethods){
  const actions=el('div',{class:'market-contact-actions','aria-label':'Contact methods'});
  if(channels.message)actions.append(link('Email seller',channels.message,'market-primary'));
  if(channels.text)actions.append(link('Text seller',channels.text,
   channels.message?'market-secondary':'market-primary'));
  if(channels.call)actions.append(link('Call seller',channels.call,'market-secondary'));
  seller.append(actions,el('p',{class:'market-muted market-contact-external'},
   'Opens your email, messages or phone app. VINBOX does not send or track these messages.'));
  const values=[];
  if(contact.email)values.push(['Email',contact.email]);
  if(contact.phone)values.push(['Phone',contact.phone]);
  seller.append(facts(values,'market-contact-details'));
 }else{
  seller.append(el('p',{class:'market-muted market-contact-missing'},
   'No contact methods added yet.'));
 }
 seller.append(link(contact.hasMethods?'Edit contact details':'Add contact details',
  '#edit/'+encodeURIComponent(r.id)+'/contacts','market-seller-manage'));
 return seller;
}
function vehicleSpecs(r){
 const v=r.vehicle;
 const rows=[['Exterior color',r.exteriorColor],['Engine',v.engine?v.engine+' L':null]];
 if(!rows.some(([,value])=>Boolean(value)))return null;
 const items=facts(rows);
 const specs=disclosure('Vehicle specifications',items).root;
 if(!r.sample)specs.append(el('p',{class:'market-muted'},'The VIN supplies factory specs. The seller enters the exterior color.'));
 return specs;
}
function loadedDisclosure(title,load,loading,retry){
 const status=el('div',{class:'market-lookup-result'});
 const {root}=disclosure(title,status);
 let state='idle';
 async function check(){
  state='loading';
  status.replaceChildren(el('p',{class:'market-muted',role:'status'},loading));
  try{
   const content=await load();
   state='ready';
   if(content==null){root.remove();return;}
   status.replaceChildren(content);
  }catch{
   state='error';
   const button=el('button',{type:'button',class:'market-secondary',onclick:check},'Retry');
   status.replaceChildren(el('p',{role:'status'},retry),button);
  }
 }
 root.addEventListener('toggle',()=>{if(root.open&&state==='idle')void check();});
 return root;
}
function economyMetrics(data){
 const items=[
  ['EPA-rated electric range',data.electricRange?data.electricRange+' mi':null],
  ['Combined',data.combined?data.combined+' '+data.unit:null],
  ['City',data.city?data.city+' '+data.unit:null],
  ['Highway',data.highway?data.highway+' '+data.unit:null]
 ];
 if(!items.some(([,value])=>value))return null;
 return el('div',{},facts(items),el('p',{class:'market-muted'},'Actual fuel use and electric range can vary.'));
}
function economyPanel(r){
 return loadedDisclosure('Fuel economy & range',async()=>{
  const adapter=root.VinEpa, input=C.epaInput(r.vehicle);
  const match=await adapter.resolve(input);
  if(match.status!=='auto')return null;
  const raw=await adapter.vehicle(match.id);
  if(!adapter.assessVehicle(input,raw,raw.model).compatible)
   return null;
  return economyMetrics(adapter.metrics(raw));
 },'Checking FuelEconomy.gov…','Could not load EPA figures.');
}
const recallCache=new Map();
function recallsPanel(r){
 const label=el('p',{class:'market-muted'},
  'NHTSA campaigns for this model year. Check ',link('this vehicle’s VIN','https://www.nhtsa.gov/recalls','market-text-link'),' for unrepaired recalls.');
 const panel=loadedDisclosure('Model recalls',async()=>{
  const {make,model,year}=r.vehicle,key=JSON.stringify([make,model,year]);
  if(!recallCache.has(key)){
   const request=root.VinboxRecalls.fetchModel({make,model,year}).catch(err=>{recallCache.delete(key);throw err;});
   recallCache.set(key,request);
  }
  const campaigns=await recallCache.get(key);
  if(!campaigns.length)return null;
  return el('ul',{class:'market-recalls'},campaigns.map(campaign=>el('li',{},
   el('strong',{},[campaign.component,campaign.id].filter(Boolean).join(' · ')||'Recall campaign'),
   campaign.parkIt?el('p',{},'Park advisory'):null,
   campaign.summary?el('p',{},campaign.summary):null)));
 },'Checking NHTSA…','Could not load model recalls.');
 panel.querySelector('summary').after(label);
 return panel;
}

function createMedia(showStoredPhoto){
 function photoSlot(id,cls='market-photo',index=0,sample=false,lazy=false){
  const placeholder=el('span',{class:'market-photo-placeholder'},'Photo unavailable');
  const box=el('div',{class:cls},placeholder);
  const show=src=>{
   const img=el('img',{src,alt:(sample?'Illustrative vehicle photo ':'Vehicle photo ')+(index+1),
    loading:lazy?'lazy':'eager',decoding:'async',onerror:()=>img.replaceWith(placeholder)});
   placeholder.replaceWith(img);
  };
  if(sample)show(id);
  else showStoredPhoto(box,id,show);
  return box;
 }
 function photoCarousel(record,mode='card',initial=0,onIndex=()=>{}){
  const ids=record.photoSources||record.photoIds||[];
  const compact=mode==='card',count=ids.length, title=C.displayTitle(record);
  const {root:viewport,slots:{track,previous,next,count:counter}}=template('market-gallery-template');
  viewport.setAttribute('aria-label','Photos of '+title);
  if(count>1)viewport.tabIndex=0;
  for(const [i,id] of ids.entries()){
   const picture=photoSlot(id,'market-photo',i,record.sample,compact?record.sample||i>0:i>0&&i!==initial);
   const label='Photo '+(i+1)+' of '+count;
   const href=compact?detailsUrl(record.id):photoUrl(record.id,i);
   const slide=mode==='large'?el('div',{class:'market-carousel-slide'},picture):
    el('a',{class:'market-carousel-slide',href,'aria-label':compact?'View '+title+' '+label.toLowerCase():'Enlarge '+label.toLowerCase()},picture);
   track.append(slide);
  }
  if(!count)track.append(el('div',{class:'market-carousel-slide'},
   el('div',{class:'market-photo'},el('span',{class:'market-photo-placeholder'},'No vehicle photos'))));
  if(count<2){previous.remove();next.remove();}
  if(!count||(compact&&count===1))counter.remove();
  if(compact)counter.setAttribute('aria-hidden','true');

  let position=Math.min(Math.max(initial,0),Math.max(count-1,0));
  function sync(){
   if(!count)return;
   counter.textContent=(position+1)+' / '+count;
   previous.disabled=position===0;
   next.disabled=position===count-1;
  }
  sync();
  if(count>1){
   function go(delta){
    const target=Math.min(count-1,Math.max(0,position+delta));
    track.scrollTo({left:target*track.clientWidth,
     behavior:root.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
   }
   track.addEventListener('scroll',()=>{
    if(!track.clientWidth)return;
    const visible=Math.min(count-1,Math.max(0,Math.round(track.scrollLeft/track.clientWidth)));
    if(visible===position)return;
    position=visible;
    sync();
    onIndex(position);
   },{passive:true});
   previous.addEventListener('click',()=>go(-1));
   next.addEventListener('click',()=>go(1));
   viewport.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
     event.preventDefault();
     go(event.key==='ArrowLeft'?-1:1);
    }
   });
   if(position)root.requestAnimationFrame(()=>track.scrollTo({left:position*track.clientWidth,behavior:'instant'}));
  }
  return viewport;
 }
 function sellerAvatar(record){
  const avatar=el('span',{class:'market-seller-avatar','aria-hidden':'true'},
   el('span',{text:C.sellerInitials(record.sellerName)||'?'}));
  const show=src=>{
   const img=el('img',{src,alt:'',width:56,height:56,decoding:'async',onerror:()=>img.remove()});
   avatar.append(img);
  };
  if(record.sellerAvatarSrc)show(record.sellerAvatarSrc);
  else if(record.sellerAvatarId)showStoredPhoto(avatar,record.sellerAvatarId,show);
  return avatar;
 }
 return {photoSlot,photoCarousel,sellerAvatar};
}
function card(r,photoCarousel,save){
 const {root,slots}=template('market-card-template');
 slots.media.prepend(photoCarousel(r,'card'));
 if(save)slots.overlay.append(save);
 if(r.status==='sold'){
  slots.status.textContent=C.saleStatus(r);
  slots.status.hidden=false;
 }
 const title=C.displayTitle(r);
 slots.title.href=detailsUrl(r.id);
 slots.title.textContent=title;
 slots.title.title=title;
 const mileage=C.mileage(r.mileage);
 // An older cached template combines mileage and location in the facts slot.
 slots.facts.textContent=slots.location?mileage:mileage+' · '+r.place;
 if(slots.location){
  slots.location.textContent=r.place;
  slots.location.hidden=!r.place;
 }
 slots.price.textContent=C.money(r.price);
 const showTitle=r.titleStatus&&r.titleStatus!=='unknown';
 slots.titleStatus.hidden=!showTitle;
 if(showTitle)slots.titleStatus.textContent='Title: '+C.titleStatusLabel(r.titleStatus);
 root.dataset.search=[title,r.place,r.vehicle.body,r.vehicle.fuel,r.sellerName,r.exteriorColor,
  C.titleStatusLabel(r.titleStatus)].filter(Boolean).join(' ').toLowerCase();
 return root;
}
root.VinboxMarketComponents={heading,empty,field,section,disclosure,detailsHeader,conditionSection,
 sellerSection,vehicleSpecs,economyPanel,recallsPanel,createMedia,card,saveButton,setSaved,vinChoice,link,detailsUrl};
})(window);
