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

// Best-effort: read the logged-in athlete id from Strava so the personal
// heatmap (which keys tiles by athlete id) works without manual setup.
async function detectAthlete() {
    const sources = [
        "https://www.strava.com/maps/personal-heatmap",
        "https://www.strava.com/",
        "https://www.strava.com/settings/profile",
    ];
    const patterns = [
        /personal-heatmaps-external\.strava\.com\/tiles\/(\d+)\//,
        /"athlete_id"\s*:\s*(\d+)/,
        /\\"athlete_id\\":(\d+)/,
        /strava\.com\/athletes\/(\d+)/,
        /"athlete"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/,
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
                    await chrome.storage.local.set({ [ATHLETE_KEY]: m[1] });
                    return { ok: true, athleteId: m[1], source: src };
                }
            }
        } catch (_) {
            // try next source
        }
    }
    return { ok: false };
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
    return false;
});

// Kick off detection on install/startup so personal heat is ready when possible.
chrome.runtime.onInstalled.addListener(() => detectAthlete());
chrome.runtime.onStartup.addListener(() => detectAthlete());
