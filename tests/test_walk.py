import json, math, re, sys, asyncio, urllib.parse
from playwright.async_api import async_playwright

HTML = open('/home/claude/paris-walk/paris-walk.html').read()

# ---- minimal Leaflet stub covering the API surface the app uses ----
LEAFLET_STUB = r"""
window.L = (function(){
  function Layer(){ this._map=null; }
  Layer.prototype.addTo=function(m){ this._map=m; if(m&&m._layers) m._layers.add(this); return this; };
  Layer.prototype.bindPopup=function(h){ this._popup=h; return this; };
  Layer.prototype.bindTooltip=function(h){ this._tip=h; return this; };
  Layer.prototype.getLatLng=function(){ return {lat:this._latlng[0], lng:this._latlng[1]}; };
  Layer.prototype.on=function(){ return this; };
  Layer.prototype.setLatLngs=function(ll){ this._latlngs=ll; return this; };
  Layer.prototype.setLatLng=function(ll){ this._latlng=ll; return this; };
  Layer.prototype.setRadius=function(r){ this._r=r; return this; };
  Layer.prototype.getLatLngs=function(){ return this._latlngs; };
  function Map(el){ this._el=el; this._layers=new Set(); this._zoom=13; this._handlers={}; }
  Map.prototype.setView=function(c,z){ this._center=c; if(z) this._zoom=z; return this; };
  Map.prototype.flyTo=function(c,z){ this._center=c; if(z) this._zoom=z; return this; };
  Map.prototype.fitBounds=function(b){ this._bounds=b; return this; };
  Map.prototype.getZoom=function(){ return this._zoom; };
  Map.prototype.hasLayer=function(l){ return this._layers.has(l); };
  Map.prototype.on=function(e,f){ this._handlers[e]=f; return this; };
  Map.prototype.invalidateSize=function(){};
  Map.prototype.removeLayer=function(l){ this._layers.delete(l); return this; };
  Map.prototype.getSize=function(){ return {x:400,y:300}; };
  Map.prototype.latLngToContainerPoint=function(ll){ var c=this._center||[0,0]; return {x:200+(ll[1]-c[1])*100000, y:150-(ll[0]-c[0])*100000}; };
  Map.prototype.panTo=function(c){ this._center=c; this._pans=(this._pans||0)+1; return this; };
  Map.prototype.fire=function(e,arg){ this._handlers[e] && this._handlers[e](arg); };
  var L={};
  L.map=function(el){ return new Map(el); };
  L.tileLayer=function(){ return new Layer(); };
  L.polyline=function(ll,o){ var l=new Layer(); l._latlngs=ll; l.options=o; return l; };
  L.circle=function(ll,o){ var l=new Layer(); l._latlng=ll; return l; };
  L.marker=function(ll,o){ var l=new Layer(); l._latlng=ll; l.options=o; return l; };
  L.divIcon=function(o){ return o; };
  L.layerGroup=function(){ var g=new Layer(); g._items=[]; g.clearLayers=function(){ g._items=[]; }; g.eachLayer=function(f){ g._items.forEach(f); };
    var origAdd=Layer.prototype.addTo; g.addTo=origAdd;
    return g; };
  var _origAddTo=Layer.prototype.addTo;
  Layer.prototype.addTo=function(m){ if(m && m._items){ m._items.push(this); this._map=m; return this; } return _origAddTo.call(this,m); };
  L.control={ zoom:function(){ return { addTo:function(){} }; } };
  L.latLngBounds=function(ll){ return ll; };
  return L;
})();
"""

def encode_polyline(points, precision=6):
    factor = 10 ** precision
    out = []
    plat = plon = 0
    for lat, lon in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return ''.join(out)

def haversine(a, b):
    R = 6371000
    dlat = math.radians(b[0]-a[0]); dlon = math.radians(b[1]-a[1])
    s = math.sin(dlat/2)**2 + math.cos(math.radians(a[0]))*math.cos(math.radians(b[0]))*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(s))

def synth_route(locs):
    """Densify straight lines between locations into a fake road shape with a maneuver per location."""
    shape = []; maneuvers = []
    names = ["Rue Guénégaud", "Quai de Conti", "Pont Neuf", "Quai du Louvre", "Rue de Rivoli", "Rue Montorgueil", "Boulevard Montmartre", "Rue des Martyrs", "Rue Lepic", "Rue Norvins"]
    for i in range(len(locs)-1):
        a = (locs[i]['lat'], locs[i]['lon']); b = (locs[i+1]['lat'], locs[i+1]['lon'])
        n = max(2, int(haversine(a, b) / 25))
        start = len(shape)
        for k in range(n):
            if k == 0 and shape: continue
            t = k / (n-1) if n > 1 else 0
            shape.append((a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t))
        typ = 1 if i == 0 else (10 if i % 2 else 15)
        st = names[i % len(names)]
        maneuvers.append({"type": typ, "instruction": ("Walk north on %s." % st) if i == 0 else ("Turn %s onto %s." % ("right" if typ == 10 else "left", st)),
                          "street_names": [st], "begin_shape_index": max(0, start-1) if i else 0, "end_shape_index": len(shape)-1, "length": haversine(a, b)/1000, "time": haversine(a, b)/1.3})
    maneuvers.append({"type": 4, "instruction": "You have arrived at your destination.", "street_names": [], "begin_shape_index": len(shape)-1, "end_shape_index": len(shape)-1, "length": 0, "time": 0})
    return shape, maneuvers

async def main(mode):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 400, "height": 780}, device_scale_factor=2)
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type in ("error",) else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        calls = {"valhalla": 0, "osrm": 0, "overpass": 0}

        async def handler(route, request):
            url = request.url
            if "127.0.0.1:8765" in url:
                await route.continue_(); return
            if "leaflet.min.js" in url:
                await route.fulfill(status=200, content_type="application/javascript", body=LEAFLET_STUB); return
            if "leaflet.min.css" in url:
                await route.fulfill(status=200, content_type="text/css", body=".leaflet-container{}"); return
            if "valhalla1.openstreetmap.de" in url:
                calls["valhalla"] += 1
                if mode == "osrm":
                    await route.fulfill(status=503, body="down"); return

                body = json.loads(urllib.parse.unquote(url.split("json=")[1]))
                locs = body["locations"]
                shape, man = synth_route(locs)
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"trip": {"legs": [{"shape": encode_polyline(shape), "maneuvers": man, "summary": {"time": 100}}], "summary": {"length": 1}}})); return
            if "routing.openstreetmap.de" in url:
                calls["osrm"] += 1
                coords = url.split("/driving/")[1].split("?")[0].split(";")
                locs = [{"lat": float(c.split(",")[1]), "lon": float(c.split(",")[0])} for c in coords]
                shape, man = synth_route(locs)
                steps = []
                for i, m in enumerate(man):
                    idx = m["begin_shape_index"]
                    t = "depart" if i == 0 else ("arrive" if i == len(man)-1 else "turn")
                    if i == 2:
                        steps.append({"name": "", "distance": 12, "maneuver": {"type": "turn", "modifier": "right", "location": [shape[idx-3][1], shape[idx-3][0]]}})
                    if i == 5:
                        steps.append({"name": "", "distance": 60, "maneuver": {"type": "turn", "modifier": "left", "location": [shape[idx-2][1], shape[idx-2][0]]}})
                    steps.append({"name": (m["street_names"] or [""])[0], "distance": m["length"]*1000, "maneuver": {"type": t, "modifier": "right" if m["type"] == 10 else "left", "location": [shape[idx][1], shape[idx][0]], "bearing_after": 10}})
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"code": "Ok", "routes": [{"duration": 100, "geometry": {"coordinates": [[lo, la] for la, lo in shape]}, "legs": [{"steps": steps}]}]})); return
            if "overpass-api.de" in url and "out geom" in urllib.parse.unquote(request.post_data or ""):
                calls["streets"] = calls.get("streets", 0) + 1
                gpx_locs = [(48.8557053,2.3388305),(48.8562,2.33955),(48.85665,2.34112),(48.85855,2.3405),(48.86063,2.33762),(48.86376,2.33673),(48.86291,2.34713),(48.86635,2.34727),(48.8712,2.34102),(48.876,2.3396),(48.8801,2.33915),(48.88442,2.33864),(48.88611,2.33475),(48.88717,2.33687),(48.88872,2.33874),(48.88865,2.34022),(48.88647,2.34084),(48.8867,2.3431),(48.87885,2.33945),(48.87163,2.34265),(48.86376,2.33673),(48.86061,2.33764),(48.85834,2.33745),(48.8566,2.337),(48.8532,2.34385),(48.853,2.3499),(48.85545,2.3443),(48.85665,2.34112),(48.8557053,2.3388305)]
                names = ["Rue Guénégaud", "Quai de Conti", "Pont Neuf", "Quai du Louvre", "Rue de Rivoli", "Rue Montorgueil", "Boulevard Montmartre", "Rue des Martyrs", "Rue Lepic", "Rue Norvins"]
                els = []
                for i in range(len(gpx_locs)-1):
                    a, b = gpx_locs[i], gpx_locs[i+1]
                    els.append({"type": "way", "id": 100+i, "tags": {"highway": "residential", "name": names[i % len(names)]}, "geometry": [{"lat": a[0]+0.00007, "lon": a[1]}, {"lat": b[0]+0.00007, "lon": b[1]}]})
                    els.append({"type": "way", "id": 200+i, "tags": {"highway": "footway", "footway": "sidewalk", "name": "WRONG sidewalk"}, "geometry": [{"lat": a[0]+0.00002, "lon": a[1]}, {"lat": b[0]+0.00002, "lon": b[1]}]})
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements": els})); return
            if "overpass-api.de" in url:
                calls["overpass"] += 1
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements": [
                    {"type": "node", "id": 1, "lat": 48.8560, "lon": 2.3389, "tags": {"name": "Monnaie de Paris", "tourism": "museum", "wikipedia": "fr:Monnaie de Paris"}},
                    {"type": "way", "id": 2, "center": {"lat": 48.8567, "lon": 2.3413}, "tags": {"name": "Statue équestre d'Henri IV", "historic": "monument", "wikidata": "Q123"}},
                    {"type": "relation", "id": 3, "center": {"lat": 48.8530, "lon": 2.3499}, "tags": {"name": "Cathédrale Notre-Dame de Paris", "name:en": "Notre-Dame de Paris", "building": "cathedral", "wikipedia:en": "Notre-Dame de Paris", "opening_hours": "Mo-Su 08:00-19:00"}},
                ]})); return
            if "places.googleapis.com" in url:
                calls["google"] = calls.get("google", 0) + 1
                body = json.loads(request.post_data or "{}")
                if request.headers.get("x-goog-api-key") != "TESTKEY":
                    await route.fulfill(status=403, content_type="application/json", body='{"error":{"message":"bad key"}}'); return
                q = body.get("textQuery", "")
                hit = {"Paris": (48.8566, 2.3522), "Pont Neuf, Paris": (48.85665, 2.34112), "Place des Vosges, Paris": (48.85555, 2.36553), "19 Rue Guénégaud, Paris": (48.85571, 2.33883), "Nowhere Particular Street, Paris": (48.86, 2.35)}.get(q)
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"places": [{"displayName": {"text": q.split(",")[0]}, "location": {"latitude": hit[0], "longitude": hit[1]}, "formattedAddress": "somewhere, Paris"}] if hit else []})); return
            if "photon.komoot.io/api" in url:
                q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("q", [""])[0]
                table = {"Paris": (48.8566, 2.3522), "Pont Neuf, Paris": (48.8566, 2.3411), "Place des Vosges, Paris": (48.8555, 2.3655), "19 Rue Guénégaud, Paris": (48.8557, 2.3388)}
                hit = table.get(q)
                if not hit:
                    await route.fulfill(status=200, content_type="application/json", body=json.dumps({"features": []})); return
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"features": [{"geometry": {"coordinates": [hit[1], hit[0]]}, "properties": {"name": q.split(",")[0], "city": "Paris"}}]})); return
            if "nominatim.openstreetmap.org" in url:
                await route.fulfill(status=200, content_type="application/json", body="[]"); return
            if "wikipedia.org" in url:
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"extract": "Notre-Dame de Paris is a medieval Catholic cathedral on the Île de la Cité.", "thumbnail": {"source": "data:image/gif;base64,R0lGODlhAQABAAAAACw="}, "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Notre-Dame_de_Paris"}}})); return
            await route.abort()

        await page.route("**/*", handler)
        import threading, http.server, functools
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/claude/paris-walk"))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        await page.goto("http://127.0.0.1:8765/paris-walk.html", wait_until="load")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden')", timeout=15000)
        await page.wait_for_timeout(500)
        await page.wait_for_function("state.data.route && state.data.route.maneuvers.every(m => m.street || m.kind==='arrive')", timeout=8000)
        print("maneuvers:", await page.evaluate("state.data.route.maneuvers.map(m=>[m.kind,m.text,Math.round(m.len)])"))
        info = await page.evaluate("""() => ({
            title: document.getElementById('title').textContent,
            stat: document.getElementById('stat').textContent,
            provider: state.data.route.provider,
            shapeLen: state.data.route.shape.length,
            maneuvers: state.data.route.maneuvers.length,
            firstThree: [...document.querySelectorAll('.dir-item .main')].map(e=>e.textContent),
            dists: [...document.querySelectorAll('.dir-item .dist')].map(e=>e.textContent),
            status: document.getElementById('statusText').textContent,
            pois: state.data.pois.length, poisStatus: state.data.poisStatus,
            highlights: state.data.highlights.length,
        })""")
        print(json.dumps(info, ensure_ascii=False, indent=1))
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_start.png")
        # scrub to ~40% and open nearby sheet
        await page.evaluate("setPreviewProgress(state.data.route.length*0.4)")
        await page.wait_for_timeout(200)
        mid = await page.evaluate("""() => ({ firstThree: [...document.querySelectorAll('.dir-item .main')].map(e=>e.textContent), dists: [...document.querySelectorAll('.dir-item .dist')].map(e=>e.textContent), status: document.getElementById('statusText').textContent, lab: document.getElementById('lab').textContent, doneLen: document.getElementById('map').routeDone._latlngs.length, aheadLen: document.getElementById('map').routeAhead._latlngs.length })""")
        print("mid:", json.dumps(mid, ensure_ascii=False))
        print("roadside:", await page.evaluate("state.data.roadside.slice(0,6).map(x=>x.name+'@'+Math.round(x.prog))"))
        await page.evaluate("setPreviewProgress(state.data.roadside[2].prog - 150)")
        await page.wait_for_timeout(100)
        print("sight card:", await page.evaluate("[...document.querySelectorAll('.dir-item')].map(e=>e.className.replace('dir-item','').trim()+': '+e.querySelector('.main').textContent+' '+e.querySelector('.dist').textContent)"))
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_sight.png")
        await page.click("#compactBtn"); await page.wait_for_timeout(100)
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_compact.png")
        await page.click("#full"); await page.wait_for_timeout(200)
        print("fullscreen:", await page.evaluate("[document.body.classList.contains('map-full'), getComputedStyle(document.querySelector('header.bar')).display, document.getElementById('directions').classList.contains('compact')]"))
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_full.png")
        await page.click("#full"); await page.wait_for_timeout(100)
        await page.click("#compactBtn"); await page.wait_for_timeout(100)
        print("restored:", await page.evaluate("[document.body.classList.contains('map-full'), document.getElementById('directions').classList.contains('compact')]"))
        print("maneuvers:", await page.evaluate("state.data.route.maneuvers.map(m=>[m.kind,m.text,m.street,m.towards||'',Math.round(m.len)]).slice(0,9)"))
        un = await page.evaluate("state.data.route.maneuvers.findIndex(m=>!m.street && m.kind!=='depart')")
        await page.evaluate(f"setPreviewProgress(state.data.route.maneuvers[{un}].d0 - 50)")
        print("unnamed html:", await page.evaluate("[...document.querySelectorAll('.dir-item .text')].map(e=>e.innerHTML)[0]"), await page.evaluate("document.getElementById('statusText').textContent"))
        for frac in (0.12,):
            await page.evaluate(f"setPreviewProgress(state.data.route.length*{frac})")
            print("list html:", await page.evaluate("[...document.querySelectorAll('.dir-item .text')].map(e=>e.innerHTML)"))
        # jump to Notre-Dame (near the end) and open nearby
        await page.evaluate("setPreviewProgress(state.data.route.cum[state.data.route.shape.length-1] - 900)")
        await page.evaluate("document.getElementById('nearby').toggle(true)")
        await page.wait_for_timeout(300)
        near = await page.evaluate("""() => [...document.querySelectorAll('.poi .name')].map(e=>e.textContent)""")
        print("nearby:", near)
        await page.click(".tabs button[data-tab=highlights]")
        await page.wait_for_timeout(100)
        hl = await page.evaluate("""() => [...document.querySelectorAll('.poi .name')].map(e=>e.textContent)""")
        print("highlights:", hl)
        await page.click(".poi:nth-child(1) .poi-head")
        await page.wait_for_timeout(100)
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_sheet.png")
        # wikipedia on an OSM poi
        await page.click(".tabs button[data-tab=all]")
        await page.wait_for_timeout(100)
        el = await page.query_selector("[data-id='relation/3'] .poi-head")
        await el.click()
        await page.click("[data-id='relation/3'] [data-act=wiki]")
        await page.wait_for_timeout(400)
        wk = await page.evaluate("document.querySelector(\"[data-id='relation/3'] .poi-body\").textContent")
        print("wiki:", wk.strip()[:200])
        # GPS simulation via injected watchPosition
        await page.evaluate("""() => { window._fixes = []; navigator.geolocation.watchPosition = (ok) => { window._ok = ok; return 1; }; navigator.geolocation.clearWatch = ()=>{}; }""")
        await page.click("#gpsBtn")
        # phase 1: walk along the route from 30% for 40 fixes (slight jitter)
        await page.evaluate("""() => { const s = state.data.route.shape; let i = Math.floor(s.length*0.3); window._i = i; for (let k=0;k<40;k++){ i = Math.min(s.length-1, i+2); window._i=i; _ok({coords:{latitude:s[i][0]+0.00004, longitude:s[i][1]+0.00003, accuracy: 15, speed: 1.3, heading: null}}); } }""")
        await page.wait_for_timeout(100)
        p1 = await page.evaluate("({progress: Math.round(state.data.progress), off: state.data.offRoute, lost: tracker.lost, first: document.querySelector('.dir-item .main').textContent, pans: document.getElementById('map').map._pans||0})")
        print("phase1 on-route:", p1)
        # phase 2: wander 90 m east for 12 fixes
        await page.evaluate("""() => { const s = state.data.route.shape; let i = window._i; for (let k=0;k<12;k++){ i = Math.min(s.length-1, i+1); window._i=i; _ok({coords:{latitude:s[i][0], longitude:s[i][1]+0.0012, accuracy: 15, speed: 1.2, heading: null}}); } }""")
        await page.wait_for_timeout(600)
        p2 = await page.evaluate("({progress: Math.round(state.data.progress), off: state.data.offRoute, offDist: Math.round(state.data.offDist), reroute: !!state.data.reroute, rerouting: state.data.rerouting, status: document.getElementById('statusText').textContent, first: document.querySelector('.dir-item .main').textContent})")
        print("phase2 off-route:", p2)
        # phase 3: back onto the route
        await page.evaluate("""() => { const s = state.data.route.shape; let i = window._i; for (let k=0;k<6;k++){ i = Math.min(s.length-1, i+1); window._i=i; _ok({coords:{latitude:s[i][0], longitude:s[i][1], accuracy: 15, speed: 1.2, heading: null}}); } }""")
        await page.wait_for_timeout(100)
        p3 = await page.evaluate("({progress: Math.round(state.data.progress), off: state.data.offRoute, reroute: !!state.data.reroute, status: document.getElementById('statusText').textContent})")
        print("phase3 back:", p3)
        print("pois top/all:", await page.evaluate("[state.data.pois.length, state.data.poisAll.length, state.data.roadside.length]"))
        await page.wait_for_timeout(300)
        gps = await page.evaluate("""() => ({ mode: state.data.mode, items: [...document.querySelectorAll('.dir-item .main')].map(e=>e.textContent) })""")
        print("gps:", json.dumps(gps, ensure_ascii=False))
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_gps.png")
        # cached reload
        await page.reload(wait_until="load")
        try:
            await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden')", timeout=8000)
        except Exception as ex:
            print("reload overlay text:", await page.evaluate("document.getElementById('overlayText').textContent"), errors)
        print("calls after reload:", calls, "(route should be cached)")
        # export GPX
        gpx = await page.evaluate("toGPX(state.data.name, state.data.route.shape, state.data.highlights).slice(0,300)")
        print("gpx:", gpx.replace("\n", " ")[:200])
        # desktop
        await page.set_viewport_size({"width": 1200, "height": 800})
        await page.wait_for_timeout(300)
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_desktop.png")
        # ---- planner ----
        await page.set_viewport_size({"width": 400, "height": 780})
        await page.evaluate("planner.open()")
        await page.fill("#planText", "Start: 19 Rue Guénégaud\n1. Pont Neuf — oldest bridge in Paris\n- Place des Vosges - the city's oldest square\nNowhere Particular Street")
        await page.fill("#planName", "Test walk")
        print("prompt:", (await page.evaluate("planner.prompt()"))[:120])
        await page.click("#planFind")
        await page.wait_for_function("!planner.busy", timeout=20000)
        print("stops:", await page.evaluate("planner.stops.map(s=>[s.name, s.desc, s.status, s.lat])"))
        await page.screenshot(path=f"/home/claude/paris-walk/test/shot_{mode}_planner.png")
        await page.evaluate("planner.remove(3)")
        await page.click("#planBuild")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden') && state.data.route && state.data.name==='Test walk'", timeout=15000)
        print("built:", await page.evaluate("[state.data.name, state.data.highlights.length, state.data.points.length, Math.round(state.data.route.length), document.body.classList.contains('planning')]"))
        # ---- planner with Google key ----
        await page.evaluate("localStorage.setItem('walk:gkey','TESTKEY'); refreshKeyState()")
        print("key state:", await page.evaluate("document.getElementById('gkeyState').textContent"))
        await page.evaluate("planner.open()")
        await page.fill("#planText", "Start: 19 Rue Guénégaud\nPont Neuf\nNowhere Particular Street")
        await page.click("#planFind")
        await page.wait_for_function("!planner.busy", timeout=20000)
        print("google stops:", await page.evaluate("planner.stops.map(s=>[s.name, s.status, s.label])"), calls.get("google"))
        await page.evaluate("localStorage.setItem('walk:gkey','WRONG'); geocode._warned=false; planner.stops=[]")
        await page.click("#planFind")
        await page.wait_for_function("!planner.busy", timeout=25000)
        print("bad key fallback:", await page.evaluate("planner.stops.map(s=>[s.name, s.status])"))
        await page.evaluate("planner.close()")
        # ---- draft persistence + library ----
        await page.evaluate("planner.open()")
        await page.fill("#planText", "Start: 19 Rue Guénégaud\nPont Neuf — bridge")
        await page.fill("#planName", "Draft walk")
        await page.reload(wait_until="load")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden')", timeout=15000)
        await page.evaluate("planner.open()")
        print("draft restored:", await page.evaluate("[document.getElementById('planName').value, document.getElementById('planText').value.split('\\n').length]"))
        await page.evaluate("planner.close(); libraryPanel.open()")
        print("library:", await page.evaluate("[...document.querySelectorAll('.lib-item .t')].map(e=>e.textContent)"), await page.evaluate("library.current()?.id"))
        print("ai prompt:", (await page.evaluate("aiEditPrompt(library.current())")).split("\n")[2][:60], "...")
        await page.click(".lib-item:not(.current) [data-act=open]")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden') && !document.body.classList.contains('library')", timeout=15000)
        print("opened:", await page.evaluate("[state.data.name, library.current()?.id]"))
        await page.evaluate("planner.edit(library.current())")
        print("edit:", await page.evaluate("[planner.editId, planner.stops.length, planner.stops[0].status, document.getElementById('planText').value.split('\\n')[0]]"))
        await page.click("#planBuild")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden') && !document.body.classList.contains('planning')", timeout=15000)
        print("rebuilt same id:", await page.evaluate("[library.current()?.id, library.list().length]"))
        print("errors:", errors)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "valhalla"))
