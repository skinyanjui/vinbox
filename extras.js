/* VINBOX saved-list controls and EPA presentation. Depends on VinEpa. */
(function(root){
'use strict';
function create({state,el,icon,render,save,SectionHead,download,toCsv}){
  const EPA=root.VinEpa;
  const epa=new Map(),epaOpen=new Set();
  let confirm=false,undo=null,undoTimer=null;

  function discardUndo(){
    clearTimeout(undoTimer);undoTimer=null;undo=null;
  }
  function offerUndo(records,message){
    discardUndo();
    undo={records,message};
    undoTimer=setTimeout(()=>{undo=null;undoTimer=null;render();},8000);
  }
  function afterToggle(previous,removed){
    if(removed)offerUndo(previous,'Vehicle removed from saved.');
    else discardUndo();
    confirm=false;
  }
  function undoSaved(){
    if(!undo)return;
    const old=state.history;
    state.history=undo.records;
    if(!save()){state.history=old;render();return;}
    discardUndo();state.makeOff.clear();render();
  }
  function clearSaved(){
    const before=state.history.slice();
    if(!before.length)return;
    state.history=[];
    if(!save()){state.history=before;render();return;}
    confirm=false;state.makeOff.clear();
    offerUndo(before,'Removed '+before.length+' saved vehicle'+(before.length===1?'':'s')+'.');
    render();
  }
  function clearAction(){
    return el('button',{id:'saved-clear-all',class:'btn sm ghost',onclick:()=>{
      discardUndo();confirm=true;render();
      root.document?.getElementById('saved-clear-cancel')?.focus();
    }},icon('trash'),'Clear all');
  }
  function savedNotice(){
    const holder=el('div',{class:'saved-notices'});
    if(confirm&&state.history.length)holder.append(
      el('div',{class:'saved-confirm'},
        el('p',{text:'Remove all '+state.history.length+' saved vehicles from this device?'}),
        el('div',{class:'saved-confirm-actions'},
          el('button',{id:'saved-clear-cancel',class:'btn sm',onclick:()=>{
            confirm=false;render();root.document?.getElementById('saved-clear-all')?.focus();
          }},'Cancel'),
          el('button',{class:'btn sm danger',onclick:clearSaved},'Remove all'))));
    if(undo)holder.append(el('div',{class:'saved-feedback',role:'status'},
      el('span',{text:undo.message}),
      el('button',{class:'btn sm tinted',onclick:undoSaved},'Undo')));
    return holder;
  }
  function savedHeader(shown){
    return SectionHead(state.history.length+' saved',
      el('button',{class:'btn sm',onclick:()=>download('saved-vins.csv',toCsv(shown))},icon('download'),'Export CSV'),
      clearAction());
  }
  function epaId(it){return it.epaId||epa.get(it.vin)?.data?.id||null;}
  function keepSelection(it,id){
    const previous=it.epaId;
    const saved=state.history.find(h=>h.vin===it.vin);
    const savedPrevious=saved?.epaId;
    it.epaId=id;
    if(saved){
      saved.epaId=id;
      if(!save()){
        it.epaId=previous;saved.epaId=savedPrevious;
      }
    }
  }
  async function selectEpa(it,id,method){
    epa.set(it.vin,{status:'loading'});render();
    try{
      const raw=await EPA.vehicle(id),f=EPA.carFields(it);
      if(Number(raw.year)!==f.year||!EPA.match(f.make,[{text:raw.make,value:raw.make}]).length)
        throw new Error('EPA record does not match the decoded model year and make.');
      const data=EPA.metrics(raw);
      epa.set(it.vin,{status:'ready',data,method});
      keepSelection(it,data.id);
    }catch(err){epa.set(it.vin,{status:'error',message:err.message||'EPA unavailable'});}
    render();
  }
  async function loadEpa(it,ignoreSaved=false){
    if(epa.has(it.vin))return;
    epa.set(it.vin,{status:'loading'});
    try{
      if(!EPA)throw new Error('EPA integration unavailable');
      if(it.epaId&&!ignoreSaved){await selectEpa(it,it.epaId,'saved');return;}
      const found=await EPA.discover(it);
      if(found.status==='choose-option'&&found.options.length===1){
        await selectEpa(it,found.options[0].value,'single-option');return;
      }
      epa.set(it.vin,found);
    }catch(err){epa.set(it.vin,{status:'error',message:err.message||'EPA unavailable'});}
    render();
  }
  async function chooseModel(it,model){
    const old=epa.get(it.vin);if(old?.status!=='choose-model'||!model)return;
    epa.set(it.vin,{status:'loading'});render();
    try{
      const found=await EPA.choices(old.year,old.make,model);
      if(found.status==='choose-option'&&found.options.length===1){
        await selectEpa(it,found.options[0].value,'chosen-model');return;
      }
      epa.set(it.vin,found);
    }catch(err){epa.set(it.vin,{status:'error',message:err.message||'EPA unavailable'});}
    render();
  }
  function EpaPanel(it){
    if(!epa.has(it.vin))loadEpa(it);
    const s=epa.get(it.vin)||{status:'loading'},body=el('div',{class:'recalls-body epa-body'});
    if(s.status==='loading')body.append(el('p',{class:'recalls-note',text:'Looking up EPA fuel economy…'}));
    else if(s.status==='choose-model'){
      body.append(el('p',{class:'recalls-note',text:s.message}),
        el('select',{'aria-label':'Select EPA model',onchange:e=>chooseModel(it,e.target.value)},
          el('option',{value:'',selected:'',disabled:''},'Select EPA model'),
          s.models.map(m=>el('option',{value:m.value},m.text))));
    }else if(s.status==='choose-option'){
      body.append(el('p',{class:'recalls-note',text:'Several EPA versions exist. Choose the engine and drivetrain matching your vehicle.'}),
        el('select',{'aria-label':'Select EPA configuration',onchange:e=>{
          if(e.target.value)selectEpa(it,e.target.value,'manual');
        }},el('option',{value:'',selected:'',disabled:''},'Choose configuration'),
          s.options.map(o=>el('option',{value:o.value},o.text))));
    }else if(s.status==='ready'){
      const d=s.data;
      body.append(el('div',{class:'epa-metrics'},
        [['Combined',d.combined],['City',d.city],['Highway',d.highway]].map(([name,n])=>
          el('div',{class:'epa-metric'},el('strong',{text:n==null?'—':n}),
            el('span',{text:d.unit}),el('small',{text:name})))));
      const rows=[];
      if(d.yearlyCost!=null)rows.push(['Annual fuel cost','$'+d.yearlyCost.toLocaleString('en-US')]);
      if(d.phevCombined!=null)rows.push(['Plug-in combined',d.phevCombined+' MPGe']);
      if(d.kwhPer100!=null)rows.push(['Electricity',d.kwhPer100+' kWh / 100 mi']);
      if(d.electricRange!=null)rows.push(['Electric range',d.electricRange+' miles']);
      if(d.ghgScore!=null)rows.push(['GHG score',d.ghgScore+' / 10']);
      if(rows.length)body.append(el('dl',{class:'kv epa-facts'},
        rows.flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})])));
      body.append(el('p',{class:'recalls-note',text:
        (d.configuration||[d.year,d.make,d.model].filter(Boolean).join(' '))+
        '. US-market EPA estimate; not proof of the VIN-specific configuration. Annual cost assumes 15,000 miles and EPA fuel prices.'}));
      body.append(el('div',{class:'epa-links'},
        el('button',{class:'btn sm ghost',onclick:()=>{
          epa.delete(it.vin);loadEpa(it,true);
        }},'Change configuration'),
        el('a',{href:'https://www.fueleconomy.gov/',target:'_blank',rel:'noopener noreferrer'},'EPA source')));
    }else{
      body.append(el('p',{class:'recalls-note',text:s.message||'No EPA estimate available.'}));
      if(s.status==='error')body.append(el('button',{class:'btn sm',onclick:()=>{
        epa.delete(it.vin);loadEpa(it,true);
      }},'Retry'));
      body.append(el('a',{href:'https://www.fueleconomy.gov/',target:'_blank',rel:'noopener noreferrer'},'Search FuelEconomy.gov'));
    }
    const tag=s.status==='ready'?(s.data.combined==null?'EPA':s.data.combined+' '+s.data.unit):
      s.status==='choose-model'||s.status==='choose-option'?'Select version':
      s.status==='loading'?'Loading':s.status==='error'?'Unavailable':'No match';
    return el('details',{class:'recalls epa',open:epaOpen.has(it.vin)||null,ontoggle:e=>{
      e.target.open?epaOpen.add(it.vin):epaOpen.delete(it.vin);
    }},el('summary',{},el('span',{text:'Fuel economy'}),
      el('span',{class:'n'},el('span',{class:'badge',text:tag})),
      icon('chevron','chev')),body);
  }
  return {EpaPanel,epaId,afterToggle,savedHeader,savedNotice,clearSaved,undoSaved};
}
root.VinboxExtras=create;
if(typeof module!=='undefined')module.exports=create;
})(typeof window!=='undefined'?window:globalThis);
