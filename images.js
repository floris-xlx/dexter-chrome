const grid = document.getElementById("grid");
const meta = document.getElementById("meta");
const status = document.getElementById("status");
const selection = document.getElementById("selection");

const selectAllBtn = document.getElementById("select-all");
const selectNoneBtn = document.getElementById("select-none");
const downloadSelectedBtn = document.getElementById("download-selected");
const zipSelectedBtn = document.getElementById("zip-selected");

const toggleImagesEl = document.getElementById("toggle-images");
const toggleVideosEl = document.getElementById("toggle-videos");

let tabId = null;
let pageUrl = "";
let mediaItems = [];

const selected = new Set();
let isZipping = false;
let zipTabId = null;

function setGalleryScrollbarsHidden(hidden) {
    document.body.classList.toggle("scrollbars-hidden", Boolean(hidden));
}

function setPageScrollbarsHidden(targetTabId, hidden) {
    if (!targetTabId) return;
    chrome.tabs.sendMessage(targetTabId, { type: "dexter_set_scrollbars_hidden", hidden: Boolean(hidden) }, () => {
        void chrome.runtime.lastError;
    });
}

function setStatus(text) {
    status.textContent = text || "";
}

function basenameFromUrl(url) {
    try {
        const u = new URL(url);
        return u.pathname.split("/").pop() || url;
    } catch (_) {
        return url;
    }
}

function computeSpanFromSize(w, h) {
    const ww = w || 1;
    const hh = h || 1;
    const ratio = ww / hh;

    let col = 1;
    let rows = 18;

    if (ratio > 1.6) col = 2;
    if (ratio < 0.75) rows = 28;
    if (ratio > 2.2) rows = 14;

    return { col, rows };
}

function toggle(url, tile) {
    if (selected.has(url)) selected.delete(url);
    else selected.add(url);

    tile.classList.toggle("selected", selected.has(url));
    setSelectionText();
}

function getShowImages() {
    try {
        return localStorage.getItem("dexterGalleryShowImages") !== "0";
    } catch (_) {
        return true;
    }
}

function getShowVideos() {
    try {
        return localStorage.getItem("dexterGalleryShowVideos") !== "0";
    } catch (_) {
        return true;
    }
}

function setShowImages(v) {
    try {
        localStorage.setItem("dexterGalleryShowImages", v ? "1" : "0");
    } catch (_) { }
}

function setShowVideos(v) {
    try {
        localStorage.setItem("dexterGalleryShowVideos", v ? "1" : "0");
    } catch (_) { }
}

function getVisibleItems() {
    const showImages = toggleImagesEl ? toggleImagesEl.checked : getShowImages();
    const showVideos = toggleVideosEl ? toggleVideosEl.checked : getShowVideos();
    return mediaItems.filter(i => (i.type === "image" ? showImages : showVideos));
}

function setSelectionText() {
    const visible = getVisibleItems();
    const visibleUrls = new Set(visible.map(i => i.url));
    const selectedVisible = Array.from(selected).filter(u => visibleUrls.has(u)).length;
    selection.textContent = `${selectedVisible} selected / ${visible.length} shown`;
}

function persistToLocalStorage() {
    try {
        localStorage.setItem("dexterMediaGallery", JSON.stringify({ tabId, pageUrl, mediaItems, savedAt: Date.now() }));
    } catch (_) { }
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem("dexterMediaGallery");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.mediaItems)) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function loadFromChromeStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["dexterMediaGallery", "dexterImageGallery"], (data) => {
            if (data?.dexterMediaGallery) resolve(data.dexterMediaGallery);
            else resolve(data?.dexterImageGallery || null);
        });
    });
}

function normalizeItemsFromPayload(payload) {
    if (!payload) return { tabId: null, pageUrl: "", items: [] };

    if (Array.isArray(payload.mediaItems)) {
        return {
            tabId: payload.tabId || null,
            pageUrl: payload.pageUrl || "",
            items: payload.mediaItems
                .filter(Boolean)
                .filter(i => i?.url && (i.type === "image" || i.type === "video"))
                .map(i => ({ type: i.type, url: i.url }))
        };
    }

    const images = Array.isArray(payload.images) ? payload.images.filter(Boolean) : [];
    const videos = Array.isArray(payload.videos) ? payload.videos.filter(Boolean) : [];

    if (images.length || videos.length) {
        return {
            tabId: payload.tabId || null,
            pageUrl: payload.pageUrl || "",
            items: [...images.map(url => ({ type: "image", url })), ...videos.map(url => ({ type: "video", url }))]
        };
    }

    return { tabId: payload.tabId || null, pageUrl: payload.pageUrl || "", items: [] };
}

function render() {
    const visible = getVisibleItems();

    grid.innerHTML = "";
    const frag = document.createDocumentFragment();

    visible.forEach((item) => {
        const url = item.url;

        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.url = url;
        tile.dataset.type = item.type;
        tile.classList.toggle("selected", selected.has(url));

        const media = item.type === "video"
            ? document.createElement("video")
            : document.createElement("img");

        if (item.type === "video") {
            media.preload = "metadata";
            media.muted = true;
            media.playsInline = true;
            media.src = url;
        } else {
            media.loading = "lazy";
            media.src = url;
        }

        const overlay = document.createElement("div");
        overlay.className = "overlay";

        const badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = basenameFromUrl(url);

        const actions = document.createElement("div");
        actions.className = "tile-actions";

        const downloadBtn = document.createElement("button");
        downloadBtn.className = "tile-btn";
        downloadBtn.type = "button";
        downloadBtn.textContent = "Download";
        downloadBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: "dexter_download", url });
        });

        const check = document.createElement("div");
        check.className = "check";

        actions.appendChild(downloadBtn);
        actions.appendChild(check);

        overlay.appendChild(badge);
        overlay.appendChild(actions);

        tile.appendChild(media);
        tile.appendChild(overlay);

        tile.addEventListener("click", () => toggle(url, tile));

        if (item.type === "video") {
            media.addEventListener("loadedmetadata", () => {
                const { col, rows } = computeSpanFromSize(media.videoWidth, media.videoHeight);
                tile.style.gridColumnEnd = `span ${col}`;
                tile.style.gridRowEnd = `span ${rows}`;
            }, { once: true });
        } else {
            media.addEventListener("load", () => {
                const { col, rows } = computeSpanFromSize(media.naturalWidth, media.naturalHeight);
                tile.style.gridColumnEnd = `span ${col}`;
                tile.style.gridRowEnd = `span ${rows}`;
            }, { once: true });
        }

        frag.appendChild(tile);
    });

    grid.appendChild(frag);
    setSelectionText();
}

function getSelectedUrls() {
    if (!selected.size) return [];
    const visibleUrls = new Set(getVisibleItems().map(i => i.url));
    return Array.from(selected).filter(u => visibleUrls.has(u));
}

selectAllBtn.addEventListener("click", () => {
    getVisibleItems().forEach((i) => selected.add(i.url));
    grid.querySelectorAll(".tile").forEach((t) => t.classList.add("selected"));
    setSelectionText();
});

selectNoneBtn.addEventListener("click", () => {
    selected.clear();
    grid.querySelectorAll(".tile").forEach((t) => t.classList.remove("selected"));
    setSelectionText();
});

downloadSelectedBtn.addEventListener("click", () => {
    const urls = getSelectedUrls();
    if (!urls.length) return;
    chrome.runtime.sendMessage({ type: "dexter_download_many", urls, kind: "media", pageUrl });
});

zipSelectedBtn.addEventListener("click", () => {
    const urls = getSelectedUrls();
    if (!urls.length) return;
    if (isZipping) return;

    isZipping = true;
    zipTabId = tabId || null;

    setGalleryScrollbarsHidden(true);
    setPageScrollbarsHidden(zipTabId, true);

    zipSelectedBtn.disabled = true;
    setStatus("Preparing ZIP...");

    chrome.runtime.sendMessage({ type: "dexter_download_zip", urls, kind: "media", pageUrl, tabId: zipTabId }, (resp) => {
        if (chrome.runtime.lastError) {
            setStatus(chrome.runtime.lastError.message);
        } else if (!resp?.ok) {
            setStatus(resp?.error || "ZIP failed");
        }
    });
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "dexter_zip_progress") {
        setStatus(`Zipping ${message.processed}/${message.total} (skipped ${message.skipped})`);
    } else if (message?.type === "dexter_zip_done") {
        isZipping = false;
        setGalleryScrollbarsHidden(false);
        setPageScrollbarsHidden(zipTabId, false);
        zipTabId = null;
        zipSelectedBtn.disabled = false;
        setStatus(message.skipped ? `ZIP downloaded (skipped ${message.skipped})` : "ZIP downloaded");
    } else if (message?.type === "dexter_zip_error") {
        isZipping = false;
        setGalleryScrollbarsHidden(false);
        setPageScrollbarsHidden(zipTabId, false);
        zipTabId = null;
        zipSelectedBtn.disabled = false;
        setStatus(message.error || "ZIP failed");
    }
});

(function initToggles() {
    const showImages = getShowImages();
    const showVideos = getShowVideos();

    if (toggleImagesEl) toggleImagesEl.checked = showImages;
    if (toggleVideosEl) toggleVideosEl.checked = showVideos;

    toggleImagesEl?.addEventListener("change", () => {
        setShowImages(toggleImagesEl.checked);
        render();
    });

    toggleVideosEl?.addEventListener("change", () => {
        setShowVideos(toggleVideosEl.checked);
        render();
    });
})();

(async function init() {
    setStatus("Loading...");

    const fromChrome = await loadFromChromeStorage();
    let normalized = normalizeItemsFromPayload(fromChrome);

    if (!normalized.items.length) {
        const fromLocal = loadFromLocalStorage();
        normalized = normalizeItemsFromPayload(fromLocal);
    }

    if (!normalized.items.length) {
        try {
            const legacyRaw = localStorage.getItem("dexterImageGallery");
            if (legacyRaw) {
                const legacy = JSON.parse(legacyRaw);
                if (legacy?.images?.length) {
                    normalized = {
                        tabId: null,
                        pageUrl: legacy.pageUrl || "",
                        items: legacy.images.map((url) => ({ type: "image", url }))
                    };
                }
            }
        } catch (_) { }
    }

    tabId = normalized.tabId || null;
    pageUrl = normalized.pageUrl || "";
    mediaItems = normalized.items;

    if (mediaItems.length) persistToLocalStorage();

    const host = (() => {
        try { return pageUrl ? new URL(pageUrl).hostname : ""; } catch (_) { return ""; }
    })();

    const imageCount = mediaItems.filter(i => i.type === "image").length;
    const videoCount = mediaItems.filter(i => i.type === "video").length;

    meta.textContent = host
        ? `${host} • ${imageCount} images • ${videoCount} videos`
        : `${imageCount} images • ${videoCount} videos`;

    setStatus(mediaItems.length ? "" : "No media loaded. Open this page via the popup Gallery button.");
    render();
})();
