(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortPick = factory();
})(globalThis, function () {
  'use strict';
  const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const stages = ['揀貨中', '配貨中', '已到達自提點'];
  function fees(productCents, packagingCents, rateBps) {
    if (![productCents, packagingCents, rateBps].every(n => Number.isSafeInteger(n) && n >= 0))
      throw Error('費用設定無效');
    const serviceCents = Math.floor((productCents * rateBps + 5000) / 10000);
    return { product: productCents / 100, service: serviceCents / 100, packaging: packagingCents / 100,
      total: (productCents + serviceCents + packagingCents) / 100, rateBps, currency: 'CNY' };
  }
  function minimum(productCents, config) {
    const rate = config.cnyToHKD;
    const minimumHKD = config.minimumHKD;
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(minimumHKD) || minimumHKD < 0)
      throw Error('起送門檻或匯率設定無效');
    const hkdCents = Math.round(productCents * Math.round(rate * 1000000) / 1000000);
    const shortCents = Math.max(0, Math.round(minimumHKD * 100) - hkdCents);
    return {rate, minimumHKD, subtotalHKD:hkdCents/100, shortHKD:shortCents/100};
  }
  function routes(store, ports) {
    const radians = n => n * Math.PI / 180;
    return ports.map(port => {
      const a = Math.sin(radians(port.lat-store.lat)/2)**2 +
        Math.cos(radians(store.lat))*Math.cos(radians(port.lat))*Math.sin(radians(port.lng-store.lng)/2)**2;
      return {...port, km:12742 * Math.asin(Math.sqrt(a))};
    }).sort((a,b)=>a.km-b.km);
  }
  function quote(catalog, storeId, portId, cart) {
    const store = catalog.stores.find(s => s.id === storeId);
    const port = catalog.ports.find(s => s.id === portId);
    if (!store || !port) throw Error('請重新選擇門店與路線');
    const used = {};
    let subtotal = 0, packaging = 0;
    const lines = cart.map(line => {
      const p = catalog.products.find(x => x.id === line.productId);
      const pack = catalog.packaging.find(x => x.id === line.packaging);
      const sale = p && saleSpec(p);
      const validUnits = line.saleVersion === 2 ? line.units === sale?.units : p?.sizes.includes(line.units);
      if (!p || !pack || !validUnits || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > (sale?.maxQuantity || 100))
        throw Error('商品規格或數量無效');
      used[p.id] = (used[p.id] || 0) + line.units * line.quantity;
      if (line.saleVersion===2 && used[p.id]/sale.units>sale.maxQuantity) throw Error(p.name+' 超出限購數量');
      if (used[p.id] > p.stock[storeId]) throw Error(p.name + ' 超出所選門店的示例庫存');
      const unitCents = Math.round(Math.round(p.price * 100) * line.units / p.packUnits);
      const amount = unitCents * line.quantity;
      const packagingQuantity = line.saleVersion === 2 ? (line.packagingQuantity ?? 1) : line.quantity;
      if (!Number.isSafeInteger(packagingQuantity) || packagingQuantity < 1 || packagingQuantity > 100) throw Error('分裝數量無效');
      const packAmount = Math.round(pack.fee * 100) * packagingQuantity;
      subtotal += amount;
      packaging += packAmount;
      return {...line, currency:catalog.currency || 'CNY', saleLabel:line.saleVersion===2?sale.label:null, purchaseUnits:p.packUnits, batch:p.batch?{...p.batch}:null, packagingQuantity, name:p.name, image:{art:p.art,color:p.color,english:p.english}, unit:p.unit, unitPrice:unitCents/100, packagingName:pack.name,
        packagingUnitPrice:pack.fee, productAmount:amount/100, packagingAmount:packAmount/100};
    });
    return {...fees(subtotal, packaging, catalog.stage1.serviceFeeBasisPoints), currency:catalog.currency || 'CNY', threshold:minimum(subtotal,{...catalog.stage1,cnyToHKD:catalog.currency==='HKD'?1:catalog.stage1.cnyToHKD}), store:{...store}, port:routes(store,[port])[0], lines};
  }
  function saleSpec(p) {
    return p.sale || {units:p.packUnits,label:'包',maxQuantity:100};
  }
  function migrateCart(cart, catalog) {
    const result=[];
    for (const line of cart) {
      const p=catalog.products.find(p=>p.id===line.productId);
      if (!p || line.saleVersion===2) {result.push({...line});continue;}
      const sale=saleSpec(p), quantity=line.units*line.quantity/sale.units;
      if (!Number.isSafeInteger(quantity)) {result.push({...line});continue;}
      const existing=result.find(x=>x.productId===line.productId&&x.packaging===line.packaging&&x.saleVersion===2);
      if (existing) {existing.quantity+=quantity;existing.packagingQuantity+=line.quantity;}
      else result.push({...line,saleVersion:2,units:sale.units,quantity,packagingQuantity:line.quantity});
    }
    return result;
  }
  function dateNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return null;
    const at=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value ? at/86400000 : null;
  }
  function pickupDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return dateNumber(value)===null?null:value;
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    const p=hkParts(new Date(value));return p.year+'-'+p.month+'-'+p.day;
  }
  function daysRemaining(product, pickup) {
    const end=dateNumber(product.batch?.markedDate), start=dateNumber(pickupDate(pickup));
    return end===null||start===null?null:end-start;
  }
  function shelfAdvice(catalog, cart, pickup) {
    const rules=catalog.stage1.shelfLife, grouped=new Map();
    for (const line of cart) {
      const p=catalog.products.find(p=>p.id===line.productId);
      if (!p) continue;
      const quantity=line.units*line.quantity/saleSpec(p).units;
      if (grouped.has(p.id)) grouped.get(p.id).quantity+=quantity;
      else grouped.set(p.id,{id:p.id,name:p.name,label:saleSpec(p).label,quantity,days:daysRemaining(p,pickup),batch:p.batch||null});
    }
    const entries=[...grouped.values()];
    const short=entries.filter(e=>e.days!==null&&e.days>=0&&e.days<=rules.shortDays);
    const combined=short.length>=rules.combinedProducts&&short.reduce((s,e)=>s+e.quantity,0)>=rules.combinedQuantity;
    return {pickup:pickupDate(pickup),entries,expired:entries.filter(e=>e.days!==null&&e.days<0),
      reminders:short.filter(e=>combined||e.quantity>=rules.singleQuantity),combined};
  }
  function alternatives(catalog, productId, pickup, stock) {
    const source=catalog.products.find(p=>p.id===productId), days=source&&daysRemaining(source,pickup);
    if (days==null || days<0) return [];
    return catalog.products.filter(p=>p.id!==productId&&p.category===source.category&&stock(p)>=saleSpec(p).units&&
      daysRemaining(p,pickup)!==null&&daysRemaining(p,pickup)>days&&daysRemaining(p,pickup)>=0)
      .sort((a,b)=>daysRemaining(b,pickup)-daysRemaining(a,pickup));
  }
  function add(cart, item) {
    const next = cart.map(x => ({...x}));
    const existing = next.find(x => x.productId === item.productId && x.units === item.units && x.packaging === item.packaging);
    if (existing) existing.quantity++;
    else next.push({...item, quantity:1});
    return next;
  }
  function advance(order, expectedStep, at) {
    if (order.schema !== 'stage1' || order.history.length !== expectedStep || expectedStep >= stages.length)
      throw Error('訂單進度已更新，請重新選擇訂單。');
    return {...order, history:[...order.history, {stage:stages[expectedStep], at}]};
  }
  const DELIVERY = Object.freeze({ timezone:'Asia/Hong_Kong', earliestHour:10, latestHour:22, prepHours:5, dawnStartHour:0, dawnEndHour:6, horizonDays:7, slotMinutes:30 });
  function hkParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:DELIVERY.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
    return Object.fromEntries(parts.map(p=>[p.type,p.value]));
  }
  function hkDateAt(date, hour, minute=0) {
    const p=hkParts(date), y=+p.year, m=+p.month, d=+p.day;
    // HK is UTC+8 without DST; construct the instant from numeric calendar fields.
    return new Date(Date.UTC(y,m-1,d,hour-8,minute));
  }
  function deliverySlots(now=new Date(), config=DELIVERY) {
    const p=hkParts(now), currentHour=+p.hour, earliestToday= new Date(now.getTime()+config.prepHours*3600000);
    const tomorrow=new Date(Date.UTC(+p.year,+p.month-1,+p.day+1,4));
    const slots=[];
    for(let day=0;day<=config.horizonDays;day++) {
      if(day===0 && currentHour>=config.dawnStartHour && currentHour<config.dawnEndHour)continue;
      const base=day===0?now:tomorrow;
      const date=day===0?hkParts(now):hkParts(new Date(tomorrow.getTime()+(day-1)*86400000));
      for(let minute=config.earliestHour*60;minute+config.slotMinutes<=config.latestHour*60;minute+=config.slotMinutes) {
        const start=hkDateAt(new Date(Date.UTC(+date.year,+date.month-1,+date.day,12)),Math.floor(minute/60),minute%60);
        const end=new Date(start.getTime()+config.slotMinutes*60000);
        if(start<=now || (day===0 && start<earliestToday))continue;
        slots.push({start:start.toISOString(),end:end.toISOString(),date:`${date.year}-${date.month}-${date.day}`});
      }
    }
    const inService=currentHour>=config.earliestHour && currentHour<config.latestHour;
    const dawnOrder=currentHour>=config.dawnStartHour && currentHour<config.dawnEndHour;
    const asap=slots.find(s=>s.start>=new Date(now.getTime()+config.prepHours*3600000).toISOString()) || slots[0];
    return {slots,asap,afterHours:dawnOrder || !inService || !slots.some(s=>s.date===`${p.year}-${p.month}-${p.day}`),dawnOrder,timezone:config.timezone};
  }
  function deliverySelection(mode, now=new Date(), selectedStart=null, config=DELIVERY) {
    const available=deliverySlots(now,config);
    const slot=mode==='scheduled' ? available.slots.find(s=>s.start===selectedStart) : available.asap;
    if(!slot)throw Error('請選擇未來可履約時段');
    return {deliveryMode:mode,orderedAt:now.toISOString(),estimatedDeliveryAt:slot.start,
      scheduledWindowStart:mode==='scheduled'?slot.start:null,scheduledWindowEnd:mode==='scheduled'?slot.end:null,deliveryTimezone:config.timezone};
  }
  function matches(helpers, request) {
    const time = Date.parse(request.time);
    if (!(time > Date.now()) || !(request.weight > 0) || !(request.offer >= 0)) return [];
    return helpers.filter(h => h.portId === request.portId && h.capacity >= request.weight &&
      h.ask <= request.offer && Date.parse(h.time) > Date.now() && Math.abs(Date.parse(h.time)-time) <= 7200000)
      .sort((a,b) => a.ask-b.ask);
  }
  return {saleSpec, migrateCart, pickupDate, daysRemaining, shelfAdvice, alternatives, money, minimum, routes, fees, quote, add, advance, stages, matches, DELIVERY, hkParts, hkDateAt, deliverySlots, deliverySelection};
});
