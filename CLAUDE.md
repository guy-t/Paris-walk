# Slow Navigator

Three navigation companions for travelling slowly: a Picos de Europa hiking
app, a boat companion for the Yonne and the Canal du Nivernais, and a Paris
walking guide. They are used on a phone, outdoors, often with no signal.

The repository is still named `Paris-walk`, so the GitHub Pages site is
`https://guy-t.github.io/Paris-walk/`. The local clone is usually
`slownavigator`; the remote name has not been changed.

## The one rule

**Nothing may require a manual step from the owner.** He updates these apps
from an Android phone while actually out walking. Every build, test and deploy
runs in GitHub Actions on push to `main`. Never finish a change with "now run
this locally" — if it cannot happen in CI, it needs saying out loud.

## Layout

```
packages/core     geometry, map-matching, the GPS tracker, sessions, GPX,
                  sun times, Overpass and Wikipedia clients, offline tiles.
                  No React, no Leaflet, no DOM beyond the browser APIs that
                  are the point. 180 unit tests.
packages/ui       MapView, ElevationProfile, Sheet, StatTile, Toast, and the
                  geolocation / wake-lock / service-worker hooks.
apps/web          one Vite app, one HTML entry per guide, two build targets.
apps/mobile       Capacitor shell (Android + iOS) wrapping the same build.
*.html (root)     the original single-file apps, STILL LIVE. Do not delete.
```

## Migration state

The three original single-file apps still serve their real URLs and are what
the owner relies on. Ports are published alongside at `/next/` and take over a
real URL only once that app has been walked with.

| App     | Original            | Port                 |
| ------- | ------------------- | -------------------- |
| Hike    | `/hike.html` (live) | `/next/hike.html` ✅ |
| Canal   | `/canalmap.html`    | not started          |
| Walk    | `/pariswalk.html`   | not started          |

When porting the remaining two, read the original HTML first — it is the
specification, and its constants were tuned against real journeys.

## Things that will catch you out

**Per-app tuning constants are deliberately not unified.** `HIKE_MATCH` vs
`WALK_MATCH`, `HIKE_TRACKING` vs `WALK_TRACKING`. A mountain track and a city
street need different match windows; averaging them regresses both. If a
refactor wants to merge them, the refactor is wrong.

**Distance comes from progress along the planned line**, never from summing
fix-to-fix gaps. Summing raw fixes counts GPS jitter as movement, so a phone
on a café table accrues a kilometre an hour and every average built on it is
wrong.

**GPS runs only while the page is visible.** That is not an oversight; the
screen costs several times more than the GNSS chip. The recorded trail has
gaps while the screen is off, and that is accepted — route position recovers
from the first fix on resume.

**`vite.config.js` shadows `vite.config.ts`.** Vite resolves `.js` first, so a
stray compiled config silently freezes the build. This happened: `tsc` emitted
one and every build ignored the real config for hours. The giveaway is an
output hash that does not change when you edit the config. Both are gitignored
now — do not add build-tool configs to `tsconfig.include`.

**Two web builds from one source.** Default targets Pages
(`/Paris-walk/next/`); `--mode native` produces the relative-base, no-worker,
no-sourcemap payload for the APK. Shipping the Pages build inside the APK
points every asset at a URL the phone may have no signal to reach.

**Base maps are pluggable** (`packages/core/src/providers.ts`). Every provider
listed there permits caching tiles for offline use — that is an entry
requirement, not a coincidence, and it is why Google is absent: its terms
explicitly forbid offline use and pre-fetching. Coverage boxes are approximate
and overlap near borders on purpose; which map to prefer is the app's call via
`PREFERRED_PROVIDERS`, not the geometry's.

**Marker classes are namespaced `mk-<kind>`.** A bare `.poi` on a map marker
matched the sheet's list-card rule and inherited its 12px padding, silently
tripling every dot on the map.

**A header rule can reach into the menu.** `header.bar button` also matched
every item in the dropdown — it lives inside the header — and beat
`.menu-list button` on specificity, so each item was styled as a white pill
for a dark green bar: white text on a white sheet. The menu rendered as a
list of grey subtitles with no titles at all, which is nearly impossible to
report as a bug. Header chrome is scoped to `header.bar > button` now. Check
new header rules the same way.

**The app says which build it is.** `SLOWNAV_VERSION` is stamped in by Vite
from CI — `2026.09.20.6 apk 3bd1f22` — and shown at the foot of the menu, in
About, and in the launcher's footer. A local build says `dev`. The short
commit is the point: an APK that silently failed to update looks exactly
like one built without the change, and the phone can now be asked.

**A .gpx has no MIME type Android agrees on.** Providers report one as
`application/gpx+xml`, `application/xml`, `text/xml` or
`application/octet-stream`, depending on which app is sending. So an
`accept` filter on a file input greys out the very file being reached for —
the picker is left unfiltered on Android and iOS (`gpxAccept`) and what was
picked is checked by parsing it. The intent-filters list every one of those
types for the same reason, `octet-stream` included, which is why the app also
appears in "Open with" for other unrecognised files.

**Capacitor delivers the launching intent twice.** `BridgeActivity.load()`
calls `onNewIntent(getIntent())` from inside `super.onCreate()`, so an
override sees the launch intent there as well as in `onCreate`. Without a
guard, one tap on an attachment imports the route twice. `MainActivity` marks
each intent with a `HANDLED` extra as it reads it.

**Always send `Cache-Control: no-cache` when checking the live site.** The
Pages CDN caches 404s, so a path a deploy just added keeps answering 404.

## Commands

```bash
pnpm install
pnpm typecheck          # tsc --build across all projects
pnpm test               # vitest, 180 tests
pnpm build              # web build for Pages
pnpm --filter @slownav/web build:native   # payload for the APK
pnpm --filter @slownav/web dev            # local dev server
```

`pnpm` comes from corepack. On Windows, `corepack pnpm ...` if the shim is not
on PATH.

## CI

| Workflow      | Trigger        | Does                                          |
| ------------- | -------------- | --------------------------------------------- |
| `deploy.yml`  | push to `main` | typecheck, test, build, publish to Pages       |
| `android.yml` | push to `main` | builds an APK, replaces the `android-latest` release |
| `ios.yml`     | push to `main` | compiles unsigned on macOS — a rot check only  |

The APK download URL is fixed:
`https://github.com/guy-t/Paris-walk/releases/download/android-latest/`

**Do not weaken the deploy checks.** Each exists because a deploy lied:

1. A workspace filter that matched nothing exited 0 and published an empty
   build. Filter by package name; `test -f` the built entry.
2. Pages served the branch while the artifact went nowhere, and every old URL
   kept working. The check asserts the built page is present **and** that a
   repo file absent from the artifact 404s.
3. A 200 on the HTML shell proved nothing. The check follows the `<script src>`
   the deployed page names and requires that to load too.

Pages source is set to "GitHub Actions" in repository settings. That had to be
done by hand once — the settings API needs repo-admin rights the default
`GITHUB_TOKEN` does not have.

## Not done yet

- Canal and walk ports.
- Native sensors: barometer (steady climb, unlike GPS altitude), step counter,
  background location. The seam is `PositionWatcher` in `@slownav/ui` — swap
  the watcher, change nothing else.
- Play Store internal track, for background APK updates. Needs a $25 account,
  an upload key in secrets, and one first release created by hand in the Play
  Console.
