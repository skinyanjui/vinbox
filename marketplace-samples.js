/* VINBOX Cars demonstration inventory. All sellers and offers are fictional. */
(function(root){
'use strict';
const media='marketplace-media/';
const sellers={
 morgan:{sellerName:'Morgan Ellis',sellerType:'private',sellerAvatarSrc:media+'morgan-ellis.webp'},
 river:{sellerName:'River Bend Motor Co.',sellerType:'dealership',sellerAvatarSrc:media+'river-bend.webp'},
 cameron:{sellerName:'Cameron Brooks',sellerType:'private'},
 orchard:{sellerName:'Orchard Lane Auto',sellerType:'dealership'}
};
const samples=[
 listing('camry',2022,'Toyota','Camry','SE','Sedan','Automatic','FWD','Gasoline',
  21900,48500,'Evansville, IN','good','clean',sellers.morgan),
 listing('f-150',2021,'Ford','F-150','XLT','Pickup truck','Automatic','4WD','Gasoline',
  29800,64000,'Henderson, KY','good','clean',sellers.river),
 listing('outback',2023,'Subaru','Outback','Premium','Wagon','Automatic','AWD','Gasoline',
  25900,32500,'Newburgh, IN','excellent','clean',sellers.river),
 listing('cx-5',2021,'Mazda','CX-5','Touring','Crossover SUV','Automatic','AWD','Gasoline',
  17450,71500,'Owensboro, KY','good','lien',sellers.cameron),
 listing('miata',2020,'Mazda','MX-5 Miata','Club','Convertible','Manual','RWD','Gasoline',
  21800,39200,'Evansville, IN','good','clean',sellers.morgan),
 listing('ioniq-5',2022,'Hyundai','Ioniq 5','SEL','Electric crossover SUV','Single-speed','RWD','Electric',
  23500,36400,'Boonville, IN','excellent','clean',sellers.orchard),
 listing('odyssey',2021,'Honda','Odyssey','EX-L','Minivan','Automatic','FWD','Gasoline',
  23900,65200,'Princeton, IN','good','clean',sellers.orchard),
 listing('mustang',2022,'Ford','Mustang','GT','Coupe','Manual','RWD','Gasoline',
  32900,25100,'Henderson, KY','excellent','clean',sellers.river),
 listing('transit',2021,'Ford','Transit','250','Cargo van','Automatic','RWD','Gasoline',
  24750,89200,'Madisonville, KY','good','clean',sellers.orchard),
 listing('wrangler',2020,'Jeep','Wrangler','Unlimited Sport','Off-road SUV','Automatic','4WD','Gasoline',
  18800,81300,'Mount Vernon, IN','fair','rebuilt',sellers.cameron)
];
function listing(slug,year,make,model,trim,body,transmission,drive,fuel,
 price,mileage,place,condition,titleStatus,seller){
 return {id:'sample-'+slug,sample:true,vehicle:{year,make,model,trim,body,transmission,drive,fuel},
  photoSources:[media+slug+'.webp'],price:String(price),mileage:String(mileage),place,condition,titleStatus,...seller};
}
if(typeof module!=='undefined')module.exports=samples;
root.VinboxMarketSamples=samples;
})(typeof window!=='undefined'?window:globalThis);
