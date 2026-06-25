// Service worker: the one thing a content script can't do in MV3 is a
// credentialed cross-origin fetch (CORS blocks it). With host_permissions for
// *.strava.com, the worker can fetch Strava heatmap tiles with the user's
// cookies attached and hand the bytes back to the content script.

const ATHLETE_KEY = "stravaAthleteId";

// runtime messaging serializes as JSON (not structured clone), so an ArrayBuffer
// would be lost in transit. Encode tiles as a base64 data URL string instead.
function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

async function fetchTile(url) {
    try {
        const resp = await fetch(url, {
            credentials: "include",
            headers: {
                Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
        });
        if (!resp.ok) {
            console.warn("[msh] tile fetch", resp.status, url);
            return { ok: false, status: resp.status };
        }
        const buf = await resp.arrayBuffer();
        const contentType = resp.headers.get("content-type") || "image/png";
        return {
            ok: true,
            status: resp.status,
            dataUrl: `data:${contentType};base64,${bufToBase64(buf)}`,
        };
    } catch (e) {
        const error = String(e && e.message ? e.message : e);
        console.warn("[msh] tile fetch error", error, url);
        return { ok: false, status: 0, error };
    }
}

function b64urlDecode(s) {
    let str = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) {
        str += "=";
    }
    return atob(str);
}

// The reliable source: Strava's `_strava_idcf` cookie is a JWT whose payload
// holds the logged-in athlete id. (Scraping a page can match the WRONG athlete.)
async function athleteIdFromCookie() {
    try {
        const c = await chrome.cookies.get({
            url: "https://www.strava.com",
            name: "_strava_idcf",
        });
        if (c && c.value && c.value.split(".").length >= 2) {
            const payload = JSON.parse(b64urlDecode(c.value.split(".")[1]));
            if (payload && payload.athleteId) {
                return String(payload.athleteId);
            }
        }
    } catch (_) {
        // ignore
    }
    return "";
}

async function detectAthlete() {
    let id = await athleteIdFromCookie();
    if (!id) {
        // Fallback: scrape a page. Only patterns that name the OWN athlete.
        const sources = [
            "https://www.strava.com/maps/personal-heatmap",
            "https://www.strava.com/settings/profile",
        ];
        const patterns = [
            /personal-heatmaps-external\.strava\.com\/tiles\/(\d+)\//,
            /"athlete_?[iI]d"\s*:\s*(\d+)/,
            /\\"athleteId\\":(\d+)/,
        ];
        for (const src of sources) {
            try {
                const resp = await fetch(src, { credentials: "include" });
                if (!resp.ok) {
                    continue;
                }
                const text = await resp.text();
                for (const re of patterns) {
                    const m = text.match(re);
                    if (m && m[1]) {
                        id = m[1];
                        break;
                    }
                }
            } catch (_) {
                // try next source
            }
            if (id) {
                break;
            }
        }
    }
    if (id) {
        await chrome.storage.local.set({ [ATHLETE_KEY]: id });
        console.log("[msh] athlete id detected:", id);
        return { ok: true, athleteId: id };
    }
    return { ok: false };
}

// ---- Send a planned route to Strava (the user's own session) -------------
// Strava's web app uploads a GPX-as-route to this internal endpoint. There's no
// public API for it, so we replicate the same request with the user's cookies
// (which the worker already has). Requires a Strava subscription.
async function getStravaCsrfToken() {
    const resp = await fetch("https://www.strava.com/", { credentials: "include" });
    if (!resp.ok) {
        return null;
    }
    const html = await resp.text();
    const m =
        html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
    return m ? m[1] : null;
}

// Strava's "next data" API uses string enums; /frontend/routes/file returns
// integer codes. Map them when transforming the parsed route into the save body.
const SR_EL_TYPE = { 1: "Waypoint" };
const SR_LEG_TYPE = { 2: "Search" };
const SR_PATH_TYPE = { 1: "Normal" };
const SR_POLY_ENC = { 2: "Google" };
const SR_ELEV_ENC = { 1: "DrewsBadIdea" };
const SR_SURFACE = { 1: "Paved", 2: "Unpaved", 3: "Unknown", 4: "Lift" };
const SR_DIRECTION = { 1: "TurnLeft", 2: "TurnRight", 3: "Straight", 4: "Proceed" };

function pt(p) {
    return { lat: p.lat, lng: p.lng };
}

// Turn the /file parse output into the update-route `props` shape.
function transformParsedRoute(parsed, sport) {
    const r = (parsed && parsed.route) || {};
    const elements = (r.elements || []).map((e) => ({
        elementType: SR_EL_TYPE[e.element_type] || "Waypoint",
        waypoint: { point: pt(e.waypoint.point), metadata: null },
    }));
    const legs = (r.legs || []).map((leg, i) => ({
        legType: SR_LEG_TYPE[leg.leg_type] || "Search",
        startElement: i,
        paths: (leg.paths || []).map((p) => {
            const path = {
                length: p.length,
                elevationGain: p.elevation_gain || 0,
                elevationLoss: p.elevation_loss || 0,
                gradeAdjustedLength: p.grade_adjusted_length,
                pathType: SR_PATH_TYPE[p.path_type] || "Normal",
                origin: pt(p.origin),
                target: pt(p.target),
                surfaceTypeOffsets: (p.surface_type_offsets || []).map((s) => ({
                    distanceOffset: s.distance_offset,
                    surfaceType: SR_SURFACE[s.surface_type] || "Unknown",
                })),
                directions: (p.directions || []).map((d) => ({
                    action: SR_DIRECTION[d.action] || "Straight",
                    distance: d.distance,
                    name: d.name,
                })),
            };
            if (p.elevation) {
                path.elevation = { encoding: SR_ELEV_ENC[p.elevation.encoding] || "DrewsBadIdea", data: p.elevation.data };
            }
            if (p.polyline) {
                path.polyline = { encoding: SR_POLY_ENC[p.polyline.encoding] || "Google", data: p.polyline.data };
            }
            return path;
        }),
    }));
    const routeType = sport === "run" ? "Run" : "Ride";
    return {
        elements,
        legs,
        routePrefs: { routeType, surfaceType: "Unknown", popularity: 0.5, elevation: 0, straightLine: false },
    };
}

// Strava route ids are client-generated 64-bit snowflakes sent as strings.
function genRouteId() {
    const ms = BigInt(Date.now());
    const rand = BigInt(Math.floor(Math.random() * 0x400000)); // 22 bits
    return ((ms << 22n) | rand).toString();
}

async function postNextRoutes(endpoint, token, body) {
    const resp = await fetch("https://www.strava.com/api/next/data/routes/" + endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
            "x-csrf-token": token,
            "x-requested-with": "XMLHttpRequest",
            "content-type": "application/json",
            accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify(body),
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
}

// Persist the route. The web app generates the id client-side and upserts via
// update-route; we try that, and fall back to create-route just in case.
async function persistStravaRoute(token, props) {
    let lastErr = "";
    const attempts = [
        { ep: "update-route", withId: true },
        { ep: "create-route", withId: false },
    ];
    for (const a of attempts) {
        const props2 = Object.assign({}, props);
        if (a.withId) {
            props2.routeId = genRouteId();
        }
        try {
            const res = await postNextRoutes(a.ep, token, { props: props2 });
            if (res.ok) {
                let data = null;
                try { data = JSON.parse(res.text); } catch (_) {}
                const id = props2.routeId
                    || (data && (data.routeId || data.id || (data.route && data.route.id)))
                    || null;
                return { ok: true, id, url: id ? "https://www.strava.com/routes/" + id : null, via: a.ep };
            }
            lastErr = a.ep + " " + res.status + ": " + res.text.slice(0, 120);
        } catch (e) {
            lastErr = a.ep + ": " + String(e && e.message ? e.message : e);
        }
    }
    return { ok: false, error: lastErr };
}

async function uploadStravaRoute(gpxText, name, sport) {
    if (!gpxText || gpxText.indexOf("<gpx") === -1) {
        return { ok: false, error: "no-gpx" };
    }
    const token = await getStravaCsrfToken();
    if (!token) {
        return { ok: false, error: "no-csrf", needLogin: true };
    }
    // Step 1 — parse the GPX into Strava's route structure.
    let parsed;
    try {
        const fname = String(name || "mapy-route").replace(/[^\w.-]+/g, "-").slice(0, 60) + ".gpx";
        const fd = new FormData();
        fd.append("file", new Blob([gpxText], { type: "application/octet-stream" }), fname);
        fd.append("data_type", "gpx");
        fd.append("route_type", sport === "run" ? "2" : "1");
        const resp = await fetch("https://www.strava.com/frontend/routes/file", {
            method: "POST",
            credentials: "include",
            headers: {
                "x-csrf-token": token,
                "x-requested-with": "XMLHttpRequest",
                accept: "application/json, text/plain, */*",
            },
            body: fd,
        });
        const text = await resp.text();
        if (!resp.ok) {
            return { ok: false, status: resp.status, error: "parse: " + text.slice(0, 150) };
        }
        parsed = JSON.parse(text);
    } catch (e) {
        return { ok: false, error: "parse: " + String(e && e.message ? e.message : e) };
    }
    if (!parsed || !parsed.route || !(parsed.route.elements || []).length) {
        return { ok: false, error: "empty-parse" };
    }
    // Step 2 — transform + Step 3 — save (always starred + Only You).
    const t = transformParsedRoute(parsed, sport);
    const props = {
        name: name || parsed.name || "Mapy route",
        description: "Planned on Mapy.com",
        visibility: "OnlyMe",
        starred: true,
        elements: t.elements,
        legs: t.legs,
        routePrefs: t.routePrefs,
    };
    return await persistStravaRoute(token, props);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") {
        return false;
    }
    if (msg.type === "fetchTile" && typeof msg.url === "string") {
        fetchTile(msg.url).then(sendResponse);
        return true; // async
    }
    if (msg.type === "detectAthlete") {
        detectAthlete().then(sendResponse);
        return true; // async
    }
    if (msg.type === "uploadStravaRoute" && typeof msg.gpx === "string") {
        uploadStravaRoute(msg.gpx, msg.name, msg.sport).then(sendResponse);
        return true; // async
    }
    return false;
});

// Kick off detection on install/startup so personal heat is ready when possible.
chrome.runtime.onInstalled.addListener(() => detectAthlete());
chrome.runtime.onStartup.addListener(() => detectAthlete());
