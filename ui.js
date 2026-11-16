/* VINBOX DOM components and native template cloning. */
(function(root){
'use strict';
function el(tag,attrs={},...children){
 const node=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs)){
  if(key==='text')node.textContent=value;
  else if(key==='value')node.value=value;
  else if(key==='checked')node.checked=Boolean(value);
  else if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2),value);
  else if(value!=null&&(value!==false||key.startsWith('aria-')))node.setAttribute(key,String(value));
 }
 for(const child of children.flat(Infinity)){
  if(child!=null&&child!==false)node.append(child.nodeType?child:String(child));
 }
 return node;
}
function template(id){
 const root=document.getElementById(id).content.firstElementChild.cloneNode(true);
 const slots=Object.fromEntries([...root.querySelectorAll('[data-slot]')].map(node=>[node.dataset.slot,node]));
 return {root,slots};
}
root.VinboxUI={el,template};
})(window);
