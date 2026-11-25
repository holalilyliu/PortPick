const assert=require('node:assert/strict');
const E=require('../engine.js');
const original=require('../catalog.json');
const c={...structuredClone(original),currency:'HKD',products:structuredClone(original.shelfLifeDemo.products),stage1:{...original.stage1,minimumHKD:0}};
const line=(id,q)=>({productId:'demo-'+id,saleVersion:2,units:1,quantity:q,packaging:'original',packagingQuantity:1});
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('1 至 5 瓶逐瓶計價；5 瓶 HK$40+8=48，數量快照和包裝獨立',()=>{
 for(let quantity=1;quantity<=5;quantity++){
  const q=E.quote(c,'futian','luohu',[line('drink3',quantity)]);
  assert.equal(q.product,quantity*8);assert.equal(q.total,quantity*960/100);assert.equal(q.lines[0].quantity,quantity);
 }
 const q=E.quote(c,'futian','luohu',[{...line('drink3',5),packaging:'carry'}]);
 assert.equal(q.packaging,2);assert.equal(q.currency,'HKD');
});
test('負數、小數、零、限購、庫存、非法拆售及分裝份數驗證',()=>{
 for(const n of [-1,0,1.5,101])assert.throws(()=>E.quote(c,'futian','luohu',[line('drink3',n)]));
 const copy=structuredClone(c);copy.products[0].stock.futian=4;
 assert.throws(()=>E.quote(copy,'futian','luohu',[line('drink3',5)]));
 assert.throws(()=>E.quote(c,'futian','luohu',[line('drink3',60),line('drink3',60)]));
 copy.products[0].sale.units=24;copy.products[0].sale.label='箱';copy.products[0].stock.futian=240;
 assert.throws(()=>E.quote(copy,'futian','luohu',[line('drink3',1)]));
 assert.equal(E.quote(copy,'futian','luohu',[{...line('drink3',1),units:24}]).product,192);
 assert.throws(()=>E.quote(c,'futian','luohu',[{...line('drink3',1),packagingQuantity:0}]));
});
test('3 天 3→4→3 單品提醒；不同分裝行按同款累計',()=>{
 for(const n of [3,4,3])assert.equal(E.shelfAdvice(c,[line('drink3',n)],'2026-11-25').reminders.length,n===4?1:0);
 assert.equal(E.shelfAdvice(c,[line('drink3',2),line('drink3',2)],'2026-11-25').reminders[0].quantity,4);
});
test('兩款各 3 單位分別列瓶和袋；移除後重新計算',()=>{
 const a=E.shelfAdvice(c,[line('drink3',3),line('snack3',3)],'2026-11-25');
 assert.equal(a.combined,true);assert.deepEqual(a.reminders.map(x=>[x.quantity,x.label]),[[3,'瓶'],[3,'袋']]);
 assert.equal(E.shelfAdvice(c,[line('drink3',3)],'2026-11-25').reminders.length,0);
});
test('0、7、8 天，未知，標示日期早於自提日，香港跨日及非法日期',()=>{
 for(const [id,days,reminders,expired] of [['drink3',3,1,0],['drink7',7,1,0],['drink8',8,0,0],['unknown',null,0,0],['expired',-1,0,1]]){
  const a=E.shelfAdvice(c,[line(id,4)],'2026-11-25');assert.equal(a.entries[0].days,days);assert.equal(a.reminders.length,reminders);assert.equal(a.expired.length,expired);
 }
 assert.equal(E.shelfAdvice(c,[line('drink3',4)],'2026-11-28').reminders.length,1);
 assert.equal(E.pickupDate('2026-11-24T16:30:00Z'),'2026-11-25');
 assert.equal(E.daysRemaining({batch:{markedDate:'2026-02-30'}},'2026-02-25'),null);
 assert.equal(E.daysRemaining({shelfLifeDays:30},'2026-11-25'),null);
});
test('替代必須同類、有庫存、日期已知且更長；過期原商品無普通替代',()=>{
 const choices=E.alternatives(c,'demo-drink3','2026-11-25',p=>p.id==='demo-drink7'?0:20);
 assert.deepEqual(choices.map(p=>p.id),['demo-drink8']);
 assert.equal(E.alternatives(c,'demo-expired','2026-11-25',()=>20).length,0);
});
test('舊購物袋轉換 6 瓶×2→12 瓶且包裝仍為2份，舊資料與訂單不變',()=>{
 const old=[{productId:'water',units:6,quantity:2,packaging:'carry'}], saved=JSON.stringify(old);
 const next=E.migrateCart(old,original);assert.equal(next[0].quantity,12);assert.equal(next[0].packagingQuantity,2);
 assert.equal(JSON.stringify(old),saved);assert.deepEqual(E.migrateCart(next,original),next);
 const q=E.quote(original,'futian','luohu',old);original.products[0].price=100;
 assert.deepEqual([q.lines[0].units,q.lines[0].quantity,q.product,q.packaging],[6,2,21,4]);
});
console.log(passed+' groups passed');
