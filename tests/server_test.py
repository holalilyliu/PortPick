import datetime as dt, http.cookiejar, json, os, subprocess, sys, tempfile, unittest, urllib.error, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class ServerTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();env={**os.environ,'PORTPICK_ADMIN_TOKEN':'qa-only-temporary-token'}
  cls.proc=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--port','0','--data-dir',cls.tmp.name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
  cls.base=cls.proc.stdout.readline().strip().split(' ',2)[2];cls.a=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));cls.b=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 @classmethod
 def tearDownClass(cls): cls.proc.terminate();cls.proc.wait(timeout=5);cls.tmp.cleanup()
 def req(self,path,method='GET',data=None,admin=False,client=None,origin=None):
  headers={'Content-Type':'application/json'}
  if admin:headers['Authorization']='Bearer qa-only-temporary-token'
  if origin:headers['Origin']=origin
  req=urllib.request.Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
  try:r=(client or self.a).open(req);return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def payload(self,key):return {'requestKey':key,'storeId':'qianhai','portId':'luohu','cart':[{'productId':'water','units':6,'quantity':1,'packaging':'carry'}],'alias':'QA','time':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)).isoformat(),'notes':'Automated test only'}
 def test_end_to_end(self):
  self.assertEqual(self.req('/api/health')[0],200)
  p=self.payload('one');code,o=self.req('/api/orders','POST',p);self.assertEqual(code,201);self.assertEqual(o['quote']['store']['id'],'qianhai');self.assertEqual(o['quote']['total'],32.5)
  self.assertEqual(self.req('/api/orders','POST',p)[1]['id'],o['id'])
  self.assertEqual(len(self.req('/api/orders')[1]),1)
  self.assertEqual(self.req('/api/orders',client=self.b)[1],[])
  self.assertEqual(self.req('/api/orders/'+o['id'],'PATCH',{'status':'cancelled'},client=self.b)[0],404)
  self.assertEqual(self.req('/api/admin/orders')[0],401)
  self.assertEqual(len(self.req('/api/admin/orders',admin=True)[1]),1)
  path='/api/admin/orders/'+o['id']
  self.assertEqual(self.req(path,'PATCH',{'status':'completed'},admin=True)[0],400)
  for s in ['confirmed','ready','completed']:
   self.assertEqual(self.req(path,'PATCH',{'status':s,'teamNote':'QA updated'},admin=True)[1]['status'],s)
  final=self.req('/api/orders')[1][0];self.assertEqual(len(final['history']),4);self.assertEqual(final['teamNote'],'QA updated')
  self.assertEqual(self.req('/api/orders/'+o['id'],'PATCH',{'status':'cancelled'})[0],400)
  p=self.payload('invalid');p['cart'][0]['units']=.25;self.assertEqual(self.req('/api/orders','POST',p)[0],400)
  p=self.payload('past');p['time']='2020-01-01T00:00:00Z';self.assertEqual(self.req('/api/orders','POST',p)[0],400)
  self.assertEqual(self.req('/api/orders','POST',self.payload('csrf'),origin='https://unrelated.example')[0],403)
  self.assertEqual(self.req('/data/portpick.sqlite3')[0],404)
  p=self.payload('tampered');p['total']=.01;code,o=self.req('/api/orders','POST',p);self.assertEqual(o['quote']['total'],32.5)
  self.assertEqual(self.req('/api/orders/'+o['id'],'PATCH',{'status':'cancelled'})[1]['status'],'cancelled')
  # Every allowed SKU/size uses the same cent rounding as the JS catalog formula.
  import importlib.util
  spec=importlib.util.spec_from_file_location('server',ROOT/'server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
  for product in server.CATALOG['products']:
   for n in product['sizes']:
    sample=self.payload('quote');sample['storeId']='futian';sample['cart']=[{'productId':product['id'],'units':n,'quantity':1,'packaging':'original'}]
    q=server.quote(sample);self.assertEqual(q['product'],server.price(product['price']*n/product['packUnits']))
if __name__=='__main__':unittest.main(verbosity=2)
