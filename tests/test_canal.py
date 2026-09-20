import json, math, sys, asyncio, urllib.parse, re
from playwright.async_api import async_playwright
sys.path.insert(0, "/home/claude/paris-walk/test")
from run import LEAFLET_STUB, haversine

# ---- synthetic waterway network: from (47.964,3.5215) south to (47.3655,3.5915) ----
# main channel: a polyline of nodes; an island section with two arms (weir arm shorter, lock arm longer); side rivers.
nid = [1000]
def node(lat, lon):
    nid[0] += 1; return (nid[0], lat, lon)

def make_way(wid, tags, pts):
    return {"type": "way", "id": wid, "tags": tags, "nodes": [p[0] for p in pts], "geometry": [{"lat": p[1], "lon": p[2]} for p in pts]}

elements = []
lat0, lon0 = 47.965, 3.52
lat1, lon1 = 47.365, 3.59
N = 120
main = [node(lat0 + (lat1 - lat0) * i / N, lon0 + (lon1 - lon0) * i / N + 0.01 * math.sin(i / 6)) for i in range(N + 1)]
# split into ways of 10 nodes, sharing endpoints; tag first half river, second half canal
wid = 1
for i in range(0, N, 10):
    seg = main[i:i + 11]
    tags = {"waterway": "river", "name": "Yonne", "CEMT": "I", "boat": "yes"} if i < 40 else {"waterway": "canal", "name": "Canal du Nivernais", "boat": "yes", "maxheight": "3.5"}
    if i == 30:
        # island: replace this way by two arms; arm A short (weir), arm B long (lock)
        a, b = seg[0], seg[-1]
        mid_lat = (a[1] + b[1]) / 2; mid_lon = (a[2] + b[2]) / 2
        armA = [a, node(mid_lat, mid_lon - 0.004), b]
        armB = [a, node(mid_lat + 0.002, mid_lon + 0.006), node(mid_lat - 0.002, mid_lon + 0.006), b]
        elements.append(make_way(wid, {"waterway": "river", "name": "Yonne"}, armA)); wid += 1
        # weir node near arm A
        elements.append({"type": "node", "id": 900001, "lat": mid_lat, "lon": mid_lon - 0.004, "tags": {"waterway": "weir"}})
        # lock chamber inside arm B: separate short way tagged lock=yes between the two middle nodes
        elements.append(make_way(wid, {"waterway": "river", "name": "Yonne", "boat": "yes"}, armB[:2])); wid += 1
        elements.append(make_way(wid, {"waterway": "canal", "lock": "yes", "lock_name": "Écluse de Bassou", "lock_ref": "79"}, armB[1:3])); wid += 1
        elements.append(make_way(wid, {"waterway": "river", "name": "Yonne", "boat": "yes"}, armB[2:])); wid += 1
        continue
    w = make_way(wid, tags, seg); wid += 1
    elements.append(w)
    # a lock on every other way (lock_gate nodes pair) for the canal part
    if i >= 40 and (i // 10) % 2 == 0:
        m = seg[5]
        elements.append({"type": "node", "id": 800000 + i, "lat": m[1], "lon": m[2], "tags": {"waterway": "lock_gate", "lock_name": f"Écluse de Test {i}", "lock_ref": str(70 - i // 10)}})
        elements.append({"type": "node", "id": 810000 + i, "lat": seg[6][1], "lon": seg[6][2], "tags": {"waterway": "lock_gate"}})
# a side river joining the main channel (should be ignored)
side = [main[50], node(main[50][1] + 0.01, main[50][2] + 0.05), node(main[50][1] + 0.02, main[50][2] + 0.1)]
elements.append(make_way(wid, {"waterway": "river", "name": "Cure"}, side)); wid += 1
# a tempting shortcut: straight canal way from node 20 to node 60 tagged boat=no
elements.append(make_way(wid, {"waterway": "canal", "name": "Old cut", "boat": "no"}, [main[20], main[60]])); wid += 1

def features_for(line_pts):
    els = []
    # bridges every ~8 km, moorings at a few points, shops, sights
    for k, (lat, lon) in enumerate(line_pts[::15]):
        els.append({"type": "way", "id": 500000 + k, "center": {"lat": lat + 0.0001, "lon": lon}, "tags": {"bridge": "yes", "highway": "secondary", "ref": f"D{k}", "name": f"Pont {k}"}})
    for k, (lat, lon) in enumerate(line_pts[7::30]):
        els.append({"type": "node", "id": 600000 + k, "lat": lat, "lon": lon + 0.0005, "tags": {"mooring": "yes", "name": f"Halte {k}", "water_supply": "yes", "power_supply": "yes"}})
        els.append({"type": "node", "id": 610000 + k, "lat": lat + 0.004, "lon": lon + 0.006, "tags": {"shop": "bakery", "name": f"Boulangerie {k}"}})
        els.append({"type": "node", "id": 620000 + k, "lat": lat - 0.003, "lon": lon + 0.004, "tags": {"amenity": "restaurant", "name": f"Restaurant {k}", "wikipedia": "fr:Test"}})
    q = len(line_pts)//4
    els.append({"type": "node", "id": 710000, "lat": line_pts[q][0], "lon": line_pts[q][1] + 0.0003, "tags": {"seamark:type": "buoy_lateral", "seamark:buoy_lateral:category": "port", "seamark:buoy_lateral:colour": "red"}})
    els.append({"type": "node", "id": 710001, "lat": line_pts[q+1][0], "lon": line_pts[q+1][1] - 0.0002, "tags": {"seamark:type": "notice", "seamark:notice:category": "no_overtaking", "seamark:notice:function": "prohibition"}})
    els.append({"type": "way", "id": 710002, "center": {"lat": line_pts[q+2][0], "lon": line_pts[q+2][1] + 0.0008}, "tags": {"waterway": "weir", "name": "Barrage de Test"}})
    els.append({"type": "node", "id": 700000, "lat": line_pts[len(line_pts)//2][0], "lon": line_pts[len(line_pts)//2][1] + 0.005, "tags": {"historic": "castle", "name": "Château Test", "wikipedia:en": "Test castle"}})
    return els

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 400, "height": 800}, device_scale_factor=2)
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        calls = {"ways": 0, "feats": 0}
        async def handler(route, request):
            url = request.url
            if "127.0.0.1:8766" in url: await route.continue_(); return
            if "leaflet.min.js" in url: await route.fulfill(status=200, content_type="application/javascript", body=LEAFLET_STUB); return
            if "leaflet.min.css" in url: await route.fulfill(status=200, content_type="text/css", body=""); return
            if "overpass" in url or "maps.mail.ru" in url:
                q = urllib.parse.unquote_plus(request.post_data or "")
                if 'way["waterway"="canal"]' in q and 'out geom' in q:
                    calls["ways"] += 1
                    if calls["ways"] == 1:
                        await route.fulfill(status=429, body="rate limited"); return
                    await route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements": elements})); return
                calls["feats"] += 1
                m = re.search(r"around:280,([\d.,\-]+)\)", q)
                nums = [float(x) for x in m.group(1).split(",")]
                pts = list(zip(nums[0::2], nums[1::2]))
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements": features_for(pts)})); return
            if "wikipedia.org" in url:
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"extract": "A test castle by the river.", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Test"}}})); return
            await route.abort()
        await page.route("**/*", handler)
        import threading, http.server, functools
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8766), functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/claude/paris-walk"))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        await page.goto("http://127.0.0.1:8766/canal.html", wait_until="load")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden')", timeout=60000)
        info = await page.evaluate("""() => ({ title: document.getElementById('title').textContent, len: Math.round(state.data.route.length), pts: state.data.route.line.length,
            locks: state.data.feats.locks.map(l => [Math.round(l.prog/100)/10, l.label, l.ref]), bridges: state.data.feats.bridges.length, moorings: state.data.feats.moorings.map(m=>m.name).slice(0,6), pois: state.data.feats.pois.length, limits: state.data.route.limits,
            cards: [...document.querySelectorAll('.card .n')].map(e=>e.textContent), status: document.getElementById('statusText').textContent })""")
        print(json.dumps(info, ensure_ascii=False, indent=1))
        # island check: the route should pass the lock arm (through lock 79), not the weir arm
        print("route passes lock arm:", await page.evaluate("state.data.feats.locks.some(l => l.ref === '79')"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_canal_start.png")
        # preview mid-route + direction toggle
        await page.evaluate("setPreview(state.data.route.length*0.45)")
        await page.evaluate("setPreview(state.data.feats.hazards[0].prog - 900)")
        print("hazards:", await page.evaluate("state.data.feats.hazards.map(h=>[h.kind,h.name,h.detail])"))
        print("hazard cards:", await page.evaluate("[...document.querySelectorAll('.card')].map(e=>e.className+' | '+e.querySelector('.k').textContent+' | '+e.querySelector('.n').textContent+' | '+e.querySelector('.s').textContent)"))
        await page.evaluate("document.getElementById('map').setSeamarks(true)")
        print("seamarks on:", await page.evaluate("document.getElementById('map').seamarksOn + ' / ' + document.getElementById('seamarkBtn').firstChild.textContent"))
        await page.evaluate("setPreview(state.data.route.length*0.45)")
        print("mid cards:", await page.evaluate("[...document.querySelectorAll('.card')].map(e=>e.querySelector('.k').textContent+' | '+e.querySelector('.n').textContent+' | '+e.querySelector('.d b').textContent)"))
        await page.click("#dirBtn"); await page.wait_for_timeout(50)
        print("back cards:", await page.evaluate("[...document.querySelectorAll('.card')].map(e=>e.querySelector('.k').textContent+' | '+e.querySelector('.n').textContent+' | '+e.querySelector('.d b').textContent)"))
        await page.click("#dirBtn")
        # nearby sheet
        await page.evaluate("document.getElementById('nearby').toggle(true)")
        await page.wait_for_timeout(100)
        print("nearby:", await page.evaluate("[...document.querySelectorAll('.poi .name')].map(e=>e.textContent).slice(0,8)"))
        await page.click(".tabs button[data-tab=ahead]"); await page.wait_for_timeout(50)
        print("ahead:", await page.evaluate("[...document.querySelectorAll('.poi .name')].map(e=>e.textContent).slice(0,8)"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_canal_sheet.png")
        await page.evaluate("document.getElementById('nearby').toggle(false)")
        # GPS simulation moving outbound then back
        await page.evaluate("""() => { navigator.geolocation.watchPosition = (ok) => { window._ok = ok; return 1; }; navigator.geolocation.clearWatch = () => {}; }""")
        await page.click("#gpsBtn")
        await page.evaluate("""() => { const r = state.data.route; let t = Date.now(); for (let k = 0; k < 10; k++) { const p = positionAt(r.line, r.cum, 20000 + k * 60).pos; _ok({coords:{latitude:p[0]+0.00005, longitude:p[1], accuracy: 10, speed: 1.8, heading: null}, timestamp: t += 30000}); } }""")
        await page.wait_for_timeout(100)
        print("gps out:", await page.evaluate("[state.data.dir, Math.round(state.data.progress), state.data.offWater, document.getElementById('statusText').textContent]"))
        await page.evaluate("""() => { const r = state.data.route; let t = Date.now(); for (let k = 0; k < 14; k++) { const p = positionAt(r.line, r.cum, 20540 - k * 60).pos; _ok({coords:{latitude:p[0], longitude:p[1], accuracy: 10, speed: null, heading: null}, timestamp: t += 30000}); } }""")
        await page.wait_for_timeout(100)
        print("gps back:", await page.evaluate("[state.data.dir, Math.round(state.data.progress), (state.data.speed||0).toFixed(2), [...document.querySelectorAll('.card .n')][0].textContent]"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_canal_gps.png")
        # cache on reload
        await page.reload(wait_until="load")
        await page.wait_for_function("document.querySelector('#overlay').classList.contains('hidden')", timeout=30000)
        print("calls:", calls, "(1/1 means cached)")
        print("errors:", errors)
        await browser.close()

asyncio.run(main())
