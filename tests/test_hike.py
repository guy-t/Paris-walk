import json, sys, asyncio, urllib.parse, base64
from playwright.async_api import async_playwright
sys.path.insert(0, "/home/claude/paris-walk/test")
from run import LEAFLET_STUB

STUB = LEAFLET_STUB.replace("L.control={ zoom:function(){ return { addTo:function(){} }; } };", "L.control={ zoom:function(){ return { addTo:function(){} }; }, scale:function(){ return { addTo:function(){} }; } };")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 400, "height": 820}, device_scale_factor=2, service_workers="block")
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        calls = {"overpass": 0, "wiki": 0, "tiles": 0}
        async def handler(route, request):
            url = request.url
            if "127.0.0.1:8767" in url: await route.continue_(); return
            if "leaflet.min.js" in url: await route.fulfill(status=200, content_type="application/javascript", body=STUB); return
            if "leaflet.min.css" in url: await route.fulfill(status=200, content_type="text/css", body=""); return
            if "opentopomap" in url:
                calls["tiles"] += 1; await route.fulfill(status=200, content_type="image/png", body=PNG, headers={"Access-Control-Allow-Origin": "*"}); return
            if "overpass" in url:
                calls["overpass"] += 1
                q = urllib.parse.unquote_plus(request.post_data or "")
                import re
                m = re.search(r"around:\d+,([\d.,\-]+)\)", q); nums = [float(x) for x in m.group(1).split(",")]; pts = list(zip(nums[0::2], nums[1::2]))
                mid = pts[len(pts)//2]
                els = [
                    {"type": "node", "id": 1, "lat": pts[1][0] + 0.001, "lon": pts[1][1], "tags": {"natural": "spring", "name": "Fuente Test"}},
                    {"type": "node", "id": 2, "lat": mid[0] + 0.003, "lon": mid[1], "tags": {"natural": "peak", "name": "Pico Test", "ele": "2100"}},
                    {"type": "node", "id": 3, "lat": mid[0], "lon": mid[1] + 0.001, "tags": {"amenity": "shelter"}},
                    {"type": "node", "id": 4, "lat": pts[-2][0], "lon": pts[-2][1] + 0.002, "tags": {"amenity": "restaurant", "name": "Bar Test", "opening_hours": "10:00-22:00"}},
                    {"type": "node", "id": 5, "lat": pts[0][0], "lon": pts[0][1] + 0.001, "tags": {"place": "village", "name": "Espinama"}},
                ]
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements": els})); return
            if "wikipedia.org" in url:
                calls["wiki"] += 1
                if "list=geosearch" in url:
                    qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query); lat, lon = map(float, qs["gscoord"][0].split("|"))
                    lang = "en" if "en.wikipedia" in url else "es"
                    body = {"query": {"geosearch": [{"pageid": 100 if lang == "en" else 200, "title": "Fuente Dé" if lang == "en" else "Fuente Dé (es)", "lat": lat + 0.002, "lon": lon}]}}
                else:
                    body = {"query": {"pages": {"100": {"extract": "Fuente Dé is a valley head in the Picos.", "fullurl": "https://en.wikipedia.org/wiki/Fuente_De"}, "200": {"extract": "Fuente Dé es...", "fullurl": "https://es.wikipedia.org/wiki/Fuente_De"}}}}
                await route.fulfill(status=200, content_type="application/json", body=json.dumps(body)); return
            await route.abort()
        await page.route("**/*", handler)
        import threading, http.server, functools
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8767), functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/claude/hike"))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        await page.goto("http://127.0.0.1:8767/hike.html", wait_until="load")
        await page.wait_for_timeout(500)
        print("library open:", await page.evaluate("document.body.classList.contains('library')"), await page.evaluate("[...document.querySelectorAll('.hike .t')].map(e=>e.textContent)"))
        await page.wait_for_timeout(500)
        print("lib stats:", await page.evaluate("[...document.querySelectorAll('.hike .stats')].map(e=>e.textContent.replace(/\\s+/g,' ')).slice(0,2)"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_hike_lib.png")
        await page.click(".hike[data-id='7_Espinama_High_Picos_circuit'] [data-act=open]")
        await page.wait_for_function("state.data.sightsStatus === 'ok'", timeout=15000)
        info = await page.evaluate("""() => ({ name: state.data.hike.name, len: Math.round(state.data.track.length), up: Math.round(state.data.track.up), down: Math.round(state.data.track.down), tobler: Math.round(state.data.track.tobler/60), wps: state.data.hike.wpProg.length,
            sights: state.data.sights.map(s => [s.name, s.group, s.kind, !!s.wiki]), tiles: [...document.querySelectorAll('#tiles .tile')].map(e => e.querySelector('.k').textContent + ' ' + e.querySelector('.v').textContent), status: document.getElementById('statusText').textContent, tilesReady: state.data.tilesReady })""")
        print(json.dumps(info, ensure_ascii=False, indent=1))
        await page.evaluate("setPreview(state.data.track.length * 0.4)")
        print("mid tiles:", await page.evaluate("[...document.querySelectorAll('#tiles .tile .v')].map(e=>e.textContent)"), await page.evaluate("document.getElementById('next').textContent"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_hike_preview.png")
        # GPS: on track from 30%, jittered, then 130 m off
        await page.evaluate("""() => { navigator.geolocation.watchPosition = ok => { window._ok = ok; return 1; }; navigator.geolocation.clearWatch = () => {}; }""")
        await page.click("#gpsBtn")
        await page.evaluate("""() => { const t = state.data.track; let now = Date.now() - 40*60000; for (let k = 0; k < 40; k++) { const p = positionAt(t.pts, t.cum, t.length*0.3 + k*40).pos; now += 30000; _ok({coords:{latitude:p[0]+0.00004, longitude:p[1], accuracy: 12, speed: 1.3, heading: null, altitude: 1200+k}, timestamp: now}); } }""")
        await page.wait_for_timeout(100)
        g1 = await page.evaluate("""() => ({ progress: Math.round(state.data.progress), off: state.data.offTrack, moving: Math.round(state.data.session.moving), trail: state.data.session.trail.length, strip: [...document.querySelectorAll('#strip .tile')].slice(0,7).map(e=>e.querySelector('.k').textContent+' '+e.querySelector('.v').textContent), eta: [...document.querySelectorAll('#tiles .tile .v')][3].textContent })""")
        print("gps on-track:", json.dumps(g1, ensure_ascii=False))
        await page.evaluate("""() => { const t = state.data.track; let now = Date.now(); for (let k = 0; k < 5; k++) { const p = positionAt(t.pts, t.cum, t.length*0.3 + 1600 + k*30).pos; now += 30000; _ok({coords:{latitude:p[0]+0.0012, longitude:p[1], accuracy: 12, speed: 1.2, heading: null}, timestamp: now}); } }""")
        await page.wait_for_timeout(100)
        g2 = await page.evaluate("() => ({ off: state.data.offTrack, offDist: Math.round(state.data.offDist), bearing: Math.round(state.data.offBearing), text: document.getElementById('offText').textContent, hidden: document.getElementById('off').classList.contains('hidden') })")
        print("gps off-track:", json.dumps(g2))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_hike_off.png")
        # sheet
        await page.evaluate("document.getElementById('nearby').toggle(true)")
        await page.wait_for_timeout(100)
        print("nearby:", await page.evaluate("[...document.querySelectorAll('.poi .name')].map(e=>e.textContent)"))
        await page.click(".tabs button[data-tab=sights]"); await page.wait_for_timeout(50)
        print("sights tab:", await page.evaluate("[...document.querySelectorAll('.poi')].map(e=>e.querySelector('.name').textContent + ' [' + [...e.querySelectorAll('.actions a')].map(a=>a.textContent).join(',') + ']')"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_hike_sheet.png")
        await page.evaluate("document.getElementById('nearby').toggle(false)")
        # finish -> record
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await page.click("#menuBtn"); await page.click("#finishBtn")
        await page.wait_for_timeout(100)
        print("records:", await page.evaluate("library.records('7_Espinama_High_Picos_circuit').map(r => [Math.round(r.dist), Math.round(r.elapsed), Math.round(r.moving), r.trail.length])"), "session:", await page.evaluate("state.data.session"))
        # offline prep with mocked tiles
        await page.evaluate("libraryPanel.open()")
        await page.wait_for_timeout(200)
        await page.click(".hike[data-id='8a_Fuente_De_Valley_circuit'] [data-act=offline]")
        await page.wait_for_function("document.querySelector('#progt-8a_Fuente_De_Valley_circuit').textContent.startsWith('Ready') || document.querySelector('#progt-8a_Fuente_De_Valley_circuit').textContent.startsWith('Done')", timeout=120000)
        print("offline:", await page.evaluate("document.querySelector('#progt-8a_Fuente_De_Valley_circuit').textContent"), "tile fetches:", calls["tiles"])
        await page.wait_for_timeout(800)
        print("badge:", await page.evaluate("document.querySelector('#off-8a_Fuente_De_Valley_circuit').textContent"))
        print("cached count check:", await page.evaluate("cachedCount(corridorTiles(library.get('8a_Fuente_De_Valley_circuit').pts)).then(n => n)"))
        await page.screenshot(path="/home/claude/paris-walk/test/shot_hike_lib2.png")
        print("calls:", calls)
        print("errors:", errors[:5])
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
