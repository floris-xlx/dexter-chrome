
async function isVideoEnabled(url) {
    const defaultExtensions = {
        "html": true,
        "htm": true,
        "mp4": true,
        "pdf": true,
        "jpg": true,
        "png": true,
    };
    const { enabledExtensions } = await new Promise(resolve =>
        chrome.storage.sync.get({ enabledExtensions: defaultExtensions }, resolve)
    );

    const extension = new URL(url).pathname.split('.').pop().toLowerCase();

    if (!enabledExtensions[extension]) {
        return false;
    }

    try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
            const size = parseInt(response.headers.get('content-length'), 10) || 0;
            return size > 0;
        }
    } catch (e) {
        console.error("Failed to fetch video size:", e);
    }

    return false;
}

function getPageHostname(pageUrl, fallbackUrl) {
    try {
        if (pageUrl) return new URL(pageUrl).hostname || "page";
    } catch (_) { }
    try {
        if (fallbackUrl) return new URL(fallbackUrl).hostname || "page";
    } catch (_) { }
    return "page";
}

function sanitizeFilename(name) {
    if (!name) return "file";
    let s = name;
    try {
        s = decodeURIComponent(s);
    } catch (_) { }
    s = s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
    if (!s) return "file";
    if (s.length > 160) s = s.slice(0, 160);
    return s;
}

function splitNameAndExt(filename) {
    const i = filename.lastIndexOf(".");
    if (i <= 0 || i === filename.length - 1) return { base: filename, ext: "" };
    return { base: filename.slice(0, i), ext: filename.slice(i) };
}

function filenameFromUrl(url, fallbackBase) {
    try {
        const u = new URL(url);
        const last = u.pathname.split("/").pop() || "";
        return sanitizeFilename(last) || fallbackBase;
    } catch (_) {
        return fallbackBase;
    }
}

function uniqueFilenames(urls, prefix) {
    const used = new Map();
    return urls.map((url, idx) => {
        const raw = filenameFromUrl(url, `${prefix}-${idx + 1}`);
        const { base, ext } = splitNameAndExt(raw);
        const key = raw.toLowerCase();
        const next = (used.get(key) || 0) + 1;
        used.set(key, next);
        if (next === 1) return raw;
        return `${base}-${next}${ext}`;
    });
}

function downloadOne({ url, filename }) {
    return new Promise((resolve) => {
        chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                resolve({ ok: true, downloadId });
            }
        });
    });
}

function crc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
    }
    return table;
}

const CRC32_TABLE = crc32Table();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n) {
    const b = new Uint8Array(2);
    b[0] = n & 0xFF;
    b[1] = (n >>> 8) & 0xFF;
    return b;
}

function u32(n) {
    const b = new Uint8Array(4);
    b[0] = n & 0xFF;
    b[1] = (n >>> 8) & 0xFF;
    b[2] = (n >>> 16) & 0xFF;
    b[3] = (n >>> 24) & 0xFF;
    return b;
}

function concatUint8(chunks) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

function extFromContentType(ct) {
    if (!ct) return "";
    const t = ct.split(";")[0].trim().toLowerCase();
    if (t === "image/jpeg") return ".jpg";
    if (t === "image/png") return ".png";
    if (t === "image/gif") return ".gif";
    if (t === "image/webp") return ".webp";
    if (t === "image/svg+xml") return ".svg";
    if (t === "image/avif") return ".avif";
    return "";
}

function ensureExt(filename, ext) {
    if (!ext) return filename;
    const { base, ext: curExt } = splitNameAndExt(filename);
    if (curExt) return filename;
    return `${base}${ext}`;
}

function timestampCompact(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function buildZipFromUrls({ urls, pageUrl, kind }) {
    const safeUrls = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const names = uniqueFilenames(safeUrls, kind === "images" ? "image" : "file");
    const pageHost = getPageHostname(pageUrl, safeUrls[0]);

    const encoder = new TextEncoder();
    const usedNames = new Map();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let skipped = 0;
    let processed = 0;

    for (let i = 0; i < safeUrls.length; i++) {
        const url = safeUrls[i];
        let filename = names[i];

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ab = await res.arrayBuffer();
            const data = new Uint8Array(ab);
            if (!data.length) throw new Error("empty");

            const inferredExt = extFromContentType(res.headers.get("content-type"));
            filename = ensureExt(filename, inferredExt);
            filename = sanitizeFilename(filename);

            const { base, ext } = splitNameAndExt(filename);
            const key = filename.toLowerCase();
            const next = (usedNames.get(key) || 0) + 1;
            usedNames.set(key, next);
            if (next > 1) filename = `${base}-${next}${ext}`;

            const nameBytes = encoder.encode(filename);
            const crc = crc32(data);
            const size = data.length >>> 0;

            const localHeader = concatUint8([
                u32(0x04034b50),
                u16(20),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(crc),
                u32(size),
                u32(size),
                u16(nameBytes.length),
                u16(0),
                nameBytes
            ]);

            localParts.push(localHeader, data);

            const centralHeader = concatUint8([
                u32(0x02014b50),
                u16(20),
                u16(20),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(crc),
                u32(size),
                u32(size),
                u16(nameBytes.length),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(0),
                u32(offset),
                nameBytes
            ]);

            centralParts.push(centralHeader);
            offset += localHeader.length + data.length;
        } catch (_) {
            skipped++;
        }

        processed++;
        chrome.runtime.sendMessage({ type: "dexter_zip_progress", processed, total: safeUrls.length, skipped });
    }

    const centralDir = concatUint8(centralParts);
    const endRecord = concatUint8([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(centralParts.length),
        u16(centralParts.length),
        u32(centralDir.length),
        u32(offset),
        u16(0)
    ]);

    const zipBytes = concatUint8([...localParts, centralDir, endRecord]);
    const zipName = `Dexter/${pageHost}/${(kind || "files")}-${timestampCompact()}.zip`;
    return { zipBytes, zipName, skipped };
}

async function downloadMany({ urls, kind, pageUrl }) {
    const safeUrls = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const pageHost = getPageHostname(pageUrl, safeUrls[0]);
    const folder = `Dexter/${pageHost}/${kind || "files"}`;
    const names = uniqueFilenames(safeUrls, kind === "images" ? "image" : "file");

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < safeUrls.length; i++) {
        const res = await downloadOne({ url: safeUrls[i], filename: `${folder}/${names[i]}` });
        if (res.ok) ok++;
        else failed++;
    }
    return { ok: true, downloaded: ok, failed };
}

async function ensureOffscreen() {
    if (!chrome.offscreen) throw new Error("Offscreen API not available");
    if (chrome.offscreen.hasDocument) {
        const has = await chrome.offscreen.hasDocument();
        if (has) return;
    }

    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Create a Blob URL to download generated ZIP files."
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "dexter_download" && message?.url) {
        try {
            const url = message.url;
            const suggestedFilename = message.filename || new URL(url).pathname.split("/").pop() || "video.mp4";
            chrome.downloads.download({
                url,
                filename: suggestedFilename,
                saveAs: false
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ ok: true, downloadId });
                }
            });
            return true;
        } catch (e) {
            sendResponse({ ok: false, error: String(e) });
            return false;
        }
    } else if (message?.type === "dexter_get_video_size" && message?.url) {
        isVideoEnabled(message.url).then(isEnabled => {
            if (isEnabled) {
                fetch(message.url, { method: 'HEAD' })
                    .then(response => {
                        if (response.ok) {
                            const size = response.headers.get('content-length');
                            sendResponse({ ok: true, size: parseInt(size, 10) || 0 });
                        } else {
                            sendResponse({ ok: false, error: `HTTP error! status: ${response.status}` });
                        }
                    })
                    .catch(e => {
                        sendResponse({ ok: false, error: String(e) });
                    });
            } else {
                sendResponse({ ok: false, error: 'Video is not enabled' });
            }
        });
        return true; // Indicates async response
    } else if (message?.type === "dexter_download_many" && Array.isArray(message?.urls)) {
        downloadMany({ urls: message.urls, kind: message.kind, pageUrl: message.pageUrl })
            .then((r) => sendResponse(r))
            .catch((e) => sendResponse({ ok: false, error: String(e) }));
        return true;
    } else if (message?.type === "dexter_download_zip" && Array.isArray(message?.urls)) {
        (async () => {
            try {
                const { zipBytes, zipName, skipped } = await buildZipFromUrls({
                    urls: message.urls,
                    pageUrl: message.pageUrl,
                    kind: message.kind === "images" ? "images" : (message.kind || "files")
                });

                await ensureOffscreen();
                chrome.runtime.sendMessage({
                    type: "dexter_offscreen_download_blob",
                    buffer: zipBytes.buffer,
                    mimeType: "application/zip",
                    filename: zipName
                }, (resp) => {
                    if (chrome.runtime.lastError) {
                        chrome.runtime.sendMessage({ type: "dexter_zip_error", error: chrome.runtime.lastError.message });
                        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    if (!resp?.ok) {
                        chrome.runtime.sendMessage({ type: "dexter_zip_error", error: resp?.error || "ZIP download failed" });
                        sendResponse({ ok: false, error: resp?.error || "ZIP download failed" });
                        return;
                    }
                    chrome.runtime.sendMessage({ type: "dexter_zip_done", downloadId: resp.downloadId, skipped });
                    sendResponse({ ok: true, downloadId: resp.downloadId, skipped });
                });
            } catch (e) {
                chrome.runtime.sendMessage({ type: "dexter_zip_error", error: String(e) });
                sendResponse({ ok: false, error: String(e) });
            }
        })();
        return true;
    }
});


