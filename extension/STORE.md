# Chrome Web Store — submission checklist & listing copy

## What you need to do (one-time)

1. **Register a developer account**: <https://chrome.google.com/webstore/devconsole>
   — one-time **$5 USD** fee, Google account.
2. **Privacy policy URL**: link to the repo's `PRIVACY.md` (raw GitHub URL is fine),
   or host it on a small page.
3. **Package**: zip the **contents of `extension/`** (manifest.json at the zip root,
   not the folder), excluding dev-only files. From the repo:
   ```
   cd extension && zip -r ../heatmapy-chrome.zip . -x '*.DS_Store' -x 'STORE.md' -x 'icons/icon.svg' -x 'store-assets/*'
   ```
4. **Create item** in the dev console → upload the zip → fill the listing (below) →
   add assets → submit for review (a few days).

## Assets (you'll provide the visuals)

- **Store icon**: 128×128 PNG (already in `icons/icon128.png`; replace with a nicer
  one if you want).
- **Screenshots** (ready in `store-assets/`, 1280×800 PNG — upload in this order):
  1. `screenshot-1-heatmap.png` — global + personal heat on Mapy.com
  2. `screenshot-2-route-planning.png` — planning a route on the heatmap
  3. `screenshot-3-sync-strava.png` — one-click Sync to Strava (→ Garmin/Wahoo)
- **Promo (optional)**: small 440×280 tile; marquee 1400×560. The GIF/video you
  shoot can seed these.
- **Category**: Tools / Productivity. **Language**: English (add Czech later).

## Listing copy (draft — edit freely)

**Name**: Heatmapy — Strava Heatmap for Mapy.com

**Short description** (≤132 chars):
> Strava heatmaps on Mapy.com — global + personal heat by sport, plan routes, and
> one-click Sync to Strava for your Garmin/Wahoo.

**Detailed description**:
> Plan routes on Mapy.com with Strava's heat on top of the map.
>
> • Global heatmap, split by sport — switch between Road, MTB, Gravel, and Run.
> • Your personal heatmap in blue, on top of the global heat — toggle each layer
>   independently, so you can spot the roads and trails you haven't done yet.
> • Sync to Strava — save your planned Mapy route to your Strava account in one
>   click (private + starred). From there it syncs to your Garmin or Wahoo, so you
>   can ride it on your device. Or use the plain GPX download (no account needed).
> • On-map controls plus keyboard shortcuts (A all / S sport / D global / F personal),
>   opacity, fast tile caching.
>
> Requires being logged in to Strava in the same browser. A Strava Subscription is
> required for the global heatmap above zoom 11, the personal heatmap, and Sync to
> Strava (saving a route). Route planning and the plain GPX download work on a free
> account. The extension only talks to Strava (using your existing login) and stores
> settings locally — nothing is sent anywhere else. See the privacy policy.

**Permission justifications** (the console asks per permission):
- *Host permission `*.strava.com`*: "To fetch the user's Strava heatmap tiles using
  their existing Strava login, detect their athlete ID for the personal heatmap, and
  save a planned route to their own Strava account (Sync to Strava). No data leaves
  the browser except these requests to Strava."
- *storage / unlimitedStorage*: "To save the user's settings and athlete ID, and to
  cache heatmap tiles locally for performance."
- *Remote code*: none — all scripts are bundled.

## Notes / caveats to mention in the listing

- This is an independent project, **not affiliated with Strava or Mapy.com**.
- Uses Strava's heatmap the same way the Strava website does (your session); if
  Strava changes their endpoints it may need an update.
