// Runs in the PAGE's MAIN world (not the isolated content-script world) so it can
// see Mapy.com's own fetch/XHR calls. Content scripts can't observe the page's
// network, so this thin hook spots the planner's GPX export URL
// (/api/tplannerexport?...export=gpx) and forwards it to the content script via
// window.postMessage. It only reads the URL — it never blocks or alters requests.
(function () {
    "use strict";
    function isExportUrl(u) {
        return typeof u === "string"
            && u.indexOf("tplannerexport") !== -1
            && u.indexOf("export=gpx") !== -1;
    }
    function report(u) {
        try {
            const abs = new URL(u, location.origin).toString();
            window.postMessage({ source: "msh-mapy-export", url: abs }, location.origin);
        } catch (_) { /* ignore */ }
    }

    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
        window.fetch = function (input, init) {
            try {
                const u = typeof input === "string" ? input : (input && input.url);
                if (isExportUrl(u)) {
                    report(u);
                }
            } catch (_) { /* ignore */ }
            return origFetch.apply(this, arguments);
        };
    }

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        try {
            if (isExportUrl(url)) {
                report(url);
            }
        } catch (_) { /* ignore */ }
        return origOpen.apply(this, arguments);
    };
})();
