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
                  sun times, Overpass and Wikipedia clients, offline tiles,
                  the forecast client, the barometric maths and the route-notes parser.
                  No React, no Leaflet, no DOM beyond the browser APIs that
                  are the point. 296 unit tests.
packages/ui       MapView, ElevationProfile, Sheet, StatTile, Toast, and the
                  geolocation / wake-lock / service-worker hooks.
apps/web          one Vite app, one HTML entry per guide, two build targets.
apps/mobile       Capacitor shell (Android + iOS) wrapping the same build.
*.html (root)     the original single-file apps, STILL LIVE. Do not delete.
```

Inside the hike app, roughly in the order a walker meets them:

```
App.tsx           the shell: header, live cue, dashboard, map, sheet, panels
useHike.ts        where the walker is — fixes, matching, session, sights
Dashboard.tsx     the tiles, elevation profile and next-waypoint strip
LibraryPanel.tsx  choose a hike, import GPX, prepare for offline
NearbySheet.tsx   the bottom sheet and its tabs
  NotesPanel      route notes, the step you are on held at the top
  WeatherPanel    forecast along the route, and the barometer
SettingsPanel.tsx base map, pace, units, alerts
model.ts          the library, settings, ETA, waypoints-along-the-track
importGpx.ts      one import path for the picker and for opened files
notes.ts          route notes: per-hike storage, import, placement
weather.ts        route sampling, arrival times, forecast cache
useWeather.ts     forecast + barometer state for the weather tab
```

`apps/web/src/shared/` is what differs by platform, all feature-detected:
`platform.ts` (native? which OS? the GPX picker's `accept`), `geolocation.ts`
(the `PositionWatcher` seam), `openedFiles.ts` (routes opened from Files or
an attachment), `barometer.ts` (the Android pressure sensor), `version.ts`
(the build string).

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
appears in "Open with" for other unrecognised files. Confirmed working on a
real phone — tapping a .gpx and choosing the app imports the route.

**Capacitor delivers the launching intent twice.** `BridgeActivity.load()`
calls `onNewIntent(getIntent())` from inside `super.onCreate()`, so an
override sees the launch intent there as well as in `onCreate`. Without a
guard, one tap on an attachment imports the route twice. `MainActivity` marks
each intent with a `HANDLED` extra as it reads it.

**`store.set` returns false; it does not throw.** A full quota or switched-off
site data both land there. Ignoring the result is how a hike gets imported,
announced, and never saved — missing from the list then and after a restart,
with the app insisting it arrived. Callers that are storing something the
walker will look for must check it. Menu → Storage & saved data reports what
is stored and whether a 64 kB write actually succeeds, which is the only
honest way to ask: localStorage never states its limit.

**The forecast is a contract with someone else's service.** Open-Meteo is
used because it takes an elevation per point, answers for several points in
one request, needs no key and permits caching — the same entry requirement
the map providers meet. The field names it is asked for live in
`HOURLY_FIELDS`, and the unit tests prove the *parser* against a fixture,
which proves nothing about whether the service still sends those fields. So
`weather.contract.test.ts` calls the live API, gated behind
`WEATHER_CONTRACT=1` and run by `weather.yml` on a schedule and on forecast
pull requests. It is deliberately not part of `deploy.yml`: a walk must
never be blocked because a weather service is having an afternoon.

**Barometric altitude is only as good as its reference.** Pressure gives a
beautifully smooth height *change*, which GPS cannot; absolute height needs
a sea-level pressure, and that moves with the weather — 30 hPa between a
deep low and a strong high is 250 m of error. The forecast's `pressure_msl`
is used when there is one and the reading says which it used. Never present
an uncalibrated pressure altitude as if it were a position. The sensor is
Android-only (no shipping web API exposes a barometer) and absent on many
phones, so everything degrades to nothing through `barometerAvailable()`.

**Route notes never enter this repository.** They are the walking company's
words — a personal copy of a copyrighted document, with the host's mobile
number in it. They are imported from a file on the phone, kept in that
device's storage under `hike:notes:<id>`, and forgettable from the tab.
Every test is written against notes invented for the purpose. Do not commit
a transcription, paste one into an issue, or put one in a PR body.

**The route-notes format is the printed page, typed out.** `# name`, an
optional `> summary`, `## ` per variant, then one step per paragraph
beginning with its cumulative time and distance — `0:27 2.1km  Turn R onto
the walkway…`. A line indented two spaces is an aside rather than an
instruction; one starting `!` (or with CAREFUL / Be aware) is a warning. A
waypoint in square brackets anchors the step, whether it leads the sentence
(`[1] Cross the road`) or sits inside it (`For the [Hotel del Oso]`) — but
only when there is exactly one, so a paragraph naming two places anchors to
neither. Transcribing is copying, which is the point: the fewer decisions
between the page and the file, the fewer distances get mistyped.

**A waypoint's position on a self-overlapping track is ambiguous.** Because
the day-1 file holds both variants end to end, and both start at the
monastery, the single `Monastery Santo Toribio` waypoint is 33 m from the
track at 7.74 km and 51 m from it at 21.60 km. The nearer is the harder
option's pass; the main route reaches it at the further one. So an anchor
can be confidently, badly wrong.

Two mechanisms, and the order between them matters. `projectAll` offers
every pass rather than only the nearest. `placeSteps` then agrees on the
*nearest* position of each name first — keeping the longest mutually
consistent run, so a wrong anchor is dropped instead of dragging the day —
and only afterwards lets a further pass fill a gap, and only where it slots
between anchors already agreed. It can add, never displace.

**Consistency is not correctness**, which took a measurement to see. Taking
the longest consistent run over *all* passes at once looks more principled
and is worse: more candidates mean more ways to build a long chain, and the
longest is not the truest. Tried that way, day 1 moved waypoint `1` by more
than a kilometre and stretched the walk by a fifth, while "fixing" the
monastery. Any future change here needs measuring against the real file, not
reasoning about.

**A GPX handed out with route notes is not always one clean line.** The
day-1 file for Potes to Cosgaya is 34.6 km for a 14.5 km walk: it holds the
harder option and the main route end to end in one track, the harder option
first. So `placeSteps` fits each variant to *its own* anchors rather than
assuming the notes start where the track starts — that assumption put the
second instruction eleven kilometres out. The anchors are the bracketed
waypoints, whose names match the GPX's own (`[1]`, `[A]`,
`[Hotel del Oso]`), plus places named in a step's *last sentence* — "to
reach a crossroads in the hamlet of Congarna" means the step ends there, so
it anchors the step after it. Only the last sentence: a place named earlier
is usually one you pass or can see, and anchoring on a sighting is worse
than not anchoring. Everything between anchors is interpolated, which
rescales the printed kilometres onto measured ones. Congarna, Beares and
San Pelayo land exactly; the fit elsewhere is within about 150 m.

**No AI API belongs in the app.** It has been considered, for matching
route notes to the route, and turned down: the bracket-to-waypoint link is a
dictionary lookup and the rest is interpolation, so a model could only make
an exact answer non-deterministic. The three hard objections outlast the
question — an API key shipped in an APK is a published key (anyone can
unzip it), a network call is worth nothing on the hill, and it would mean
sending a copyrighted document with someone's mobile number in it to a third
party. Where a model does earn its place is turning a scanned PDF into the
notes format, which happens once per day, off the phone.

**Always send `Cache-Control: no-cache` when checking the live site.** The
Pages CDN caches 404s, so a path a deploy just added keeps answering 404.

## Commands

```bash
pnpm install
pnpm typecheck          # tsc --build across all projects
pnpm test               # vitest, 296 tests
pnpm build              # web build for Pages
pnpm --filter @slownav/web build:native   # payload for the APK
pnpm --filter @slownav/web dev            # local dev server
```

`pnpm` comes from corepack. On Windows, `corepack pnpm ...` if the shim is not
on PATH.

## CI

| Workflow      | Trigger                  | Does                                          |
| ------------- | ------------------------ | --------------------------------------------- |
| `deploy.yml`  | push to `main`, and PRs  | typecheck, test, build; publishes to Pages only on `main` |
| `android.yml` | push to `main`, and PRs  | builds an APK; publishes the `android-latest` release only on `main` |
| `ios.yml`     | push to `main`           | compiles unsigned on macOS — a rot check only  |
| `weather.yml` | forecast PRs, weekly     | calls the live forecast API and checks the fields still exist |

A pull request runs both workflows' gates and publishes nothing. In each,
the publishing steps are skipped individually rather than the job being
split, so the run that guards a change is the same run that would ship it —
on `android.yml` that means a PR compiles the Java and asserts the APK was
produced, but does not unlock the signing key or touch the release.

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
- **The first 675 m of day 1 are extrapolated**, backwards from waypoint
  `1`, because nothing in Potes anchors: `Casa Cayo` is named mid-sentence
  (a sighting, not an arrival) and the supermarket only in an aside. The
  error is small — the scale is well determined by the anchors after it —
  and `projectAll` did not change it, since every position it recovers is
  further along. Worth revisiting only if a day turns up whose first
  kilometres are visibly wrong.
- **A variant is chosen, not detected.** The switcher in the Route notes tab
  sets which line the walker is on. The app could notice that the position
  matches the other variant's stretch and offer to switch, but being asked
  "are you on the hard one?" halfway up a muddy path is worse than choosing
  at the signpost.
- Native sensors: step counter and background location. The seam is
  `PositionWatcher` in `@slownav/ui` — swap the watcher, change nothing else.
  The barometer is done: `SlowNavBarometer` in `MainActivity`, read through
  `shared/barometer.ts`.
- iOS gets neither the barometer nor "open with": both need document types
  and UTIs declaring in the Xcode project. Nothing breaks the iOS build.
- The forecast is Android- and browser-wide, but the barometer half of the
  weather tab only appears where the sensor does.
- Play Store internal track, for background APK updates. Needs a $25 account,
  an upload key in secrets, and one first release created by hand in the Play
  Console.
