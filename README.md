# Mapy + Strava Heatmap Overlay

This repo includes:

- `mapy_strava_overlay.user.js` — Tampermonkey userscript that overlays
  Strava global heatmap (or Waymarked Trails MTB routes) on `mapy.com`
  while keeping all native Mapy controls
- `index.html` / `app.js` / `styles.css` — small standalone demo planner
  (not needed for the userscript flow)

## Real Mapy Overlay

### Setup

1. Install Tampermonkey in your browser.
2. Create a new userscript and paste `mapy_strava_overlay.user.js`.
3. Open `https://www.strava.com/maps/global-heatmap` once **in a normal tab
   while logged in**, and pan/zoom once so heatmap tiles load. This makes Strava
   set the CloudFront signed cookies (scoped to `.strava.com`, ~1-week expiry)
   that gate the high-resolution `tiles-auth` tiles. Do this in a real tab, not
   just rely on the background refresh — third-party cookie partitioning can
   stop an iframe's cookies from being usable.
4. Open `https://mapy.com/` and pan/zoom — the overlay tracks the URL.

### Hotkeys

- `H` — toggle overlay on/off
- `J` — cycle tile **source**: Strava ride heatmap → Waymarked Trails **MTB**
  routes → Waymarked Trails **road/cycling** routes. The choice is remembered
  across reloads.
- `G` — toggle Mapy base map between aerial (satellite) and outdoor/tourist
- `M` — toggle Strava heatmap color (mobileblue ↔ previous)
- `[` / `]` — decrease / increase opacity in 10% steps
- `Alt + D` — toggle debug panel
- `S` — export current Mapy planner route as GPX and open Ride with GPS upload
- `P` — toggle Mapy panorama

### Tile sources

| Source | URL pattern | Max zoom | Auth |
| --- | --- | --- | --- |
| Strava ride heatmap (public) | `heatmap-external-{a,b,c}.strava.com/tiles/ride/{color}/{z}/{x}/{y}.png` | 11 | none |
| Strava ride heatmap (auth) | `…/tiles-auth/…?Key-Pair-Id=…&Policy=…&Signature=…` | 15 | signed cookie/query, captured automatically when you visit Strava heatmap |
| Waymarked Trails MTB | `tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png` | 18 | none |
| Waymarked Trails road/cycling | `tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png` | 18 | none |

The script picks per zoom: at z ≤ 11 it uses Strava's public path (fast,
direct `<img>` requests); at z > 11 it uses `tiles-auth` if a signed query
is captured, otherwise it triggers a background refresh.

**Tile resolution.** Strava heatmap tiles are served at **512×512 by default**
(the script sends no `px` param, so it already gets the hi-res variant; only
`?px=256` would downgrade them). Rendered into a 256 CSS-px grid, that's the
retina-correct size. So pixelation at high zoom is **not** a resolution-of-tile
problem — it's the zoom ceiling: Strava has no heatmap data finer than z=15
(z=11 unauthenticated), and anything beyond that is pure upscaling. For close-up
detail switch to a Waymarked Trails route layer (`J`), which is vector-rendered
to z=18.

### Auth (cookie probe)

Strava's heatmap auth is CloudFront **signed cookies** (`CloudFront-Policy`,
`CloudFront-Signature`, `CloudFront-Key-Pair-Id`, set on `.strava.com` when you
open the heatmap page logged in) — not a signed query string. So there's nothing
to "capture" from tile URLs. Instead, on startup (and whenever you zoom past z11
without auth) the script fires one credentialed `GM_xmlhttpRequest` at a
`tiles-auth` tile. Because the request goes through Tampermonkey (`@connect
heatmap-external-*.strava.com`, `withCredentials`), the browser attaches your
`.strava.com` cookies and the tile returns `200` — at which point the script
flips `cookieAuth=yes`, raises the zoom ceiling to **15**, and re-renders.

If the probe gets `403` you'll see a toast: open
`https://www.strava.com/maps/global-heatmap` in a real tab (logged in), pan once
to set the cookies, then reload mapy. The cookies last ~a week; when they expire
mid-session, repeated `tiles-auth` 403s automatically re-probe.

**Diagnose:** press `Alt+D` and read the `source=…` line — `cookieAuth=yes`
plus `maxTileZoom=15` means hi-res auth tiles are flowing; `cookieAuth=no` /
`maxTileZoom=11` means you're on pixelated public tiles and need to seed cookies.

**Quick manual check:** open
`https://heatmap-external-a.strava.com/tiles-auth/ride/hot/12/2234/1400.png`
directly — a heatmap tile means cookies are good; a `403`/Access-Denied means
they're missing or expired.

> Legacy: an older hidden-iframe "auth refresh" path (`tryRefreshStravaAuth`)
> remains in the source but is no longer called — third-party cookie
> partitioning makes iframe-set cookies unusable from the mapy.com context.

### MTB vs road: popularity vs routes

Two different things are worth separating here:

- **Popularity (Strava heatmap)** *cannot* be split by bike type. The heatmap
  tile URL accepts only the coarse sport groups `all`, `ride`, `run`, `water`,
  `winter`. Sub-disciplines (`MountainBikeRide`, `GravelRide`, `EBikeRide`,
  `Ride`) are all aggregated into `ride`. Strava Premium does **not** unlock a
  road-vs-MTB split for the *global* heatmap — premium only adds a personalized
  heatmap of *your own* activities. The official Strava API / Strava MCP can't
  help either: the heatmap is a separate internal tile service
  (`heatmap-external-*.strava.com` behind CloudFront), entirely outside the
  public API. In practice the `ride` heatmap is road-dominated, so it doubles as
  a decent "road popularity" view.
- **Designated routes (Waymarked Trails)** *can* be split. The `J` hotkey now
  cycles to two distinct OSM route overlays — `mtb` (mountain-bike route
  relations) and `cycling` (signed road/touring cycle routes). These show where
  routes are *designated*, not how popular they are, but they're the only free,
  key-less way to truly separate MTB from road — and they render crisply to
  z=18 where the heatmap is already pixelated.

## Demo app

For local experimentation only:

- `python -m http.server 5500`
- Open `http://localhost:5500`
