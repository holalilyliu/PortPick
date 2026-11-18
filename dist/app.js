'use strict';
const C = window.PORTPICK_CATALOG, E = window.PortPick;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number.isFinite(n) ? 'CNY ' + n.toFixed(2) : '未記錄';
const mode = 'stage1';
const prefix = 'portpick-stage1:', sessionKey = prefix + 'account', orderPrefix = prefix + 'order:';
const uid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(3)), n=>n.toString(36)).join('-');
const normal = name => String(name || '').normalize('NFKC').trim().toLowerCase();
const timeText = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('zh-HK', {timeZone:'Asia/Hong_Kong',hour12:false}) : '未記錄';
const bookingISO = s => new Date(s + ':00+08:00').toISOString();
const hkNow = () => new Date(Date.now() + 28800000).toISOString().slice(0,16);
function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : JSON.parse(raw);
}
let account = sessionStorage.getItem(sessionKey) || '';
let category='全部', sort='recommended', study=null, toastTimer, selectedOrder=null;
let legacySessionOrders=[], legacyV1=[], accountSequence=0;
const draftKey = () => prefix + (account ? 'draft:'+account : 'guest-draft');
function loadDraft() {
  return Object.assign({store:'futian',port:E.routes(C.stores[0],C.ports)[0].id,cart:[],campus:'',studies:[],draftId:uid()}, readJSON(draftKey(),{}));
}
let state = loadDraft();
function save() { localStorage.setItem(draftKey(), JSON.stringify(state)); }
function toast(message, success=false) {
  $('toast').textContent=(success?'✓ ':'')+message; $('toast').classList.toggle('success',success);
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);
}
function open(id) { if (!$(id).open) $(id).showModal(); }
document.querySelectorAll('[data-close]').forEach(button => button.onclick=()=>button.closest('dialog').close());
function track(event, details={}) {
  if (study) study.events.push({event,...details,at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-study.started)/1000)});
}
function stageOrders() {
  return Object.keys(localStorage).filter(k=>k.startsWith(orderPrefix)).map(k=>readJSON(k,null)).filter(o=>o?.schema==='stage1');
}
function remaining(p, store=state.store) {
  let reserved=0;
  for (const order of stageOrders()) if (order.quote.store.id===store)
    for (const line of order.quote.lines) if (line.productId===p.id) reserved+=line.units*line.quantity;
  return Math.max(0,p.stock[store]-reserved);
}
function checkCart(cart, store=state.store) {
  const q=E.quote(C,store,state.port,cart), counts=new Map();
  for (const line of q.lines) counts.set(line.productId,(counts.get(line.productId)||0)+line.quantity*line.units);
  for (const [id,units] of counts) {
    const product=C.products.find(p=>p.id===id);
    if (units>remaining(product,store)) throw Error(product.name+' 在所選門店的庫存不足');
  }
  return q;
}
let googleMap=null, mapMarkers=[];
function renderStoreCards(routes,selected){const root=$('store-cards');root.innerHTML=C.stores.map(store=>{const best=E.routes(store,C.ports)[0];const chosen=store.id===state.store;return `<button class="store-card ${chosen?'selected':''}" data-store-card="${esc(store.id)}"><span class="store-icon">▣</span><span><strong>${esc(store.id==='futian'?"Sam's Club Futian":"Sam's Club Qianhai")}</strong><b>${esc(store.name)}</b><small>${store.address||'地址未記錄'}</small><small>${best.name} · ${best.km.toFixed(1)} km 直線</small>${store.id===state.store?'<em>目前選中 · 推薦口岸 '+esc(best.name)+'</em>':''}</span>${chosen?'<i>✓</i>':''}</button>`}).join('');root.querySelectorAll('[data-store-card]').forEach(b=>b.onclick=()=>{const id=b.dataset.storeCard;try{checkCart(state.cart,id);state.store=id;state.port=E.routes(C.stores.find(s=>s.id===id),C.ports)[0].id;save();route();renderProducts();}catch(e){toast(e.message);}});}
function updateMap(routes,selected){if(!googleMap)return;const store=C.stores.find(s=>s.id===state.store),port=C.ports.find(p=>p.id===state.port);mapMarkers.forEach(m=>m.setMap(null));mapMarkers=[];const bounds=new google.maps.LatLngBounds();for(const item of [...C.stores,...C.ports]){const marker=new google.maps.Marker({map:googleMap,position:{lat:item.lat,lng:item.lng},title:item.name,icon:item.id===store.id?'https://maps.google.com/mapfiles/ms/icons/green-dot.png':undefined});mapMarkers.push(marker);bounds.extend(marker.getPosition());}mapMarkers.push(new google.maps.Polyline({map:googleMap,path:[{lat:store.lat,lng:store.lng},{lat:port.lat,lng:port.lng}],geodesic:true,strokeColor:'#566848',strokeWeight:4}));const info=new google.maps.InfoWindow({content:`<strong>${esc(port.name)}</strong><br>${selected.km.toFixed(1)} km · 直線距離`,position:{lat:(store.lat+port.lat)/2,lng:(store.lng+port.lng)/2}});info.open({map:googleMap});mapMarkers.push(info);googleMap.fitBounds(bounds);}
window.initPortPickMap=()=>{const key=window.PORTPICK_MAPS_API_KEY||C.googleMapsApiKey;if(!key){$('map-config-note').hidden=false;return;}googleMap=new google.maps.Map($('store-map'),{center:{lat:22.53,lng:114.01},zoom:11,mapTypeControl:false,streetViewControl:false});$('map-config-note').hidden=true;route();};
function route() {
  if($('store')) $('store').value=state.store; $('port').value=state.port;
  $('route-price').textContent=C.stores.find(s=>s.id===state.store).name+' 採購';
  const routes=E.routes(C.stores.find(s=>s.id===state.store),C.ports);
  const selected=routes.find(p=>p.id===state.port);
  $('port').innerHTML=options(routes.map((p,i)=>({...p,name:p.name+(i===0?' · 推薦':'')})),state.port);
  $('route-description').textContent=selected.name+' · 約 '+selected.km.toFixed(1)+' km，直線距離';
  renderStoreCards(routes,selected); updateMap(routes,selected);
  const count=state.cart.reduce((sum,l)=>sum+l.quantity,0);
  $('cart-count').textContent=count; $('floating-cart-count').textContent=count;
  $('cart-open').setAttribute('aria-label','打開購物車，目前共 '+count+' 件商品'); $('floating-cart').setAttribute('aria-label','打開購物袋，目前共 '+count+' 件商品');
  $('bag-count').textContent=count+' 件商品';
  $('bag-total').textContent=fmt(E.quote(C,state.store,state.port,state.cart).total);
  $('account-label').textContent=account ? account+' · 切換帳號' : '登入演示帳號';
}
function breakdown(q) {
  const rate=Number.isFinite(q.rateBps)?'（'+q.rateBps/100+'%）':'';
  return '<div class="summary">'+[['商品小計',q.product],['服務費'+rate,q.service],['分裝費',q.packaging],['合計',q.total]]
    .map(([label,value],i)=>'<div class="'+(i===3?'total':'')+'"><span>'+label+'</span><strong>'+fmt(value)+'</strong></div>').join('')+'</div>';
}
function options(list,selected) {
  return list.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(x.name)+'</option>').join('');
}
$('store').innerHTML=options(C.stores,state.store);
$('port').innerHTML=options(C.ports,state.port);
$('store').onchange=()=>{
  try { checkCart(state.cart,$('store').value);state.store=$('store').value;state.port=E.routes(C.stores.find(x=>x.id===state.store),C.ports)[0].id;save();renderProducts(); }
  catch(e){toast(e.message);}
  route();
};
$('port').onchange=()=>{state.port=$('port').value;save();route();};
function art(p, thumbnail=false){return `<div class="art ${esc(p.art)}" style="--tone:${esc(p.color)}">${thumbnail?'':'<span class="stock">可選示例庫存 '+remaining(p)+' '+esc(p.unit)+'</span>'}<div class="pack"><small>PORTPICK</small><b>${esc(p.english)}</b><small>EVERYDAY GOODS</small></div></div>`;}
function renderCategories(){const cats=['全部',...new Set(C.products.map(p=>p.category))];$('categories').innerHTML=cats.map(c=>`<button data-category="${c}" class="${c===category?'active':''}" aria-pressed="${c===category}">${c}</button>`).join('');$('categories').querySelectorAll('button').forEach(b=>b.onclick=()=>{category=b.dataset.category;renderCategories();renderProducts();});}
const searchAliases={water:'天然饮用水 饮品 drinks',oat:'燕麦饮 饮品 drinks',cereal:'蜂蜜燕麦谷物 早餐与零食 snacks',noodles:'独立包装面食 早餐与零食 snacks',towels:'厨房纸巾 家居用品 household',detergent:'浓缩洗衣液 家居用品 household',coffee:'研磨咖啡 早餐与零食 snacks',shampoo:'日常洗发水 个人护理 personal care',almonds:'烘焙杏仁 早餐与零食 snacks',tissues:'柔软面纸 家居用品 household',chips:'海盐薯片 早餐与零食 snacks',soap:'洗手液补充装 个人护理 personal care'};
$('search').oninput=()=>renderProducts();
function renderProducts(){const query=$('search').value.trim().toLowerCase();
 const collator=new Intl.Collator('zh-Hant',{usage:'search',sensitivity:'base'});
 const match=text=>Array.from(text).some((_,i)=>collator.compare(text.slice(i,i+query.length),query)===0);
 let list=C.products.filter(p=>(category==='全部'||p.category===category)&&(!query||
   [p.name,p.english,p.category,searchAliases[p.id]].some(text=>text&&match(text))) && (!query||remaining(p)>0));
 $('results').textContent=list.length+' 款商品';const low=p=>E.money(p.price*p.sizes[0]/p.packUnits);if(sort!=='recommended')list.sort((a,b)=>(low(a)-low(b))*(sort==='asc'?1:-1));$('products').innerHTML=list.map(p=>`<article class="product-card">${art(p)}<h3>${p.name}</h3><p>${p.english}</p><p>${p.sizes.join(' / ')} 個完整單位 · ${p.unit}</p><div class="product-bottom"><strong>${fmt(low(p))}<small> 起</small></strong><button data-product="${p.id}" ${remaining(p)===0?'disabled':''}>${remaining(p)?'選擇規格 ＋':'此店暫無示例庫存'}</button></div></article>`).join('') || '<div class="empty">此門店沒有符合的商品。<br><button id="clear-search" class="button light">清除搜尋</button></div>';
 $('clear-search')?.addEventListener('click',()=>{$('search').value='';renderProducts();$('search').focus();});
 $('products').querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>showProduct(b.dataset.product));}
$('sort').onchange=()=>{sort=$('sort').value;renderProducts();};
function showProduct(id){const p=C.products.find(x=>x.id===id);track('product_viewed',{product:id});$('product-detail').innerHTML=`<p class="eyebrow">SEALED UNITS ONLY</p><h2>${p.name}</h2><p class="muted">${p.english} · 示例商品，非已核實的山姆商品清單</p><div class="detail-art">${art(p)}</div><div class="form-grid"><label>完整單位組合<select id="detail-units">${p.sizes.map(n=>`<option value="${n}">${n} × ${p.unit} · ${fmt(E.money(p.price*n/p.packUnits))}</option>`).join('')}</select></label><label>外包裝<select id="detail-package">${C.packaging.map(x=>`<option value="${x.id}">${x.name} · ${fmt(x.fee)}</option>`).join('')}</select></label></div><p class="fine">不打開原廠密封包裝；拆售完整單位的供應安排仍待確認。價格按示例原包價格分攤。</p><div id="detail-total"></div><button class="button dark" id="detail-add">加入購物袋 ＋</button><p class="fine">服務費按整單商品小計計算。入境資格需自行逐項查閱官方資訊。</p>`;
 const update=()=>{const price=E.money(p.price*Number($('detail-units').value)/p.packUnits),pack=C.packaging.find(x=>x.id===$('detail-package').value);$('detail-total').innerHTML=`<p>此規格 ${fmt(price+pack.fee)} <span class="fine">（未含整單服務費）</span></p>`;};$('detail-units').onchange=update;$('detail-package').onchange=update;update();$('detail-add').onclick=()=>{try {const units=Number($('detail-units').value),packaging=$('detail-package').value;if(!p.sizes.includes(units)||!C.packaging.some(x=>x.id===packaging))throw Error('商品規格無效');const next=E.add(state.cart,{productId:id,units,packaging});checkCart(next);state.cart=next;save();route();track('cart_added',{product:id});$('product-dialog').close();toast('商品已加入購物車',true);}catch(e){toast(e.message);}};open('product-dialog');}

function renderCart() {
  const q=E.quote(C,state.store,state.port,state.cart);
  const rows=q.lines.map((l,i)=>{
    const product=C.products.find(p=>p.id===l.productId);
    const sizes=product.sizes.map(n=>({id:String(n),name:n+' × '+product.unit}));
    return `<div class="cart-line"><div><h3>${esc(l.name)}</h3><div class="order-choices">
      <label>份量<select data-size="${i}">${options(sizes,String(l.units))}</select></label>
      <label>分裝選項<select data-pack="${i}">${options(C.packaging,l.packaging)}</select></label>
      </div><p>所選份量單價 ${fmt(l.unitPrice)} · 每組分裝費 ${fmt(l.packagingUnitPrice)}</p></div>
      <div class="quantity"><button data-delta="-1" data-line="${i}" aria-label="減少數量">−</button>${l.quantity}
      <button data-delta="1" data-line="${i}" aria-label="增加數量">＋</button>
      <button data-line="${i}" data-remove aria-label="移除商品">×</button></div></div>`;
  }).join('');
  $('cart-content').innerHTML=(rows||'<p class="empty">購物袋是空的。請先選擇商品。</p>')+breakdown(q)+
    `<fieldset class="campus-card"><legend>選擇香港校園自提點</legend>
    ${C.stage1.campuses.map(c=>`<label class="choice"><input type="radio" name="campus" value="${esc(c.id)}" ${state.campus===c.id?'checked':''}>
      <span><strong>${esc(c.name)}</strong><small>${esc(c.location)}</small>${c.simulated?'<em>模擬自提點</em>':''}</span></label>`).join('')}
    <p id="campus-note" role="status">${state.campus?'':'請選擇自提點'}</p></fieldset>
    <p>採購門店 · ${esc(q.store.name)}</p>${thresholdNote(q)}
    <p id="cart-error" role="alert" class="error"></p>
    <button id="review" class="button dark" ${!q.lines.length||q.threshold.shortHKD?'disabled':''}>核對費用並結賬 →</button>`;
  document.querySelectorAll('[name=campus]').forEach(radio=>radio.onchange=()=>{
    state.campus=radio.value;save();$('campus-note').textContent='';
  });
  function update(i,change) {
    const next=state.cart.map(l=>({...l}));
    Object.assign(next[i],change);
    const kept=next.filter(l=>l.quantity>0);
    try {checkCart(kept);state.cart=kept;save();route();renderCart();}
    catch(e){renderCart();$('cart-error').textContent=e.message;}
  }
  $('cart-content').querySelectorAll('[data-size]').forEach(b=>b.onchange=()=>update(+b.dataset.size,{units:+b.value}));
  $('cart-content').querySelectorAll('[data-pack]').forEach(b=>b.onchange=()=>update(+b.dataset.pack,{packaging:b.value}));
  $('cart-content').querySelectorAll('[data-line]').forEach(b=>b.onclick=()=>update(+b.dataset.line,{
    quantity:b.hasAttribute('data-remove')?0:state.cart[+b.dataset.line].quantity+Number(b.dataset.delta)}));
  $('review').onclick=()=>{
    if(!C.stage1.campuses.some(c=>c.id===state.campus)){ $('campus-note').textContent='請先選擇香港校園自提點。';document.querySelector('[name=campus]')?.focus();return;}
    if(!account){showAccount(true);return;}
    try {showReview();} catch(e){$('cart-error').textContent=e.message;}
  };
}
$('cart-open').onclick=()=>{renderCart();open('cart-dialog');track('cart_opened');};
$('floating-cart').onclick=()=>$('cart-open').click(); $('bottom-cart').onclick=()=>$('cart-open').click();
const payments=['微信支付','支付寶','AlipayHK','銀聯／銀行卡'];
function thresholdNote(q){
  const t=q.threshold;
  return `<div class="threshold"><p>商品小計 ${fmt(q.product)} ≈ HKD ${t.subtotalHKD.toFixed(2)}</p>
    <small>課堂演示匯率 · 1 CNY = ${Number(t.rate).toFixed(Math.max(2,String(t.rate).split('.')[1]?.length||0))} HKD</small>
    <strong>${t.shortHKD?'未達到起送金額 HKD '+t.minimumHKD.toFixed(2)+'，還差 HKD '+t.shortHKD.toFixed(2)+'。':'已達起送門檻 HKD '+t.minimumHKD.toFixed(2)}</strong></div>`;
}
let selectedDeliveryMode='asap', selectedDeliveryStart=null;
function showReview() {
  const q=checkCart(state.cart), campus=C.stage1.campuses.find(x=>x.id===state.campus);
  if(!q.lines.length||!campus||q.threshold.shortHKD)throw Error('請確認商品與校園自提點');
  const owner=account, draft=state.draftId, snapshot=JSON.stringify(q);
  $('cart-dialog').close();
  selectedDeliveryMode='asap'; selectedDeliveryStart=null; const delivery=E.deliverySlots();
  $('review-content').innerHTML=`<h2>確認費用並下單</h2><p>${esc(q.store.name)} 採購 → <strong>${esc(campus.name)}</strong></p><section class="delivery-picker"><h3>Delivery Time / 預計送達時間</h3><p class="fine">預計到達所選校園自提點或預約到點時間，不代表送到宿舍。時間僅供課堂演示參考。</p><div class="delivery-modes"><label class="choice"><input type="radio" name="delivery-mode" value="asap" checked><span><strong>盡快送達 · 預計約 5 小時</strong><small id="asap-estimate"></small></span></label><label class="choice"><input type="radio" name="delivery-mode" value="scheduled"><span><strong>預約送達</strong><small>選擇日期與 30 分鐘時段</small></span></label></div><p id="after-hours-note" class="alert" hidden>目前不在服務時段，預計次日送達。</p><div id="schedule-panel" hidden></div><p id="delivery-summary"></p><p class="fine">預計時間僅供課堂演示參考，並非實際物流承諾。</p></section>
    <section class="checkout-items" aria-label="商品明細">${q.lines.map(l=>`<article class="checkout-item"><div class="checkout-thumb" aria-hidden="true">${l.image?.art?art(l.image,true):'<span>▧</span>'}</div><div class="checkout-item-info"><details class="checkout-item-name"><summary>${esc(l.name)}</summary><div>${esc(l.name)}</div></details><p>規格：${l.units} × ${esc(l.unit)}</p><p>數量：${l.quantity}</p><p>分裝：${esc(l.packagingName||'未記錄')}</p></div><strong class="checkout-item-price">${fmt(l.productAmount)}</strong></article>`).join('')}</section>
    ${breakdown(q)}${thresholdNote(q)}<fieldset class="payment"><legend>付款方式 · 課堂模擬支付</legend>
    ${payments.map((p,i)=>`<label class="choice"><input type="radio" name="payment" value="${p}" ${i===0?'checked':''}><span>${p}</span></label>`).join('')}</fieldset><p class="fine">演示帳號 ${esc(account)} · 課堂模擬付款</p>
    <p id="checkout-error" role="alert" class="error"></p><div class="inline-buttons"><button id="confirm-order" class="button dark">確認模擬付款並下單</button><button id="edit-cart" class="button light">返回購物袋</button></div>`;
  const renderDelivery=()=>{const choices=E.deliverySlots();const mode=document.querySelector('[name=delivery-mode]:checked')?.value||'asap';selectedDeliveryMode=mode;const asap=choices.asap;const asapText=asap?timeText(asap.start):'未來 7 天內無可用時段';$('asap-estimate').textContent='預計 '+asapText+(choices.afterHours?' · 次日服務時段':'');$('after-hours-note').hidden=!choices.afterHours;const panel=$('schedule-panel');if(mode==='scheduled'){const days=[...new Set(choices.slots.map(x=>x.date))];const chosen=choices.slots.find(x=>x.start===selectedDeliveryStart)||choices.slots[0];selectedDeliveryStart=chosen?.start||null;panel.hidden=false;panel.innerHTML=`<label>選擇日期<select id="delivery-date">${days.map((d,i)=>`<option value="${d}" ${chosen?.date===d?'selected':''}>${i===0?'今天':i===1?'明天':d}</option>`).join('')}</select></label><div class="delivery-slots">${choices.slots.filter(x=>x.date===chosen?.date).map(x=>`<button type="button" data-slot="${x.start}" class="slot ${x.start===selectedDeliveryStart?'selected':''}">${timeText(x.start).split(' ')[1]}–${timeText(x.end).split(' ')[1]}</button>`).join('')}</div>`;panel.querySelector('#delivery-date').onchange=e=>{const next=choices.slots.find(x=>x.date===e.target.value);selectedDeliveryStart=next?.start||null;renderDelivery();};panel.querySelectorAll('[data-slot]').forEach(b=>b.onclick=()=>{selectedDeliveryStart=b.dataset.slot;renderDelivery();});}else panel.hidden=true;const chosen=mode==='asap'?asap:choices.slots.find(x=>x.start===selectedDeliveryStart);$('delivery-summary').textContent='下單時間 · '+timeText(new Date().toISOString())+'　預計到點 · '+(chosen?timeText(chosen.start):'請選擇可用時段');};document.querySelectorAll('[name=delivery-mode]').forEach(r=>r.onchange=renderDelivery);renderDelivery();
  $('edit-cart').onclick=()=>{$('review-dialog').close();renderCart();open('cart-dialog');};
  $('confirm-order').onclick=async()=>{
    const button=$('confirm-order');if(!button||button.disabled)return;button.disabled=true;
    const payment=document.querySelector('[name=payment]:checked')?.value;
    try {
      const submit=()=>{
        if(account!==owner || !owner || state.draftId!==draft)throw Error('帳號或購物袋已更改，請重新確認');
        const existing=readJSON(orderPrefix+draft,null);
        if(existing?.owner===owner)return existing;
        const checked=checkCart(state.cart);
        if(checked.threshold.shortHKD || !payments.includes(payment))throw Error('請核對門檻及付款方式');
        if(JSON.stringify(checked)!==snapshot||state.campus!==campus.id)throw Error('購物資料已更新，請重新確認');
        const deliveryInfo=E.deliverySelection(selectedDeliveryMode,new Date(),selectedDeliveryStart); const at=deliveryInfo.orderedAt;
        const order={schema:'stage1',id:'PP-'+draft.toUpperCase(),owner,createdAt:at,campus:{...campus},quote:checked,payment,...deliveryInfo,
          pickupCode:Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[v%32]).join(''),
          history:[{stage:E.stages[0],at}]};
        localStorage.setItem(orderPrefix+draft,JSON.stringify(order));return order;
      };
      const order=navigator.locks?await navigator.locks.request('portpick-stage1-ledger',submit):submit();
      state.cart=[];state.draftId=uid();save();track('order_placed',{order:order.id});route();renderProducts();renderOrders();
      $('review-content').innerHTML=`<h2>下單成功</h2><p>訂單號 <strong class="order-number">${esc(order.id)}</strong></p>
        <button class="button dark" id="view-new">查看訂單進度 →</button>`;
      $('view-new').onclick=()=>{$('review-dialog').close();showDetail(order.id);};
    }catch(e){$('checkout-error').textContent=e.message;button.disabled=false;}
  };open('review-dialog');
}
let resumeCart=false;
function showAccount(fromCart=false){
  resumeCart=fromCart;$('account-name').value=account;$('logout').hidden=!account;
  $('account-info').textContent=account?'目前使用 '+account:'使用同一演示名稱，可在此瀏覽器重新查看自己的訂單。';
  open('account-dialog');
}
$('account-open').onclick=()=>showAccount();
function switchAccount(next){
  const guest=!account&&state.cart.length?state:null;
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  study=null;document.querySelector('.study-banner')?.remove();
  account=next;if(next)sessionStorage.setItem(sessionKey,next);else sessionStorage.removeItem(sessionKey);$('account-close').hidden=!!next;selectedOrder=null;legacyV1=[];
  state=loadDraft();
  if(guest && next && !state.cart.length){
    Object.assign(state,{cart:guest.cart,campus:guest.campus,store:guest.store,port:guest.port});
    save();localStorage.removeItem(prefix+'guest-draft');
  }
  route();renderProducts();renderOrders();loadLegacy();
  if(resumeCart&&next){renderCart();open('cart-dialog');}
  resumeCart=false;
}
$('account-form').onsubmit=e=>{e.preventDefault();const next=normal($('account-name').value);if(next)switchAccount(next);};
$('logout').onclick=()=>{resumeCart=false;switchAccount('');showAccount();};

const legacyLabels={submitted:'待確認',confirmed:'已確認',ready:'待取貨',completed:'已完成',cancelled:'已取消'};
function legacyView(raw){
  const old=raw.quote || raw.fees || {};
  return {id:String(raw.id??raw.orderId??''),createdAt:raw.createdAt??raw.date,
    campus:raw.campus?.name||'未記錄', deliveryMode:raw.deliveryMode, estimatedDeliveryAt:raw.estimatedDeliveryAt, scheduledWindowEnd:raw.scheduledWindowEnd, status:legacyLabels[raw.status]||raw.status||'未記錄',
    quote:{product:old.product??old.productSubtotal,service:old.service,rateBps:old.rateBps,
      packaging:old.packaging??old.repackingFee,total:old.total??raw.total??raw.finalTotal},
    oldDelivery:old.delivery??old.deliveryFee,store:old.store?.name||raw.store?.name||'未記錄',
    lines:old.lines||raw.items||[],legacy:true};
}
function ownedOrders(){
  if(!account)return [];
  const old=readJSON('portpick-v2-state',{}).orders||[];
  const legacy=[...old,...legacySessionOrders].filter(o=>normal(o.alias)===account).concat(legacyV1).map(legacyView);
  return [...stageOrders().filter(o=>o.owner===account),...legacy]
    .sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
}
async function loadLegacy(){
  const seq=++accountSequence, owner=account;
  if(!owner)return;
  let hash=2166136261;
  for(let i=0;i<owner.length;i++){hash^=owner.charCodeAt(i);hash=Math.imul(hash,16777619);}
  const keys=['demo-'+(hash>>>0).toString(16)];
  if(crypto.subtle){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));
    keys.push(Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''));
  }
  if(seq!==accountSequence || owner!==account)return;
  const v1=readJSON('studentpass-orders-v1',[]);
  legacyV1=(Array.isArray(v1)?v1:[v1]).filter(o=>o&&keys.includes(o.userKey));
  renderOrders();
}
function deliveryLabel(o){return o.deliveryMode==='asap'?'盡快送達':o.deliveryMode==='scheduled'?'預約送達':'未指定';}
function deliveryText(o){return o.estimatedDeliveryAt?timeText(o.estimatedDeliveryAt)+(o.deliveryMode==='scheduled'&&o.scheduledWindowEnd?'–'+timeText(o.scheduledWindowEnd):''):'未指定';}
function currentStatus(o){return o.legacy?o.status:o.history.at(-1).stage;}
function campusName(o){return o.legacy?o.campus:o.campus.name;}
function renderOrders(){
  const orders=ownedOrders();
  $('order-mode').textContent=account?'演示帳號 · '+account:'登入演示帳號即可查看訂單。';
  $('orders-list').innerHTML=orders.length?orders.map(o=>`<article class="order-card"><div class="order-top">
    <h3>${esc(o.id||'未記錄')}</h3><span class="badge">${esc(currentStatus(o))}</span></div>
    <p>下單時間 · ${esc(timeText(o.createdAt))}<br>校園自提點 · ${esc(campusName(o))}<br>
    實付總額（模擬） · <strong>${fmt(o.quote.total)}</strong><br>送達方式 · ${esc(deliveryLabel(o))}<br>預計到點 · ${esc(deliveryText(o))}</p>
    <button class="button light" data-view="${esc(o.id)}">查看訂單進度</button></article>`).join(''):
    (account?'<p class="empty">此帳號暫無訂單。</p>':'<button id="orders-login" class="button light">登入演示帳號</button>');
  $('orders-login')?.addEventListener('click',()=>showAccount());
  $('orders-list').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showDetail(b.dataset.view));
}
function itemDetails(lines, store){
  const missing='未記錄';
  const field=(v,suffix='')=>v==null?missing:esc(v)+suffix;
  const rows=lines.map(l=>`<article class="receipt-row">
    <div class="receipt-thumb" aria-hidden="true">${l.image?.art?art(l.image,true):'<span>▧</span>'}</div>
    <div class="receipt-info"><details class="item-name"><summary>${field(l.name)}</summary><div>${field(l.name)}</div></details>
    <dl>${[['規格',l.units!=null&&l.unit?field(l.units)+' × '+field(l.unit)+'／組':missing],['數量',field(l.quantity,' 組')],
    ['單價',fmt(l.unitPrice)+(Number.isFinite(l.unitPrice)?'／組':'')],['分裝',field(l.packagingName)],
    ['分裝單價',fmt(l.packagingUnitPrice)],['分裝小計',fmt(l.packagingAmount)]].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl></div>
    <strong class="line-money">${fmt(l.productAmount)}</strong></article>`).join('');
  return `<section class="receipt"><h3>商品明細</h3><p class="receipt-store">採購門店 · ${esc(store||missing)}</p>${rows||missing}</section>`;
}
function showDetail(id){
  const o=ownedOrders().find(x=>x.id===id);
  if(!o){$('detail-dialog').close();return;}
  selectedOrder=id;
  if(o.legacy){
    $('order-detail').innerHTML=`<h2>歷史訂單</h2><p class="order-number">${esc(o.id)} · ${esc(o.status)}</p>
      <p>下單時間 · ${esc(timeText(o.createdAt))}<br>採購門店 · ${esc(o.store)}<br>校園自提點 · ${esc(o.campus)}</p>
      <p>付款方式 · 未記錄<br>送達方式 · ${deliveryLabel(o)}<br>預計到點 · ${deliveryText(o)}</p>${itemDetails(o.lines,o.store)}${breakdown(o.quote)}<p>舊版配送費 · ${fmt(o.oldDelivery)}</p><p class="fine">合計沿用原始記錄。</p>`;
  }else{
    const ready=o.history.length===3;
    $('order-detail').innerHTML=`<div class="${ready?'pickup-ticket':'summary'}">
      <h2>${ready?'可以取貨':'請等候到點通知'}</h2><strong>${esc(o.campus.name)}</strong>
      ${ready?`<p>${esc(o.campus.location)}</p><p>取貨碼 <strong class="pickup-code">${esc(o.pickupCode)}</strong></p>`:''}</div>
      <p class="order-number">訂單號 · ${esc(o.id)}</p><p>下單時間 · ${timeText(o.createdAt)}<br>送達方式 · ${deliveryLabel(o)}<br>預計到點 · ${deliveryText(o)}<br>採購門店 · ${esc(o.quote.store.name)}</p>
      <ol class="timeline">${E.stages.map((s,i)=>`<li class="${o.history[i]?'done':''}"><strong>${s}</strong><time>${o.history[i]?timeText(o.history[i].at):'待處理'}</time></li>`).join('')}</ol>
      <p class="muted">路線參考 · ${esc(o.quote.port?.name||'未記錄')}<br>付款方式 · ${esc(o.payment||'未記錄')}</p>
      ${itemDetails(o.quote.lines,o.quote.store.name)}
      ${breakdown(o.quote)}`;
  }
  open('detail-dialog');$('detail-dialog').scrollTop=0;
}
$('refresh-orders').onclick=renderOrders;
function renderDemo(){
  const orders=ownedOrders().filter(o=>!o.legacy&&o.history.length<3);
  $('admin-list').innerHTML=orders.length?`<label>選擇要推進的訂單<select id="demo-order"><option value="">請選擇一筆訂單</option>
    ${orders.map(o=>`<option value="${esc(o.id)}">${esc(o.id)} · ${currentStatus(o)}</option>`).join('')}</select></label><div id="demo-action"></div>`:
    '<p>此帳號暫無可推進的訂單。</p>';
  if(!orders.length)return;
  $('demo-order').onchange=()=>{
    const order=orders.find(o=>o.id===$('demo-order').value);
    $('demo-action').innerHTML=order?`<p>${currentStatus(order)} → ${E.stages[order.history.length]}</p><button id="advance" class="button dark">推進至${E.stages[order.history.length]}</button>`:'';
    if(!order)return;
    $('advance').onclick=async()=>{
      const b=$('advance');if(b.disabled)return;b.disabled=true;
      try{
        const advance=()=>{
          const key=orderPrefix+order.id.slice(3).toLowerCase();
          const latest=readJSON(key,null);
          if(!latest || latest.owner!==account)throw Error('找不到此帳號的訂單');
          localStorage.setItem(key,JSON.stringify(E.advance(latest,order.history.length,new Date().toISOString())));
        };
        if(navigator.locks)await navigator.locks.request('portpick-stage1-ledger',advance);else advance();
        toast('訂單進度已更新');
      }catch(e){toast(e.message);}
      renderOrders();renderDemo();
    };
  };
}
$('admin-open').onclick=()=>{if(!account){showAccount();return;}renderDemo();open('admin-dialog');};
window.addEventListener('storage',e=>{
  if(e.key?.startsWith(orderPrefix)){
    renderOrders();renderProducts();
    if($('detail-dialog').open)showDetail(selectedOrder);
    if($('admin-dialog').open)renderDemo();
  }
});
function download(name,content,type){const url=URL.createObjectURL(new Blob(['\ufeff',content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('tools-open').onclick=()=>{if(!account){showAccount();return;}showTool('study');open('tools-dialog');};document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>showTool(b.dataset.tool));
function showTool(which){const box=$('tool-content');if(which==='study'){const completed=state.studies.filter(x=>x.outcome==='completed').length;box.innerHTML=`<div class="metric-grid"><div class="metric"><strong>${state.studies.length}</strong><span>已保存測試</span></div><div class="metric"><strong>${state.studies.length?Math.round(completed/state.studies.length*100)+'%':'—'}</strong><span>自報任務完成率</span></div><div class="metric"><strong>${state.studies.reduce((s,x)=>s+x.helpCount,0)}</strong><span>記錄求助次數</span></div></div><p class="muted">建議任務：在 CNY 150 內選購兩種商品，選擇門店與校園自提點，完成一次演示下單。所有記錄僅供原型測試，不代表真實購買或付費意願。預設不追蹤訪客。</p>${study?`<p>測試進行中：<strong>${esc(study.participant)}</strong> · 已記錄 ${study.events.length} 個事件</p><button id="study-help" class="button light">記錄一次求助（${study.helpCount}）</button><form id="study-end"><div class="form-grid"><label>任務結果<select id="study-outcome"><option value="completed">完成</option><option value="abandoned">放棄</option><option value="blocked">被錯誤阻擋</option></select></label><label>容易程度<select id="study-rating"><option value="">不評分</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n} / 5</option>`).join('')}</select></label><label class="field-full">卡點、改進建議與放棄原因<textarea id="study-feedback" maxlength="1000"></textarea></label></div><button class="button dark">結束並保存測試</button></form>`:`<form id="study-start"><label>匿名測試編號<input id="participant" placeholder="例如 P01" maxlength="30" required></label><label class="check"><input type="checkbox" required><span>受測者已知情同意記錄操作事件、耗時、求助次數及其回饋；記錄留在此瀏覽器，可由研究人員匯出。</span></label><button class="button dark">開始記錄測試</button></form>`}<div class="inline-buttons"><button id="export-studies" class="button light">匯出完整 JSON</button><button id="export-csv" class="button light">匯出摘要 CSV</button></div><p class="fine">只記錄開始測試後的操作。重新整理頁面會中止未保存的測試；請先結束並匯出。此工具不生成虛構受測者資料。</p>`;
 if(study){$('study-help').onclick=()=>{study.helpCount++;track('help_requested');showTool('study');};$('study-end').onsubmit=e=>{e.preventDefault();state.studies.push({...study,finishedAt:new Date().toISOString(),durationSeconds:Math.round((Date.now()-study.started)/1000),outcome:$('study-outcome').value,rating:Number($('study-rating').value)||null,feedback:$('study-feedback').value.trim()});study=null;document.querySelector('.study-banner')?.remove();save();showTool('study');toast('測試記錄已保存於此瀏覽器');};}else $('study-start').onsubmit=e=>{e.preventDefault();const participant=$('participant').value.trim();if(!participant)return;study={id:uid(),participant,started:Date.now(),startedAt:new Date().toISOString(),helpCount:0,events:[],mode};track('test_started');const banner=document.createElement('div');banner.className='study-banner';banner.textContent='測試記錄中 · '+participant;const b=document.createElement('button');b.className='text-button';b.textContent='結束／回饋 ↗';b.onclick=()=>{showTool('study');open('tools-dialog');};banner.append(b);document.body.append(banner);$('tools-dialog').close();toast('已開始記錄，請完成購物任務');};
 $('export-studies').onclick=()=>download('PortPick-test-records.json',JSON.stringify({version:'2.0',exportedAt:new Date().toISOString(),records:state.studies},null,2),'application/json');$('export-csv').onclick=()=>{const cell=x=>'"'+String(x??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';const fields=['participant','mode','startedAt','durationSeconds','outcome','helpCount','rating','feedback'];download('PortPick-test-summary.csv',[fields.join(','),...state.studies.map(s=>fields.map(k=>cell(s[k])).join(','))].join('\r\n'),'text/csv');};
 }else if(which==='calculator'){box.innerHTML=`<h3>按完整單位估算用量</h3><p class="muted">「每人每週用量」會乘以人數，結果按全戶消耗計算。</p><div class="form-grid"><label>包裝內完整單位<input id="calc-units" type="number" min="1" step="1" value="24"></label><label>每人每週用量<input id="calc-use" type="number" min="0.1" step="0.1" value="4"></label><label>使用人數<input id="calc-people" type="number" min="1" step="1" value="2"></label><label>包裝價格（CNY）<input id="calc-price" type="number" min="0" step="0.01" value="42"></label></div><div id="calc-result" class="summary"></div>`;const calc=()=>{const units=Number($('calc-units').value),use=Number($('calc-use').value),people=Number($('calc-people').value),price=Number($('calc-price').value);$('calc-result').textContent=units>0&&use>0&&Number.isInteger(people)&&people>0&&price>=0?`可用約 ${(units/use/people).toFixed(1)} 週 · 全戶每週 ${fmt(price/(units/use/people))} · 每人每週 ${fmt(price/(units/use))}`:'請輸入有效的正數及整數人數。';};['calc-units','calc-use','calc-people','calc-price'].forEach(id=>$(id).oninput=calc);calc();
 }else{box.innerHTML=`<h3>候選人篩選實驗 · 不提供真實代購</h3><p class="muted">此功能不屬於主要預約流程。候選人全為模擬資料，不會聯絡任何人。按相同口岸、未來兩小時時間窗、足夠載重及報酬篩選。</p><form id="match-form"><div class="form-grid"><label>口岸<select id="match-port">${C.ports.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></label><label>期望時間（香港時間）<input id="match-time" type="datetime-local" required min="${hkNow()}" value="${new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,16)}"></label><label>重量（kg）<input id="match-weight" type="number" required min="0.1" step="0.1" value="3"></label><label>報酬上限（HKD）<input id="match-offer" type="number" required min="0" value="40"></label></div><button class="button dark">查看模擬匹配</button></form><div id="match-results"></div>`;const sampleTime=new Date(Date.now()+86400000).toISOString(),helpers=[{name:'示例同學 A',portId:'luohu',capacity:8,ask:35,time:sampleTime},{name:'示例同學 B',portId:'futian',capacity:15,ask:55,time:sampleTime}];$('match-form').onsubmit=e=>{e.preventDefault();const request={portId:$('match-port').value,time:bookingISO($('match-time').value),weight:Number($('match-weight').value),offer:Number($('match-offer').value)};const result=E.matches(helpers,request);$('match-results').innerHTML=result.length?result.map(h=>`<div class="summary"><strong>${h.name} · 模擬</strong><p>載重 ${h.capacity} kg · 報酬 HKD ${h.ask} · 可用時間 ${esc(new Date(h.time).toLocaleString('zh-HK',{timeZone:'Asia/Hong_Kong'}))}</p><p class="fine">此結果僅測試篩選邏輯，不能聯絡或派單。</p></div>`).join(''):'<div class="alert">暫無符合口岸、時間、重量與報酬條件的模擬候選人。可調整條件重試。</div>';};}}

route(); renderCategories(); renderProducts(); renderOrders(); loadLegacy();
if(window.PORTPICK_MAPS_API_KEY){const mapsScript=document.createElement('script');mapsScript.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(window.PORTPICK_MAPS_API_KEY)+'&callback=initPortPickMap';mapsScript.async=true;mapsScript.onerror=()=>{$('map-config-note').textContent='Google Maps 載入失敗；門店卡片和距離計算仍可使用。';$('map-config-note').hidden=false;};document.head.append(mapsScript);}
const accountDialog=$('account-dialog');accountDialog.addEventListener('cancel',e=>{if(!account)e.preventDefault();});accountDialog.addEventListener('click',e=>{if(!account&&e.target===accountDialog)e.preventDefault();});accountDialog.addEventListener('close',()=>{if(!account)queueMicrotask(()=>{if(!accountDialog.open)accountDialog.showModal();});});$('account-close').hidden=!account; if(!account)showAccount();
if(location.protocol!=='file:') {
  fetch('/api/orders',{credentials:'same-origin'}).then(r=>r.ok?r.json():[]).then(rows=>{
    legacySessionOrders=Array.isArray(rows)?rows:[];renderOrders();
  }).catch(()=>{});
}
window.addEventListener('beforeunload',e=>{if(study){e.preventDefault();e.returnValue='';}});
