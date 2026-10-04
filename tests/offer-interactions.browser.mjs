// Run in a browser evaluator on a fresh /offer.html page at desktop and mobile sizes.
// This probe changes controls and restores their defaults; reload after verification.
export default async function verifyOfferInteractions() {
const $=s=>document.querySelector(s),checks={},wait=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(name,ok)=>{checks[name]=!!ok;if(!ok)throw Error(name);};
const input=(id,value)=>{const e=$('#'+id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
assert('four landed pack inputs',document.querySelectorAll('[data-cost]').length===4);
assert('shipping field removed',!$('#ship')&&!document.body.innerText.includes('Shipping per order'));
assert('bundle discount calculator removed',!$('#discount')&&!$('#bundlePanel')&&!document.body.innerText.includes('Build on this price'));
assert('all form inputs named',[...document.querySelectorAll('input,select')].every(e=>e.labels.length));
assert('default price from supplier quote',$('#selectedPrice').textContent==='$27.48');
const first=$('#selectedPrice').textContent;
const pack=$('[data-pack="2"]');pack.focus();pack.click();
assert('pack focus retained',document.activeElement===pack);
assert('bundle price from separate total',$('#selectedPrice').textContent==='$38.19');
assert('pack selection exposed',pack.getAttribute('aria-pressed')==='true');
input('c2','15.50');assert('editing bundle total recalculates',$('#selectedPrice').textContent!=='$38.19');
input('c2','');assert('blank optional pack disabled',pack.disabled);
assert('removing selected pack returns to single',$('[data-pack="1"]').getAttribute('aria-pressed')==='true'&&$('#selectedPrice').textContent===first);
input('c2','10.40');assert('adding pack re-enables selector',!pack.disabled);
const tier=$('[data-tier="1"]');tier.focus();tier.click();
assert('tier focus retained',document.activeElement===tier);assert('tier selection reflected',$('#tierName').textContent==='Good');
await wait(400);assert('result announced',$('#status').textContent.includes('Good price'));
$('[data-tier="0"]').click();
const previous=$('#selectedPrice').textContent;input('c1','-1');
assert('invalid input explained',!$('#inputError').hidden&&$('#c1').getAttribute('aria-invalid')==='true');
assert('invalid input holds previous result',$('#selectedPrice').textContent===previous);input('c1','7.40');
assert('valid input clears error',$('#inputError').hidden);
$('#settingsBtn').click();assert('settings disclosure opens',!$('#settingsPanel').hidden&&$('#settingsBtn').getAttribute('aria-expanded')==='true');
const boxes=[...document.querySelectorAll('.settings-grid > .field')].map(e=>e.getBoundingClientRect());
assert('cost settings never overlap',boxes.every((a,i)=>boxes.slice(i+1).every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)));
assert('cost settings fit their panel',boxes.every(b=>b.left>=$('#settingsPanel').getBoundingClientRect().left&&b.right<=$('#settingsPanel').getBoundingClientRect().right));
input('retPct','100');input('retLossPct','100');
assert('impossible margins handled',$('#offerState').textContent==='No price reaches this margin'&&!document.body.innerText.includes('NaN'));
input('retPct','8');input('retLossPct','25');$('#settingsBtn').click();
const theme=document.documentElement.dataset.theme;
$('#themeBtn').click();assert('theme changes',document.documentElement.dataset.theme!==theme);
assert('theme saved',localStorage.getItem('offerTheme')===document.documentElement.dataset.theme);
assert('toggle action labelled',$('#themeBtn').getAttribute('aria-label')==='Switch to '+theme+' mode');$('#themeBtn').click();
assert('no horizontal page overflow',document.documentElement.scrollWidth<=innerWidth);
return {checks,viewport:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme};
}
