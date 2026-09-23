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
                  are the point. 271 unit tests.
packages/ui       MapView, ElevationProfile, Sheet, StatTile, Toast, and the
                  geolocation / wake-lock / service-worker hooks.
apps/web          one Vite app, one HTML entry per guide, two build targets.
apps/mobile       Capacitor shell (Android + iOS) wrapping the same build.
*.html (root)     the original single-file apps, STILL LIVE. Do not delete.
```

Inside the hike app, roughly in the order a walker meets them:

```
App.tsx           the shell: header, live cue, dashboard, map, sheet, panels
                  (the cue sits between dashboard and map — confirmed as the
                  right place by the owner, at an actual junction)
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
useSteps.ts       the step counter: the day's total, cadence, and how far the
                  walker has come since the route position was last known
```

`apps/web/src/shared/` is what differs by platform, all feature-detected:
`platform.ts` (native? which OS? the GPX picker's `accept`), `geolocation.ts`
(the `PositionWatcher` seam), `openedFiles.ts` (routes opened from Files or
an attachment), `barometer.ts` (the Android pressure sensor), `steps.ts` (the
Android step counter), `version.ts` (the build string).

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

**The two ports are deliberately parked** until after the Picos hiking week.
The hike app is what is being walked with; changing the other two now buys
nothing and every change is one more thing that could be wrong in a valley
with no signal. Do not start a port without being asked.

## Things that will catch you out

**Per-app tuning constants are deliberately not unified.** `HIKE_MATCH` vs
`WALK_MATCH`, `HIKE_TRACKING` vs `WALK_TRACKING`. A mountain track and a city
street need different match windows; averaging them regresses both. If a
refactor wants to merge them, the refactor is wrong.

**Distance comes from progress along the planned line**, never from summing
fix-to-fix gaps. Summing raw fixes counts GPS jitter as movement, so a phone
on a café table accrues a kilometre an hour and every average built on it is
wrong.

**GPS runs only while the page is visible — unless the walker asks
otherwise.** That default is not an oversight; the screen costs several times
more than the GNSS chip. The recorded trail has gaps while the screen is off,
and that is accepted — route position recovers from the first fix on resume.

`Settings → Keep recording with the screen off` swaps in the Android
foreground service instead (`bgGps`, default off, and the row only appears
where `backgroundTrackingAvailable()` says it can be done). The whole change
is the watcher: `PositionWatcher.keepsRunningInBackground` tells
`useGeolocation` not to stop on hide and not to reset the tracker on resume,
because there was no gap to forget across. Nothing in the GPS logic, the
session or the map knows which watcher it is talking to.

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

**The foreground service queues; it does not push.** While the app is hidden
its JavaScript is not running to be called, so `TrackingService` holds what it
collects and the web layer drains the queue — on a timer while visible, and
immediately on becoming visible, which is the moment the backlog matters.
Fixes come back oldest first and are folded in order, because the tracker
reads a fix out of order as a jump down the route and back. Past 3000 held
fixes every second one is dropped rather than the oldest: for a trail, half
the resolution over the whole gap beats full resolution over the end of it.

It is built on the framework's `LocationManager`, not Play Services — no new
dependency, nothing added to the APK, nothing for CI to resolve, and the
fused provider's cleverness is aimed at cars. `ACCESS_BACKGROUND_LOCATION` is
deliberately *not* requested: a foreground service of type `location` started
while the app is on screen keeps the ordinary while-in-use permission alive
for as long as it runs, so asking for the background one would gain nothing
and is a far larger thing to ask of someone.

**The satellites, and nothing else.** The service asked `NETWORK_PROVIDER`
as well as GPS, on the reasoning that another source of fixes could only
help. It cannot. A network fix is trilaterated from cell towers and wifi,
which in a valley with one tower on a ridge is kilometres out, and every one
of them went into the queue beside the good ones. Reported from the hill as
losing accuracy "by a km" with background recording on — and it was only
with it on, because the foreground watcher asks for high accuracy, which is
GPS alone. Turning the setting on must change whether fixes keep arriving,
never what kind of fix they are.

The tracker's `weakAccuracy` (120 m for the hike) held most of them out of
the route position, but a weak fix still moves the dot on the map, which is
what a walker sees. And an accuracy was being *invented* — a fix that did
not state one was called 50 m, on both sides of the bridge, which tells the
tracker it is worth acting on. That is the one judgement the tracker has to
make for itself. The service drops a fix with no stated accuracy now, and
`parseFixes` gives anything that still arrives without one a value past
every weak threshold, so it shows without moving the walker along the route.

**A watch handle only means something to the watcher that made it.** Turning
background recording off mid-walk left the foreground service running, with
its notification and the GNSS chip, for the rest of the day. `stopWatch` used
whatever watcher was current at the time — by then the new one — and handed
it a handle belonging to the old: an object, to a watcher that takes a string
id, which it ignored without complaint. The live watch is stored with its
owning watcher now. Any future provider swap has the same trap.

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

**A barometer on a walker measures the hill, not the weather.** Reported
from the hill: walking uphill made the app announce a storm. It was right
to — the trend was computed on raw station pressure, where 1 hPa is 8.5 m,
so 26 m of ascent in three hours is the whole conventional "falling
quickly" threshold and day 2's 745 m of climb reads as −84 hPa, against the
roughly 30 hPa that separates a deep low from a strong high. Every walking
day tripped it, permanently.

Each reading is therefore stamped with where the walker was — the route's
own surveyed profile, not the GPS's altitude, which is the phone's worst
number — and `pressureTrend` reduces every sample to sea level before
comparing. A reading whose height is unknown is dropped rather than mixed
in, because half a series reduced and half not carries the whole hill into
the answer. Each end of the window is a 15-minute median, so one reading
taken in a doorway cannot announce a storm.

The reduction needs the air temperature too, which is less obvious and was
found by making the fixture physically consistent. Reduce through the
*standard* column and the residual scales with height: the same climb on a
−15 °C day still leaves 3.4 hPa behind, which is the entire threshold again.
With the forecast's temperature at the walker's point the hill cancels
exactly — measured, 86.9 hPa of climb reading as +0.0 hPa over three hours.
A fixture that generates standard-atmosphere pressure and then labels it
−5 °C contradicts itself and will make this look right when it is not.

**Barometric altitude is only as good as its reference.** Pressure gives a
beautifully smooth height *change*, which GPS cannot; absolute height needs
a sea-level pressure, and that moves with the weather — 30 hPa between a
deep low and a strong high is 250 m of error. The forecast's `pressure_msl`
is used when there is one and the reading says which it used. Never present
an uncalibrated pressure altitude as if it were a position. The sensor is
Android-only (no shipping web API exposes a barometer) and absent on many
phones, so everything degrades to nothing through `barometerAvailable()`.
Confirmed working on the owner's phone: pressure, trend and a calibrated
height all read correctly.

What the number is worth, once the sea-level pressure is known: the sensor
at ±1 hPa is ±9 m, the forecast's own `pressure_msl` error about the same,
and the largest term left is the air not being at standard temperature.
That one runs the intuitive way — cold air is dense, so the formula reads
high — and it is not small: +53 m at 1900 m on a −5 °C morning, −45 m at
1100 m on a 20 °C afternoon. `correctForTemperature` takes it out using the
forecast's temperature at the walker, one pass from the uncorrected height
as its guess, which lands within a couple of metres. So roughly ±15 m
corrected, and the panel says so rather than showing four confident digits.

None of which touches what the instrument is actually good at: 10 m of
climb is 1.08 hPa and the sensor resolves about 0.05, so *change* is good
to well under a metre. Excellent at "am I still going up", fair at "how
high am I", and the UI should never let those two be confused.

**The ETA is walking time, and the comparison is moving against moving.**
Tobler's hiking function over the remaining profile, scaled once there is a
sample by how the walker is actually going. It used *wall-clock elapsed*
against Tobler's *moving* prediction, which is two different quantities, and
the error was large in both directions. The session starts when the hike is
opened, so a phone opened over breakfast and carried out of the door an hour
later hit the 20-minute gate with 80 minutes of elapsed against 20 of
predicted — a factor of 4, clamped to 3, and an arrival three times Tobler
for the rest of the day. And every break was extrapolated: 45 minutes of
lunch after two hours of walking made the factor 1.4, applied to all the
distance left, charging the walker for a second lunch and a third.

So breaks are deliberately *not* in the number. It answers "how long am I
still walking for" — which is what On Foot's own "4 hrs walking" means,
against their "allow 5¼ hrs" — and the strip's Elapsed and Moving tiles show
what the stops have cost. A raw running average of speed would be worse than
either: 3 km/h up a 20% slope and 3 km/h on the flat say completely
different things about what is left, which is the whole reason for scaling
Tobler rather than averaging speed.

**The flat-ground pace is 4.2 km/h, and it was measured.** At the 5 km/h
this shipped with, the app's plan ran 7–15% ahead of the walking company's
own times for the same four tracks — 3h35 against 4h00 on day 1, 2h08
against 2h30 on day 4. Matching them takes 4.2–4.6. It only decides the
first twenty minutes of a walk, after which the walker's own pace takes
over. `loadSettings` moves a stored pace of exactly the old default to the
new one, because stored settings win over `DEFAULT_SETTINGS` and the change
would otherwise reach nobody who had ever opened the settings panel; a pace
deliberately set to anything else is left alone.

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

**The embedded library is generated, not typed.** `apps/web/src/hike/tracks.json`
is built from `tracks/*.gpx` by `scripts/build-tracks.mjs`, and `deploy.yml`
runs it with `--check` so the two cannot drift. It exists because the
hand-made copy shipped the whole of each file: one day's GPX carries the
route as several named sub-tracks — a `SPINE`, an `OPTION` for the harder
alternative, an `END` per possible hotel — and `parseGPX` concatenates every
`<trkpt>` in the document, which is the only honest thing to do with a file
it has never seen. Day 1 was therefore 34.6 km of line for a 14.5 km walk,
with a straight-line jump between each piece, and every distance, ETA and
next-waypoint built on it was wrong. It is 14.54 km now, and the worst
waypoint residual across the four days went from 1136 m to 19 m.

A harder option is *spliced* into the main line where it branches and
rejoins, so the variant is a whole day rather than the middle of one, and it
ships as its own hike. The `without` list in `LINES` cannot be derived from
the geometry and so is written down: waypoint `A` on day 1 is metres from
the monastery the main route also passes, so a 150 m rule would keep it and
anchor the harder option's notes onto a line it does not walk, while `Hotel
Cosgaya` is 40 m from the end of the line and has to stay although the spur
to its door does not. The ids are frozen — they key `hike:notes:<id>` and
the saved session, so renaming one on the eve of a walk loses both. The day
number lives in the display name instead.

**A day that forks is two hikes but one day.** The harder option ships as its
own line, because one GPX document is one polyline to the map-matcher. Every
piece of state a walker accumulates therefore hangs off `dayId(hike)` — the
main line's id, even while walking the option — and not off the line they
happen to be on: the route notes (`hike:notes:<day>`), which variant they
chose, the live session, and the history. Per-line things key off `hike.id`
instead, because they genuinely differ: the tile cache, the sights along it,
the forecast sampled along it.

The pills in the Route notes tab now swap the line as well as the text.
`lineForVariant` matches a variant to a line **by position**, not by name:
the ids come from the headings in the file the walker imported
(`## Harder option` → `harder-option`) and next week's notes may word it
differently, but the printed notes always give the main route first and each
alternative after. `scripts/build-tracks.mjs` refuses to emit an option
listed before the line it forks from, since that would swap the two silently
and the only symptom would be the wrong instructions at a junction.

Swapping is not resuming, which is why `openHike` works out for itself
whether this is a swap (same day, different line) and then leaves the
tracker unanchored. The two lines share their first kilometres, so at the
branch the carried-over progress is right — but anchoring anywhere else
would aim the matcher at a distance measured along the line just left.
Unanchored, the first fix searches the whole new line and finds the walker.
Measured on the built app: swapped at the monastery, one fix later the
dashboard read 2.9 km done of the harder line's 14.1 km, tracking, not off
route, and the session's `start` was unchanged.

`openHike` also flushes the outgoing session before replacing it. Saves are
otherwise every 20 seconds, so switching lines mid-walk dropped whatever had
accrued since the last one — visible in the measurement above as a stored
`maxProg` of 0 before the swap and 3342 after it.

**The sheet has to fit, and it did not.** `flex-shrink: 0` with
`max-height: 58vh` asked for 429px of a 740px phone while the header (56) and
dashboard (269) took 325 and the map refused to go under its 160px minimum.
56+269+160+429 = 914, `#app` clips its overflow, and the bottom third of the
sheet was simply off the screen — the list still scrolled, but its last rows
could never be reached and there was no visible bottom edge to say why.
Reported from the hill as "can't scroll", against both the route notes and
the water list. The sheet shrinks now; the map gives up most of its minimum
while the sheet is open (`body.sheet-open`), and the dashboard gives up its
profile and stat strip, which nobody reads while following an instruction.
Measured at 360×740: 167px of clipped list before, 274px of reachable list
after, nothing hanging off the bottom. Any new fixed height in that column
has to be checked the same way — the clipping is silent.

**A walker cannot move 200 m in five seconds, and the tracker used to let
them.** Reported from the hill as the position jumping around, and the route
notes going out of step with the walk after a stretch of weak signal. Both are
the same mechanism. `HIKE_MATCH` gives a forward jump of up to `aheadFree`
(200 m) for nothing, and `HIKE_TRACKING` had `confirm*: 1`, so a single fix
could move the route position 200 m — which is two minutes of walking, and
often a whole instruction — and the next one move it back.

Simulated along the four real day tracks, a walker at 4.2 km/h with ordinary
12 m fixes: on the day-3 circuit, whose start and end are the same place, the
route position latched onto the *end* of the line within the first 200 m and
read 14.6 km done of 14.7 km, for a third of a kilometre of walking. Over a
day of 90 m fixes — which is what a phone under a cliff honestly reports, and
is *under* the 120 m `weakAccuracy` gate, so every one of them was matched —
the route position was up to 642 m from the walker and moved by more than
150 m between two consecutive fixes 120 times.

Three changes, all measured on those tracks:

- **Pace is a limit, not a penalty.** What the match may move the route
  position by is `maxAdvance` (2.5 m/s) × the time since it last moved, plus
  `advanceSlack`. Five seconds of that is 72 m; the twenty minutes a pocket
  took is 3 km — so one rule covers a noisy fix and a drained queue, and the
  match's `aheadFree` and `windowAhead` are set from it per fix rather than
  fixed. A walker who really has gone further is the jump path's business,
  and that wants `confirmJump` fixes agreeing first.
- **The hike confirms now too**: 2/3/3, as the walk config always has. The
  comment in `tracker.ts` said it should be tried on a real walk before being
  adopted; it has been.
Measured after: day 3's 14.6 km error becomes 93 m, the 642 m becomes 426 m,
the median error through a weak stretch halves, and the 120 lurches become 3.

That change also made `offThreshold` scale with the fix's accuracy, and both
halves of that were wrong. It never reached the phone at all — `openHike`
passes `offThreshold: settings.off`, a plain number, so the app has always
used a flat threshold whatever `HIKE_TRACKING` says. And it should: measured
on the day-1 line through 3 km of 90 m fixes, widening it cut the false
off-route flags from 889 of 2565 to 222 and made the worst position error
*worse*, 324 m to 426 m. **The threshold is not only a display decision.** It
is how a bad match gets escalated — a fix rejected by it raises `offCount`,
which consults the whole line and can resync — so widening it leaves the
wrong match looking on-route and nothing ever asks the better question.

Crying wolf is the cheaper fault and is fixed where it belongs: `useHike`
raises the banner and the buzz only for a distance the fix's own accuracy does
not already explain (`offDistance > max(settings.off, accuracy)`), while the
tracker goes on treating it as off-route internally. Display and matching are
different questions and were being answered with one number.

**Holding a position is not knowing it, and the tracker has to admit which.**
A fix vaguer than `weakAccuracy` is held — `progress` does not move — which
is right for a fix or two and a lie after ten minutes. It was a lie in two
ways. `lost` stayed false, so the next usable fix searched a window around
where the walker was before the cliff rather than the whole line; `holdLimit`
(600 s) now gives up, and the window meanwhile grows with the gap, so nothing
depends on the walker having stayed put. And the screen said nothing: the cue
went on showing "in 300 m" measured from a position half an hour old, which
is the worst kind of wrong, because it looks right. `TrackerState.heldFor`
carries the age of the route position, and past two minutes the cue's second
line says `position 8 min old` in amber instead of a distance, with the
dashboard's status line saying the same.

**A circuit's first fix is a coin toss, so somebody has to say which end.**
Reported from the hill: day 3 loaded and snapped to the finish — `Done
14.7 km, To go 0.0 km, Climb left 0 m, ETA 0 min`, on the first fix, before a
step was walked. Reproduced on the built app.

`openHike` anchored the tracker only when there was a session to resume, so a
hike opened fresh started `lost`, and the first fix searched the whole line
with no preference at all — `global: true` drops the progress penalties by
design. Day 3's circuit begins and ends 64 m apart (day 4's, 57 m), so a
first fix 30–60 m out, which is ordinary before the GNSS has settled, scores
better against the *end* of the line. Then it tended to stay: the return leg
runs alongside the outward one, so the windowed match kept succeeding and the
jump path was never asked. Measured from the trailhead with 100 m fixes it
happened 21 times in 200.

The honest prior is that a walker opening a hike has not walked it, so every
fresh open now anchors at 0 — the window is ±1500 m and the finish is simply
out of reach. Measured: once in 400 with 100 m fixes, and that one recovers
inside the first kilometre. A walker who really does open the app part-way
along loses nothing, because the jump path finds them in three fixes: 15
seconds, measured from 4 km and from 9 km along day 3.

A *swap* between a day's two lines is still deliberately left unanchored, for
the reason given above — there the carried-over distance is measured along the
line just left.

**Steps are a distance, never a position.** The step counter is the one
instrument in the phone that goes on measuring the walk when the satellites
stop: TYPE_STEP_COUNTER is a hardware register that counts since the last
reboot whether or not anything is listening, so it spans a pocket and a cliff
alike. That is what it is here for — while the route position is held, it can
say roughly how far the walker has come since it was last known, which is the
other half of `heldFor`. The cue shows `position 10 min old · ≈730 m walked`,
and the walker swipes the instruction on if that looks right. Nothing in the
app ever moves the route position on it: steps measure ground covered, and a
walker who took a wrong turn covered just as much. Same rule as the
uncalibrated pressure altitude, for the same reason.

The stride is measured, not asked for, by pairing the session's distance —
metres of confident progress along the line, already filtered of jumps — with
the steps over the same ten seconds. A sample outside 0.4–1.1 m a step is not
a walker and is rejected rather than averaged in, which is what makes a held
stretch (steps, no metres), a cable car (metres, no steps) and a re-sync all
fall out on their own. It is stored per walker (`hike:stride`), so day 2
starts calibrated. And `cadence` refuses a rate past 220 /min: a browser
measurement read 11,005 steps a minute when the two numbers being divided did
not belong to each other, which is exactly the nonsense a dashboard must not
show.

`settings.steps` is **off** by default, because from Android 10 the counter
needs `ACTIVITY_RECOGNITION` — a runtime permission, so a question, and
nobody is asked one they did not invite. Turning the row on is what asks; the
row only appears where `stepCounterPresent()` says the sensor is there, and
`available()` stays false until the answer comes back on the `slownav:steps`
event. Unlike the barometer the listener is deliberately *not* unregistered
in `onPause`: the register counts in hardware anyway, the listener costs tens
of microamps, and what it buys is a count that spans the pocket — which is
the whole point.

**One buzz as each instruction becomes current** (`settings.cueVib`, on by
default). It is the cheapest thing in the settings panel — no permission, no
sensor, no measurable battery — and it means walking with the phone in a
pocket and looking only when there is something to read, at the junction
rather than fifty metres past it. Two pulses for a step carrying a warning,
because CAREFUL should be distinguishable from "turn R" without looking.
Forwards only and only while tracking: the preview slider walks a whole day
in a second, and a cue moving backwards is the walk being re-matched, not a
junction. Measured on the built app against day 1: 25 buzzes over 14.5 km,
one of them the warning.

**A cue read off the distance walked needs a manual override.** `stepAt`
picks the last instruction at or behind the walker, which is right until the
walk and the notes part company: a missed turn, a stretch covered with the
screen off, a variant taken that the app was not told about. Reported from
the hill: the cue sat on `[D]` for a long time with no way to move it on,
which is the worst case, because the single instruction on the screen is
then confidently wrong. A swipe holds a step of the walker's choosing — left
for the next, the way a page turns; the hold is released by the walk catching
up with it or by the one button on the cue, never silently, since a cue that
sprang back mid-read would be worse than one that is stuck.

**The cue is as tall as its instruction**, and the map yields to make it so.
`overflow: hidden`, added so the card could slide cleanly under a swipe, also
drops a flex item's automatic minimum size from its content to zero — so the
cue became the only thing in the column that could be squashed, the map being
pinned at a 160px floor, and it absorbed the shortfall by cutting the last
lines off the instruction. Silently: three of day 1's notes lost up to 33px,
two lines of the sentence saying where to turn. The map's floor is 96px now
and only binds when the column is short; when an instruction still will not
fit, the dashboard's profile and stat strip step aside, as they already do
for the sheet.

The next-waypoint row goes too whenever a cue is showing (`body.has-cue`).
It was the dashboard's answer to "what is coming" before the route notes
existed; the cue answers it better, with the instruction rather than the name
of the next dot, and one row higher. It returns for a hike with no notes
imported, where it is the only answer there is.

That fit test is a measurement, not a threshold, because the right threshold
differs on every screen. It takes the class off, reads, and puts it back in
one pass — reading a layout property forces the recompute, so what it sees is
the room the cue would have with the dashboard whole, and no frame passes for
anything to be painted in. Going through React and a `requestAnimationFrame`
instead is a race: the frame can arrive before the state has committed, and
then the reading is of the layout this very decision produced.

What it must not do is measure a layout that is still moving. Every trigger
is state the component already holds — the step, the sheet, compact,
map-full, the panel — plus `resize` and, crucially, the sheet's
`transitionend`. The sheet animates its `max-height` over 250ms, and a
measurement taken during that reads 19px of cue, concludes nothing fits, and
stands for the rest of the walk. Watching the dashboard's own size instead
would be worse still: that is the thing this decision changes, so it flaps.

Measured across 360×900, 740, 640 and 560, stepping every instruction of
day 1: the longest note (217px) shows in full at all four, the profile is
kept at 900 and 740 where there is room and spent at 640 and 560 where there
is not.

It was two 40px arrows before, either side of the one thing on screen worth
reading: a third of the width of a 360px phone spent on chrome, on the line
a walker has to take in at a junction. The instruction has the full width
now, and everything about it sits on a second line — where it is ("in 10 m",
"1.8 km back", so a stalled cue looks stalled), and either the next one's
distance or `Back to live`. The card follows the thumb while dragging and
springs back from a short drag, which is the whole affordance now that
nothing on screen says the gesture exists; `touch-action: pan-y` keeps the
page's vertical scrolling. Arrow keys still work, which is all the buttons
were doing for anyone who needed them.

`stepAt` also returned nothing at all before the first instruction. The
notes are fitted to the measured line, so step one lands a few metres along
rather than at zero: day 1's is at 10 m, and the header was blank until the
walker had left the bridge in Potes. It falls back to the first step now.

**Two altitudes, and only one of them said so.** The dashboard tile showed
the GPS's; the weather tab showed the barometer's. A GPS fix is routinely
10–30 m out vertically, which is the whole reason the barometer is read, so
the dashboard prefers it — but only when calibrated, because an uncalibrated
pressure altitude can be a couple of hundred metres out and must never be
presented as a position. The tile names its source (`barometer`, `GPS`,
`from the map`). Measured with a stubbed forecast and a fake sensor: both
screens read 304 m.

**Offline stopped one zoom short, and the map asked for what it lacked.**
`sourceForProvider` capped downloads at z16 while the Spanish IGN serves
genuine detail to 17, and the map was handed the provider's own
`maxNativeZoom`, so zooming in requested tiles the download had never been
asked to save — a blank screen, reported from the hill. `OFFLINE_TOP_ZOOM`
is 17 and both ends use it: the downloader fetches to it, and the map's
`maxNativeZoom` is clamped to it so anything deeper upscales what is cached.
Soft, never blank, which is the right way round here. Day 1 on the IGN goes
from 432 tiles (9 MB) to 1217 (31 MB). 18 is deliberately not offered: four
times the tiles again, about 3,900 for one day, for detail a 1:25,000 survey
does not have — and on a volunteer server it would stop being the bounded
download that makes caching acceptable at all.

**Waypoint names can hide in an extension.** Garmin writes some points with
no `<name>` at all and the label in
`<extensions><label_text>`, which no reader is obliged to look at. Three of
the Picos waypoints were like that — Aliva Refuge, the Fuente Dé cable car,
Hostal Puente Deva — so `[Aliva Refuge]` in the notes anchored nothing and
the whole day slid. The generator falls back to `label_text`, and `RENAME`
fixes the handful whose words still differ from the printed page.

**No AI API belongs in the app.** It has been considered, for matching
route notes to the route, and turned down: the bracket-to-waypoint link is a
dictionary lookup and the rest is interpolation, so a model could only make
an exact answer non-deterministic. The three hard objections outlast the
question — an API key shipped in an APK is a published key (anyone can
unzip it), a network call is worth nothing on the hill, and it would mean
sending a copyrighted document with someone's mobile number in it to a third
party. Where a model does earn its place is turning a scanned PDF into the
notes format, which happens once per day, off the phone.

**The hike already open needs a way back, not an Open.** The library row for
the current hike hid its primary button, on the reasoning that opening what
is open makes no sense. But "Prepare this hike for offline" in the menu sends
the walker straight to that row, so the one row they were sent to was the
only one with no button to leave by — just the ✕ at the top of the panel,
which is not what anyone reaches for when a download finishes. It says
"Back to hike" now and simply closes the panel.

**Always send `Cache-Control: no-cache` when checking the live site.** The
Pages CDN caches 404s, so a path a deploy just added keeps answering 404.

## Commands

```bash
pnpm install
pnpm typecheck          # tsc --build across all projects
pnpm test               # vitest, 358 tests
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
- **A variant is chosen, not detected.** The pills in the Route notes tab set
  which line the walker is on — one tap now opens the other line and keeps
  the notes, the choice and the session. The app could instead notice that
  the position matches the other variant's stretch and offer to switch, but
  being asked "are you on the hard one?" halfway up a muddy path is worse
  than choosing at the signpost.
- **The step counter wants a walk.** The sensor, the permission, the stride
  calibration and the held-position estimate are all verified against a
  stubbed bridge in a browser — the tiles fill, the permission is asked once
  and only on turning the row on, and ten minutes of 300 m fixes produces
  `position 10 min old · ≈730 m walked` against 700 m actually covered. What
  no fixture proves is what a real phone's counter does in a rucksack for six
  hours, or whether the measured stride settles where it should on a
  mountain. The other two native sensors are done and walked with: the
  barometer (`SlowNavBarometer`) and background location (`TrackingService`).
- **Background recording still wants a walk.** The first one found the
  network provider putting kilometre-wide fixes in the queue, which is
  fixed. The rest is verified against a stubbed bridge in a browser — the
  service starts and stops with the setting, survives the page being hidden,
  and every fix from the hidden stretch lands in the trail in order — but no
  fixture proves what Android does to a real foreground service in a pocket
  for six hours, nor what the fixes look like once they are all from the
  satellites.
- iOS gets neither the barometer nor "open with": both need document types
  and UTIs declaring in the Xcode project. Nothing breaks the iOS build.
- The forecast is Android- and browser-wide, but the barometer half of the
  weather tab only appears where the sensor does.
- Play Store internal track, for background APK updates. Needs a $25 account,
  an upload key in secrets, and one first release created by hand in the Play
  Console.
