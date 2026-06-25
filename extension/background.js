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

async function uploadStravaRoute(gpxText, name, routeType) {
    if (!gpxText || gpxText.indexOf("<gpx") === -1) {
        return { ok: false, error: "no-gpx" };
    }
    const token = await getStravaCsrfToken();
    if (!token) {
        // No token usually means not logged in to Strava in this browser.
        return { ok: false, error: "no-csrf", needLogin: true };
    }
    const fname = String(name || "mapy-route").replace(/[^\w.-]+/g, "-").slice(0, 60) + ".gpx";
    const fd = new FormData();
    fd.append("file", new Blob([gpxText], { type: "application/octet-stream" }), fname);
    fd.append("data_type", "gpx");
    fd.append("route_type", String(routeType || 1)); // 1 = ride
    try {
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
            return { ok: false, status: resp.status, error: text.slice(0, 200) };
        }
        let data = null;
        try {
            data = JSON.parse(text);
        } catch (_) {
            // non-JSON success is still success
        }
        const id = data && (data.id || data.route_id || (data.route && data.route.id));
        return {
            ok: true,
            id: id || null,
            url: id ? "https://www.strava.com/routes/" + id : null,
        };
    } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
    }
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
        uploadStravaRoute(msg.gpx, msg.name, msg.routeType).then(sendResponse);
        return true; // async
    }
    return false;
});

// Kick off detection on install/startup so personal heat is ready when possible.
chrome.runtime.onInstalled.addListener(() => detectAthlete());
chrome.runtime.onStartup.addListener(() => detectAthlete());
