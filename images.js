const grid = document.getElementById("grid");
const meta = document.getElementById("meta");
const status = document.getElementById("status");
const selection = document.getElementById("selection");

const selectAllBtn = document.getElementById("select-all");
const selectNoneBtn = document.getElementById("select-none");
const downloadSelectedBtn = document.getElementById("download-selected");
const zipSelectedBtn = document.getElementById("zip-selected");

let pageUrl = "";
let images = [];
const selected = new Set();
let isZipping = false;

function setStatus(text) {
    status.textContent = text || "";
}

function setSelectionText() {
    selection.textContent = `${selected.size} selected / ${images.length}`;
}

function basenameFromUrl(url) {
    try {
        const u = new URL(url);
        return u.pathname.split("/").pop() || url;
    } catch (_) {
        return url;
    }
}

function persistToLocalStorage() {
    try {
        localStorage.setItem("dexterImageGallery", JSON.stringify({ pageUrl, images, savedAt: Date.now() }));
    } catch (_) { }
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem("dexterImageGallery");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.images)) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function loadFromChromeStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.get("dexterImageGallery", (data) => {
            resolve(data?.dexterImageGallery || null);
        });
    });
}

function computeSpan(img) {
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const ratio = w / h;
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

function render() {
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();

    images.forEach((url) => {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.url = url;

        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = url;

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

        tile.appendChild(img);
        tile.appendChild(overlay);

        tile.addEventListener("click", () => toggle(url, tile));

        img.addEventListener("load", () => {
            const { col, rows } = computeSpan(img);
            tile.style.gridColumnEnd = `span ${col}`;
            tile.style.gridRowEnd = `span ${rows}`;
        }, { once: true });

        frag.appendChild(tile);
    });

    grid.appendChild(frag);
    setSelectionText();
}

function getSelectedUrls() {
    if (!selected.size) return [];
    return images.filter(u => selected.has(u));
}

selectAllBtn.addEventListener("click", () => {
    images.forEach((u) => selected.add(u));
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
    chrome.runtime.sendMessage({ type: "dexter_download_many", urls, kind: "images", pageUrl });
});

zipSelectedBtn.addEventListener("click", () => {
    const urls = getSelectedUrls();
    if (!urls.length) return;
    if (isZipping) return;
    isZipping = true;
    zipSelectedBtn.disabled = true;
    setStatus("Preparing ZIP...");
    chrome.runtime.sendMessage({ type: "dexter_download_zip", urls, kind: "images", pageUrl }, (resp) => {
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
        zipSelectedBtn.disabled = false;
        setStatus(message.skipped ? `ZIP downloaded (skipped ${message.skipped})` : "ZIP downloaded");
    } else if (message?.type === "dexter_zip_error") {
        isZipping = false;
        zipSelectedBtn.disabled = false;
        setStatus(message.error || "ZIP failed");
    }
});

(async function init() {
    setStatus("Loading...");

    const fromChrome = await loadFromChromeStorage();
    if (fromChrome?.images?.length) {
        pageUrl = fromChrome.pageUrl || "";
        images = fromChrome.images;
        persistToLocalStorage();
    } else {
        const fromLocal = loadFromLocalStorage();
        pageUrl = fromLocal?.pageUrl || "";
        images = fromLocal?.images || [];
    }

    const host = (() => {
        try { return pageUrl ? new URL(pageUrl).hostname : ""; } catch (_) { return ""; }
    })();

    meta.textContent = host ? `${host} • ${images.length} images` : `${images.length} images`;
    setStatus(images.length ? "" : "No images loaded. Open this page via the popup Gallery button.");

    render();
})();

