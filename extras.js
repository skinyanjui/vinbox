/* VINBOX saved-list controls and EPA presentation. Depends on VinEpa. */
(function(root){
'use strict';
function create({state,el,icon,render,save,SectionHead,download,toCsv,toast=()=>{}}){
  const EPA=root.VinEpa,Backup=root.VinboxBackup;
  const epa=new Map(),epaOpen=new Set(),epoch=new Map();
  const evidenceKeys=["ModelYear","Make","Model","Trim","BodyClass","DisplacementL","EngineCylinders","FuelTypePrimary","FuelTypeSecondary","ElectrificationLevel","TransmissionStyle","TransmissionSpeeds","DriveType","Turbo"];
  const evidenceKey=it=>JSON.stringify([it.decoded,it.hasError,...evidenceKeys.map(k=>String(it.flat?.[k]||''))]);
  const setEpa=(it,value)=>epa.set(it.vin,{...value,evidenceKey:evidenceKey(it)});
  const nextEpoch=vin=>{const id=(epoch.get(vin)||0)+1;epoch.set(vin,id);return id;};
  const isCurrent=(vin,id)=>epoch.get(vin)===id;
  let confirm=false,undo=null,undoTimer=null,pendingRestore=null;

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

  function restoreButton(){
    return el('button',{class:'btn sm ghost',onclick:()=>{
      root.document?.getElementById('saved-import')?.click();
    }},'Restore backup');
  }
  function backupDownload(){
    try{
      if(!Backup)throw new Error('Backup tool unavailable');
      const json=Backup.serialize(state.history);
      const url=URL.createObjectURL(new Blob([json],{type:'application/json;charset=utf-8'}));
      const a=el('a',{href:url,download:'vinbox-saved.json'});
      root.document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){toast(e.message||'Backup unavailable');}
  }
  async function importFile(file){
    if(!file)return;
    try{
      if(!Backup)throw new Error('Backup tool unavailable');
      if(file.size>Backup.MAX_BYTES)throw new Error('Backup file is too large.');
      const vehicles=Backup.parse(await file.text());
      pendingRestore={vehicles};
      confirm=false;
      discardUndo();
      render();
      root.document?.getElementById('restore-cancel')?.focus();
    }catch(e){toast(e.message||'Could not read backup.');}
  }
  function restoreSaved(){
    if(!pendingRestore)return;
    const before=state.history.slice(),target=pendingRestore.vehicles;
    state.history=target;
    if(!save()){state.history=before;render();return;}
    pendingRestore=null;confirm=false;state.makeOff.clear();
    offerUndo(before,'Restored '+target.length+' saved vehicle'+(target.length===1?'':'s')+'.');
    render();
  }
  function savedNotice(){
    const holder=el('div',{class:'saved-notices'});

    if(pendingRestore)holder.append(
      el('div',{class:'saved-confirm'},
        el('p',{text:'Replace '+state.history.length+' saved vehicle'+(state.history.length===1?'':'s')+
          ' with '+pendingRestore.vehicles.length+' from this backup? You can undo after restoring.'}),
        el('div',{class:'saved-confirm-actions'},
          el('button',{id:'restore-cancel',class:'btn sm',onclick:()=>{
            pendingRestore=null;render();
          }},'Cancel'),
          el('button',{class:'btn sm tinted',onclick:restoreSaved},'Restore saved vehicles'))));
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
      el('button',{class:'btn sm ghost',onclick:backupDownload},'Backup'),restoreButton(),clearAction());
  }
  function epaId(it){return it.epaId||epa.get(it.vin)?.data?.id||state.history.find(x=>x.vin===it.vin)?.epaId||null;}
  function keepSelection(it,id){
    const previous=it.epaId,previousModel=it.epaModel;
    const saved=state.history.find(h=>h.vin===it.vin);
    const savedPrevious=saved?.epaId,savedModel=saved?.epaModel;
    it.epaId=id;
    if(saved){
      saved.epaId=id;saved.epaModel=it.epaModel;
      if(!save()){
        it.epaId=previous;saved.epaId=savedPrevious;it.epaModel=previousModel;saved.epaModel=savedModel;
        toast('EPA match displayed but could not be saved on this device.');
      }
    }
  }
  async function selectEpa(it,id,method,expectedModel){
    const seq=nextEpoch(it.vin);
    setEpa(it,{status:'loading'});render();
    try{
      const raw=await EPA.vehicle(id);
      if(!isCurrent(it.vin,seq))return;
      const persistedModel=method==='saved'
        ?(it.epaModel||state.history.find(x=>x.vin===it.vin)?.epaModel)
        :null;
      const matchModel=expectedModel||persistedModel||raw.model;
      const check=EPA.assessVehicle(it,raw,matchModel);
      if(!check.compatible)
        throw new Error((check.reason||'EPA configuration conflicts with the decoded VIN.')+
          ' Choose another configuration.');
      const data=EPA.metrics(raw);
      if(expectedModel)it.epaModel=expectedModel;
      else if(method==='manual')it.epaModel='';
      epaOpen.add(it.vin);
      setEpa(it,{status:'ready',data,method});
      keepSelection(it,data.id);
    }catch(err){
      if(isCurrent(it.vin,seq))setEpa(it,{status:'error',message:err.message||'EPA unavailable'});
    }
    if(isCurrent(it.vin,seq))render();
  }
  async function loadEpa(it,ignoreSaved=false){
    if(epa.has(it.vin))return;
    const seq=nextEpoch(it.vin);
    setEpa(it,{status:'loading'});
    try{
      if(!EPA)throw new Error('EPA integration unavailable');
      const known=epaId(it);
      if(known&&!ignoreSaved){await selectEpa(it,known,'saved');return;}
      const found=ignoreSaved?await EPA.discover(it):await EPA.resolve(it);
      if(!isCurrent(it.vin,seq))return;
      if(found.status==='auto'){
        await selectEpa(it,found.id,'vin-auto',found.model);return;
      }
      epaOpen.add(it.vin);
      setEpa(it,found);
    }catch(err){
      if(isCurrent(it.vin,seq))setEpa(it,{status:'error',message:err.message||'EPA unavailable'});
    }
    if(isCurrent(it.vin,seq))render();
  }
  async function chooseModel(it,model){
    const old=epa.get(it.vin);if(old?.status!=='choose-model'||!model)return;
    const seq=nextEpoch(it.vin);
    setEpa(it,{status:'loading'});render();
    try{
      const found=await EPA.choices(old.year,old.make,model);
      if(!isCurrent(it.vin,seq))return;
      if(found.status==='choose-option'&&found.options.length===1){
        await selectEpa(it,found.options[0].value,'chosen-model',model);return;
      }
      setEpa(it,{...found,selectedModel:model});
    }catch(err){
      if(isCurrent(it.vin,seq))setEpa(it,{status:'error',message:err.message||'EPA unavailable'});
    }
    if(isCurrent(it.vin,seq))render();
  }
  function EpaPanel(it){
    const previous=epa.get(it.vin);
    if(previous&&previous.evidenceKey!==evidenceKey(it)){
      epa.delete(it.vin);
      nextEpoch(it.vin);
    }
    if(!epa.has(it.vin))loadEpa(it);
    const s=epa.get(it.vin)||{status:'loading'},body=el('div',{class:'recalls-body epa-body'});
    if(s.status==='loading')body.append(el('p',{class:'recalls-note',text:'Looking up EPA fuel economy…'}));
    else if(s.status==='choose-model'){
      body.append(el('p',{class:'recalls-note',text:s.message}),
        el('select',{'aria-label':'Select EPA model',onchange:e=>chooseModel(it,e.target.value)},
          el('option',{value:'',selected:'',disabled:''},'Select EPA model'),
          s.models.map(m=>el('option',{value:m.value},m.text))));
    }else if(s.status==='confirm-option'){
      body.append(el('p',{class:'recalls-note',text:'EPA reports a different engine or drivetrain than the VIN decoder. Confirm the actual vehicle configuration.'}),
        el('p',{text:s.label}),
        el('button',{class:'btn sm tinted',onclick:()=>selectEpa(it,s.id,'manual')},'Use this configuration'));
    }else if(s.status==='choose-option'){
      body.append(el('p',{class:'recalls-note',text:'Several EPA versions exist. Choose the engine and drivetrain matching your vehicle.'}),
        el('select',{'aria-label':'Select EPA configuration',onchange:e=>{
          if(e.target.value)selectEpa(it,e.target.value,'manual',s.selectedModel||s.model);
        }},el('option',{value:'',selected:'',disabled:''},'Choose configuration'),
          s.options.map(o=>el('option',{value:o.value},o.text))));
    }else if(s.status==='estimate'){
      const d=s.data;
      const fmt=r=>r?(r.min===r.max?String(r.min):r.min+'–'+r.max):'—';
      body.append(el('div',{class:'epa-metrics'},
        [['Combined',d.combined],['City',d.city],['Highway',d.highway]].map(([name,r])=>
          el('div',{class:'epa-metric'},el('strong',{text:fmt(r)}),
            el('span',{text:d.unit}),el('small',{text:name})))));
      const rows=[];
      if(d.yearlyCost){
        const price=n=>'$'+n.toLocaleString('en-US');
        rows.push(['Annual fuel cost',d.yearlyCost.min===d.yearlyCost.max?
          price(d.yearlyCost.min):price(d.yearlyCost.min)+'–'+price(d.yearlyCost.max)]);
      }
      if(d.kwhPer100)rows.push(['Electricity',fmt(d.kwhPer100)+' kWh / 100 mi']);
      if(d.electricRange)rows.push(['Electric range',fmt(d.electricRange)+' miles']);
      if(d.phevCombined)rows.push(['Plug-in combined',fmt(d.phevCombined)+' MPGe']);
      if(rows.length)body.append(el('dl',{class:'kv epa-facts'},
        rows.flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})])));
      body.append(el('p',{class:'recalls-note',text:
        (s.reason==='shared-rating'?'Same EPA ratings across ':'EPA-rated range across ')+
        d.variants+' compatible configurations. No exact EPA version has been inferred. '+
        'Annual cost uses EPA fuel prices and 15,000 miles per year.'}));
      body.append(el('div',{class:'epa-links'},
        el('button',{class:'btn sm ghost',onclick:()=>{
          epa.delete(it.vin);loadEpa(it,true);
        }},'Choose exact version'),
        el('a',{href:'https://www.fueleconomy.gov/',target:'_blank',rel:'noopener noreferrer'},'EPA source')));
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
        (s.method==='vin-auto'?'Matched automatically from the decoded VIN. ':s.method==='saved'?'Restored saved EPA configuration. ':'')+
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
      }},'Choose another / retry'));
      body.append(el('a',{href:'https://www.fueleconomy.gov/',target:'_blank',rel:'noopener noreferrer'},'Search FuelEconomy.gov'));
    }
    const tag=s.status==='estimate'?
      (s.data.combined.min===s.data.combined.max?String(s.data.combined.min):
        s.data.combined.min+'–'+s.data.combined.max)+' '+s.data.unit:
      s.status==='ready'?(s.data.combined==null?'EPA':s.data.combined+' '+s.data.unit):
      s.status==='choose-model'||s.status==='choose-option'||s.status==='confirm-option'?'Select version':
      s.status==='loading'?'Loading':s.status==='error'?'Unavailable':'No match';
    return el('details',{class:'recalls epa','data-epa-vin':it.vin,open:epaOpen.has(it.vin)||null,ontoggle:e=>{
      e.target.open?epaOpen.add(it.vin):epaOpen.delete(it.vin);
    }},el('summary',{id:'epa-toggle-'+it.vin,tabindex:0},el('span',{text:'Fuel economy'}),
      el('span',{class:'n'},el('span',{class:'badge',text:tag})),
      icon('chevron','chev')),body);
  }
  return {EpaPanel,epaId,afterToggle,savedHeader,savedNotice,clearSaved,undoSaved,importFile,restoreButton,backupDownload};
}
root.VinboxExtras=create;
if(typeof module!=='undefined')module.exports=create;
})(typeof window!=='undefined'?window:globalThis);
