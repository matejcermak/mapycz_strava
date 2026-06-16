const ATHLETE_KEY = "stravaAthleteId";
const statusEl = document.getElementById("athStatus");
const input = document.getElementById("athInput");

function show(id) {
    if (id) {
        statusEl.textContent = "ready (athlete " + id + ")";
        statusEl.className = "ok";
        input.value = id;
    } else {
        statusEl.textContent = "not detected — log in to Strava";
        statusEl.className = "bad";
    }
}

chrome.storage.local.get(ATHLETE_KEY, (res) => show(res && res[ATHLETE_KEY]));

document.getElementById("detect").addEventListener("click", () => {
    statusEl.textContent = "detecting…";
    statusEl.className = "muted";
    chrome.runtime.sendMessage({ type: "detectAthlete" }, (r) => {
        show(r && r.ok ? r.athleteId : "");
    });
});

document.getElementById("save").addEventListener("click", () => {
    const id = (input.value || "").trim().replace(/[^0-9]/g, "");
    if (!id) {
        return;
    }
    chrome.storage.local.set({ [ATHLETE_KEY]: id }, () => show(id));
});
