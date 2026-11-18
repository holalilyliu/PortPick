const assert = require('node:assert/strict');
const E = require('../engine.js');
const catalog = require('../catalog.json');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const configuration = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../catalog.js'),'utf8'),configuration);
assert.equal(JSON.stringify(configuration.window.PORTPICK_CATALOG),JSON.stringify(catalog));

function test(name,run) { run(); console.log('PASS '+name); }
function sample(productPrice, packagingFee, quantity=1) {
  const c=structuredClone(catalog);
  c.products[0].price=productPrice;
  c.packaging[0].fee=packagingFee;
  c.products[0].stock.qianhai=1000;
  const line={productId:c.products[0].id,units:c.products[0].packUnits,quantity,packaging:c.packaging[0].id};
  return {c,line};
}
test('100.00 商品加 5.00 分裝 → 20.00 服務費及 125.00 合計',()=>{
  const {c,line}=sample(100,5);
  const q=E.quote(c,'qianhai','luohu',[line]);
  assert.deepEqual([q.product,q.service,q.packaging,q.total],[100,20,5,125]);
});
test('79.99 商品 → 16.00 服務費及 95.99 合計',()=>{
  const {c,line}=sample(79.99,0);
  const q=E.quote(c,'qianhai','luohu',[line]);
  assert.deepEqual([q.product,q.service,q.packaging,q.total],[79.99,16,0,95.99]);
});
test('空購物袋四項均為零',()=>{
  const q=E.quote(catalog,'futian','luohu',[]);
  assert.deepEqual([q.product,q.service,q.packaging,q.total],[0,0,0,0]);
});
test('逐行商品加總後整單計費一次',()=>{
  const {c,line}=sample(.02,0);
  const q=E.quote(c,'qianhai','luohu',[line,line]);
  assert.equal(q.service,.01);
});
test('快照保存單價與費率，價格及配置變更不改歷史合計',()=>{
  const {c,line}=sample(100,5);
  const q=E.quote(c,'qianhai','luohu',[line]);
  c.products[0].price=200; c.stage1.serviceFeeBasisPoints=1000;
  assert.equal(E.quote(c,'qianhai','luohu',[line]).total,225);
  assert.deepEqual([q.lines[0].unitPrice,q.lines[0].quantity,q.rateBps,q.total],[100,1,2000,125]);
});
test('口岸只作路線資訊，採購門店及金額不變',()=>{
  const {c,line}=sample(100,5);
  const totals=c.ports.map(port=>E.quote(c,'qianhai',port.id,[line]));
  assert.ok(totals.every(q=>q.store.id==='qianhai'&&q.total===125));
  c.products[0].stock.qianhai=0;
  assert.throws(()=>E.quote(c,'qianhai','luohu',[line]));
});
test('重複推進請求及跳步被拒，另一筆訂單保持原狀',()=>{
  const first={schema:'stage1',history:[{stage:E.stages[0],at:'t0'}],pickupCode:'TESTCODE'};
  const second=structuredClone(first);
  assert.throws(()=>E.advance(first,2,'t1'));
  const packed=E.advance(first,1,'t1');
  assert.throws(()=>E.advance(packed,1,'t1'));
  const ready=E.advance(packed,2,'t2');
  assert.equal(second.history.length,1);assert.equal(ready.pickupCode,first.pickupCode);
  assert.deepEqual(ready.history.map(h=>h.at),['t0','t1','t2']);
  assert.throws(()=>E.advance(ready,3,'t3'));
});
test('HKD 商品門檻獨立於服務費和分裝費；支持關閉及分位四捨五入',()=>{
  const {c,line}=sample(90,5);
  const q=E.quote(c,'futian','luohu',[line]);
  assert.deepEqual(q.threshold,{minimumHKD:100,rate:1.1,subtotalHKD:99,shortHKD:1});
  c.products[0].price=100;
  assert.equal(E.quote(c,'futian','luohu',[line]).threshold.subtotalHKD,110);
  assert.equal(E.minimum(9091,c.stage1).shortHKD,0);
  assert.equal(E.minimum(5,c.stage1).subtotalHKD,0.06);
  c.stage1.minimumHKD=0;
  assert.equal(E.minimum(1,c.stage1).shortHKD,0);
});
test('香港時區送達计算：10时加五小时、凌晨和晚间顺延及预约校验',()=>{
  const at=(y,m,d,h,min=0)=>new Date(Date.UTC(y,m-1,d,h-8,min));
  const morning=E.deliverySlots(at(2026,11,14,10));
  assert.equal(E.hkParts(new Date(morning.asap.start)).hour,'15');
  const dawn=E.deliverySlots(at(2026,11,14,2));
  assert.equal(E.hkParts(new Date(dawn.asap.start)).day,'15');
  assert.equal(E.hkParts(new Date(dawn.asap.start)).hour,'10');
  assert.equal(dawn.afterHours,true);
  const late=E.deliverySlots(at(2026,11,14,21));
  assert.equal(E.hkParts(new Date(late.asap.start)).day,'15');
  const yearEnd=E.deliverySlots(at(2026,12,31,23));
  assert.deepEqual([E.hkParts(new Date(yearEnd.asap.start)).year,E.hkParts(new Date(yearEnd.asap.start)).month,E.hkParts(new Date(yearEnd.asap.start)).day],['2027','01','01']);
  assert.throws(()=>E.deliverySelection('scheduled',at(2026,11,14,10),at(2026,11,14,9).toISOString()));
  const booked=E.deliverySelection('scheduled',at(2026,11,14,10),morning.slots[0].start);
  assert.equal(booked.scheduledWindowEnd,new Date(Date.parse(booked.scheduledWindowStart)+30*60000).toISOString());
});
test('四件福田商品費用、圖片和口岸推薦',()=>{
  const cart=[['water',6],['noodles',12],['detergent',1],['chips',18]].map(([productId,units])=>({productId,units,quantity:1,packaging:'carry'}));
  const q=E.quote(catalog,'futian','luohu',cart);
  assert.deepEqual([q.product,q.service,q.packaging,q.total],[223.5,44.7,8,276.2]);
  assert.ok(q.lines.every(l=>l.image.art===l.productId));
  assert.deepEqual(catalog.stores.map(s=>E.routes(s,catalog.ports)[0].id),['futian','shenzhenbay']);
});
