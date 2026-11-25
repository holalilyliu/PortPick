#!/usr/bin/env python3
"""PortPick 2.0 supervised LAN pilot. Python standard library only."""
import argparse, datetime as dt, hashlib, hmac, http.cookies, json, math, os, secrets, sqlite3, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parent
CATALOG=json.loads((ROOT/'catalog.json').read_text())
TRANSITIONS={'submitted':['confirmed','cancelled'],'confirmed':['ready','cancelled'],'ready':['completed','cancelled'],'completed':[],'cancelled':[]}
LOCK=threading.RLock()
def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
def price(n): return math.floor(n*100+0.50000001)/100

def quote(payload):
    stores={s['id']:s for s in CATALOG['stores']}; ports={p['id']:p for p in CATALOG['ports']}
    store=stores.get(payload.get('storeId')); port=ports.get(payload.get('portId')); cart=payload.get('cart')
    if not store or not port or not isinstance(cart,list) or not 1<=len(cart)<=100: raise ValueError('門店、口岸或購物袋無效')
    products={p['id']:p for p in CATALOG['products']}; packs={p['id']:p for p in CATALOG['packaging']}; used={}; lines=[]
    for l in cart:
        if not isinstance(l,dict): raise ValueError('規格無效')
        p=products.get(l.get('productId')); pack=packs.get(l.get('packaging')); units=l.get('units'); qty=l.get('quantity')
        if not p or not pack or type(units) is not int or units not in p['sizes'] or type(qty) is not int or not 1<=qty<=100: raise ValueError('商品規格或數量無效')
        used[p['id']]=used.get(p['id'],0)+units*qty
        if used[p['id']]>p['stock'][store['id']]: raise ValueError('超出該店示例庫存')
        lines.append({'productId':p['id'],'units':units,'quantity':qty,'packaging':pack['id'],'name':p['name'],'unit':p['unit'],'productAmount':price(price(p['price']*units/p['packUnits'])*qty),'packagingAmount':price(pack['fee']*qty),'weight':price(p['unitWeight']*units*qty)})
    r=math.radians; x=math.sin(r(port['lat']-store['lat'])/2)**2+math.cos(r(store['lat']))*math.cos(r(port['lat']))*math.sin(r(port['lng']-store['lng'])/2)**2
    km=6371*2*math.atan2(math.sqrt(x),math.sqrt(1-x)); delivery=next(fee for limit,fee in CATALOG['tiers'] if km<=limit)
    product=price(sum(l['productAmount'] for l in lines)); packaging=price(sum(l['packagingAmount'] for l in lines))
    return {'store':store,'port':port,'lines':lines,'distanceKm':price(km),'product':product,'packaging':packaging,'delivery':delivery,'total':price(product+packaging+delivery),'weight':price(sum(l['weight'] for l in lines)),'currency':'CNY'}

def db():
    c=sqlite3.connect(DB_PATH); c.row_factory=sqlite3.Row; return c

def clean(value,limit,required=False):
    if not isinstance(value,str) or len(value)>limit or (required and not value.strip()): raise ValueError('文字欄位無效或過長')
    return value.strip()

class Handler(BaseHTTPRequestHandler):
    server_version='PortPick/2.0'
    def log_message(self,*args): pass
    def send(self,status,data,content_type='application/json; charset=utf-8'):
        body=json.dumps(data,ensure_ascii=False).encode() if isinstance(data,(dict,list)) else data
        self.send_response(status); self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Referrer-Policy','no-referrer'); self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        if getattr(self,'new_session',None): self.send_header('Set-Cookie',f'portpick_session={self.new_session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800')
        self.end_headers(); self.wfile.write(body)
    def session(self):
        cookie=http.cookies.SimpleCookie()
        try: cookie.load(self.headers.get('Cookie',''))
        except http.cookies.CookieError: pass
        token=cookie['portpick_session'].value if 'portpick_session' in cookie else ''
        if len(token)==64:
            with db() as c:
                row=c.execute('SELECT expires FROM sessions WHERE token=?',(token,)).fetchone()
                if row and row[0]>time.time(): return token
        token=secrets.token_hex(32)
        with db() as c:
            c.execute('DELETE FROM sessions WHERE expires < ?',(time.time(),)); c.execute('INSERT INTO sessions VALUES (?,?)',(token,time.time()+604800))
        self.new_session=token; return token
    def admin(self): return hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer '+ADMIN_TOKEN)
    def body(self):
        origin=self.headers.get('Origin')
        if origin and origin not in ('http://'+self.headers.get('Host',''),'https://'+self.headers.get('Host','')): raise PermissionError('來源不被允許')
        if self.headers.get('Sec-Fetch-Site')=='cross-site': raise PermissionError('來源不被允許')
        if self.headers.get('Content-Type','').split(';')[0]!='application/json': raise ValueError('需使用 JSON')
        size=int(self.headers.get('Content-Length','0'))
        if not 0<size<=65536: raise ValueError('請求大小無效')
        body=json.loads(self.rfile.read(size))
        if not isinstance(body,dict): raise ValueError('JSON 必須是物件')
        return body
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/api/health': self.session(); return self.send(200,{'version':'2.0','mode':'shared'})
        if path in ['/api/orders','/api/admin/orders']:
            if path.startswith('/api/admin') and not self.admin(): return self.send(401,{'error':'管理金鑰無效'})
            owner=self.session()
            with db() as c: rows=c.execute('SELECT data FROM orders ORDER BY created DESC' if self.admin() and path.startswith('/api/admin') else 'SELECT data FROM orders WHERE owner=? ORDER BY created DESC',() if self.admin() and path.startswith('/api/admin') else (owner,)).fetchall()
            return self.send(200,[json.loads(r[0]) for r in rows])
        files={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/catalog.js':'catalog.js','/engine.js':'engine.js','/app.js':'app.js','/maps-config.js':'maps-config.js','/store-map-base.svg':'store-map-base.svg'}
        if path not in files: return self.send(404,{'error':'找不到頁面'})
        p=ROOT/files[path]; mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[p.suffix]
        return self.send(200,p.read_bytes(),mime)
    def do_POST(self):
        try:
            if urlsplit(self.path).path!='/api/orders': return self.send(404,{'error':'找不到操作'})
            data=self.body(); owner=self.session(); key=clean(data.get('requestKey'),100,True)
            with LOCK,db() as c:
                previous=c.execute('SELECT data FROM orders WHERE owner=? AND request_key=?',(owner,key)).fetchone()
                if previous:return self.send(200,json.loads(previous[0]))
                q=quote(data); alias=clean(data.get('alias'),40,True); notes=clean(data.get('notes',''),300)
                when=dt.datetime.fromisoformat(clean(data.get('time'),50,True).replace('Z','+00:00'))
                if when.tzinfo is None: raise ValueError('取貨時間必須包含時區')
                delta=(when-dt.datetime.now(dt.timezone.utc)).total_seconds()
                if not 0<delta<=30*86400: raise ValueError('取貨時間須在未來 30 天內')
                # Reserve complete units against this server's illustrative inventory.
                used={}
                for row in c.execute('SELECT data FROM orders'):
                    o=json.loads(row[0])
                    if o['status']!='cancelled' and o['quote']['store']['id']==q['store']['id']:
                        for l in o['quote']['lines']:used[l['productId']]=used.get(l['productId'],0)+l['units']*l['quantity']
                for l in q['lines']:
                    used[l['productId']]=used.get(l['productId'],0)+l['units']*l['quantity']
                    p=next(p for p in CATALOG['products'] if p['id']==l['productId'])
                    if used[l['productId']]>p['stock'][q['store']['id']]:raise ValueError(p['name']+' 的共享示例庫存不足，請減少數量或更換門店')
                created=now(); o={'id':'PP-'+secrets.token_hex(6).upper(),'createdAt':created,'status':'submitted','history':[{'status':'submitted','at':created}],'quote':q,'alias':alias,'notes':notes,'time':when.isoformat(),'mode':'shared','teamNote':''}
                c.execute('INSERT INTO orders VALUES (?,?,?,?,?)',(o['id'],owner,key,created,json.dumps(o,ensure_ascii=False)))
            return self.send(201,o)
        except PermissionError as e:return self.send(403,{'error':str(e)})
        except (ValueError,TypeError,KeyError,OverflowError) as e:return self.send(400,{'error':str(e)})
    def do_PATCH(self):
        try:
            path=urlsplit(self.path).path; is_admin=path.startswith('/api/admin/orders/'); prefix='/api/admin/orders/' if is_admin else '/api/orders/'
            if not path.startswith(prefix):return self.send(404,{'error':'找不到操作'})
            if is_admin and not self.admin():return self.send(401,{'error':'管理金鑰無效'})
            data=self.body(); owner=self.session(); oid=path[len(prefix):]
            with LOCK,db() as c:
                row=c.execute('SELECT data,owner FROM orders WHERE id=?',(oid,)).fetchone()
                if not row or (not is_admin and row['owner']!=owner):return self.send(404,{'error':'找不到預約'})
                o=json.loads(row['data']); status=data.get('status')
                if not is_admin and (status!='cancelled' or o['status'] not in ('submitted','confirmed')):raise ValueError('此預約需由團隊處理')
                if status!=o['status'] and status not in TRANSITIONS[o['status']]:raise ValueError('狀態轉換無效')
                if is_admin:o['teamNote']=clean(data.get('teamNote',o.get('teamNote','')),500)
                if status!=o['status']:o['history'].append({'status':status,'at':now()})
                o['status']=status;c.execute('UPDATE orders SET data=? WHERE id=?',(json.dumps(o,ensure_ascii=False),oid))
            return self.send(200,o)
        except PermissionError as e:return self.send(403,{'error':str(e)})
        except (ValueError,TypeError,KeyError) as e:return self.send(400,{'error':str(e)})

def main():
    global DB_PATH,ADMIN_TOKEN
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=8765);p.add_argument('--data-dir',type=Path,default=ROOT/'data');args=p.parse_args()
    args.data_dir.mkdir(parents=True,exist_ok=True);DB_PATH=args.data_dir/'portpick.sqlite3';ADMIN_TOKEN=os.environ.get('PORTPICK_ADMIN_TOKEN') or secrets.token_urlsafe(24)
    with db() as c:
        c.execute('CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires REAL)')
        c.execute('CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,owner TEXT,request_key TEXT,created TEXT,data TEXT,UNIQUE(owner,request_key))')
    os.chmod(DB_PATH,0o600)
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    print(f'PortPick 2.0: http://{args.host}:{server.server_port}\nTeam admin key: {ADMIN_TOKEN}\nKeep this key with the team. Orders are research reservations; no payment is processed.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
if __name__=='__main__':main()
