# Slow Navigator

Three navigation companions for travelling slowly, built to keep working when
the signal does not.

**[Open the apps →](https://guy-t.github.io/Paris-walk/)**

| | |
| --- | --- |
| **Picos Hikes** | Five tracks in the Picos de Europa. Follow the line, climb left, ETA from Tobler's hiking function calibrated to your own pace, elevation profile, off-track arrow. Downloads its maps for a corridor around the route so it works with no signal. |
| **Yonne & Nivernais** | Migennes to Tannay by boat. Derives the navigable channel from OpenStreetMap waterways, then shows the next lock and its opening hours, bridges, moorings and hazards ahead. |
| **Paris Walk** | Turn-by-turn walking on footpaths rather than roads, with the sights worth looking up along the way, and a planner that builds a route from a list of place names. |

**Android:** [install the latest APK](https://github.com/guy-t/Paris-walk/releases/tag/android-latest)
— that link always points at the newest build.

## How it works

Position is matched to the planned route by scoring every nearby segment —
lateral distance, plus penalties for implying you went backwards, jumped
implausibly far forward, or are travelling against the route's direction.
Taking the nearest point instead would fail on every route here: the Paris
loop walks the same streets twice in opposite directions, the hiking circuits
return down the valley they climbed, and the canal doubles back on its own
meanders.

Everything the apps show about distance and pace is derived from progress
along that line, not from summing raw GPS fixes, so jitter never becomes
distance.

GPS runs only while the app is on screen. The display costs several times more
than the GNSS chip, so this is where a day's battery is won or lost.

## Repository

A pnpm workspace: `packages/core` (geometry, map-matching, GPS tracking —
framework-free and unit-tested), `packages/ui` (shared components),
`apps/web` (the apps), `apps/mobile` (a Capacitor shell for Android and iOS).

Every push to `main` typechecks, runs the tests, deploys the site to GitHub
Pages and builds an Android APK. Nothing is uploaded by hand.

The original single-file versions of all three apps still serve their original
URLs while each one is ported. See [CLAUDE.md](CLAUDE.md) for the current
state and the things worth knowing before changing anything.

## Data

Maps © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors ·
terrain rendering by [OpenTopoMap](https://opentopomap.org) (CC-BY-SA) ·
points of interest from OpenStreetMap via Overpass · descriptions from
Wikipedia, English first.

These are planning aids, not a substitute for a map, a compass and your own
judgement.
