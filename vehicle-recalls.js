/* Shared NHTSA model recall contract for scanner and marketplace. */
(function(root){
'use strict';
async function fetchModel({make,model,year},request=async url=>{
 const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('NHTSA recalls are temporarily unavailable.');
 return response;
}){
 const query=new URLSearchParams({make,model,modelYear:year});
 const response=await request('https://api.nhtsa.gov/recalls/recallsByVehicle?'+query);
 const data=await response.json();
 if(!Array.isArray(data.results))throw Error('NHTSA returned an invalid recall response.');
 const parse=s=>{
  const date=/(\d\d)\/(\d\d)\/(\d{4})/.exec(s||'');
  return date?date[3]+'-'+date[2]+'-'+date[1]:'';
 };
 return data.results.map(row=>({
  id:String(row.NHTSACampaignNumber||''),date:parse(row.ReportReceivedDate),
  component:String(row.Component||'').split(':')[0].toLowerCase().replace(/^\w/,char=>char.toUpperCase()),
  summary:String(row.Summary||''),consequence:String(row.Consequence||''),remedy:String(row.Remedy||''),
  parkIt:row.parkIt===true||row.parkIt==='True'
 })).sort((a,b)=>b.date.localeCompare(a.date));
}
const api={fetchModel};
if(typeof module!=='undefined')module.exports=api;
root.VinboxRecalls=api;
})(typeof window!=='undefined'?window:globalThis);
