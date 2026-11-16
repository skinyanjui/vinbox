/* Portable VINBOX saved-vehicle backup format. All imports are validated before mutation. */
(function(root){
'use strict';
const FORMAT='vinbox-saved',VERSION=1,MAX_VEHICLES=100,MAX_BYTES=2*1024*1024;
const fields=['ModelYear','Make','Model','Trim','BodyClass','DriveType','EngineCylinders','DisplacementL',
  'FuelTypePrimary','TransmissionStyle','PlantCountry','PlantCity','EngineModel','PlantState'];
const short=(value,max=180)=>typeof value==='string'?value.slice(0,max):'';
const validVin=vin=>typeof vin==='string'&&/^[A-HJ-NPR-Z0-9*]{6,17}$/.test(vin);
function cleanVehicle(v){
  if(!v||typeof v!=='object'||Array.isArray(v)||!validVin(v.vin))
    throw new Error('Backup has an invalid vehicle VIN.');
  if(typeof v.title!=='string'||!v.title.trim())throw new Error('Backup has a vehicle without a title.');
  if(!Array.isArray(v.groups)||!Array.isArray(v.facts)||!v.flat||typeof v.flat!=='object'||Array.isArray(v.flat))
    throw new Error('Backup contains invalid vehicle details.');
  if(v.groups.length>40||v.facts.length>30)throw new Error('Backup vehicle details exceed the safety limit.');
  const groups=v.groups.map(g=>{
    if(!g||typeof g.name!=='string'||!Array.isArray(g.rows)||g.rows.length>150)
      throw new Error('Backup contains invalid vehicle groups.');
    return {name:short(g.name,90),rows:g.rows.map(pair=>{
      if(!Array.isArray(pair)||pair.length!==2||pair.some(p=>typeof p!=='string'))
        throw new Error('Backup contains invalid vehicle fields.');
      return pair.map(p=>short(p,500));
    })};
  });
  const flat=Object.fromEntries(fields.map(key=>[key,short(v.flat[key],250)]).filter(([,v])=>v!==''));
  const id=Number(v.epaId);
  return {
    vin:v.vin,title:short(v.title),make:short(v.make),maker:short(v.maker),
    country:short(v.country),year:short(v.year,4),decoded:v.decoded===true,
    hasError:v.hasError===true,note:short(v.note,1800),suggested:short(v.suggested,40),
    facts:v.facts.map(x=>{if(typeof x!=='string')throw new Error('Backup has invalid facts.');return short(x,250);}),
    groups,flat,...(Number.isSafeInteger(id)&&id>0?{epaId:id}:{}),...(typeof v.epaModel==='string'&&v.epaModel.trim()?{epaModel:short(v.epaModel,120)}:{})
  };
}
function parse(text){
  if(typeof text!=='string'||text.length>MAX_BYTES)throw new Error('Backup file is too large.');
  let parsed;
  try{parsed=JSON.parse(text);}catch(e){throw new Error('Select a valid VINBOX JSON backup.');}
  if(!parsed||parsed.format!==FORMAT||parsed.version!==VERSION||!Array.isArray(parsed.vehicles))
    throw new Error('This file is not a supported VINBOX backup.');
  if(parsed.vehicles.length>MAX_VEHICLES)throw new Error('Backup exceeds the 100-vehicle limit.');
  const vehicles=parsed.vehicles.map(cleanVehicle);
  if(new Set(vehicles.map(v=>v.vin)).size!==vehicles.length)throw new Error('Backup contains duplicate VINs.');
  return vehicles;
}
function serialize(vehicles){
  if(!Array.isArray(vehicles)||vehicles.length>MAX_VEHICLES)throw new Error('Saved list exceeds 100 vehicles.');
  return JSON.stringify({format:FORMAT,version:VERSION,exportedAt:new Date().toISOString(),
    vehicles:vehicles.map(cleanVehicle)},null,2);
}
const canAdd=(vehicles,vin)=>vehicles.some(x=>x.vin===vin)||vehicles.length<MAX_VEHICLES;
const api={parse,serialize,cleanVehicle,canAdd,MAX_VEHICLES,MAX_BYTES};
root.VinboxBackup=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
