const enabledCheckbox = document.getElementById("enabled");
const modeSelect = document.getElementById("mode");
const whitelistContainer = document.getElementById("whitelist-container");
const whitelistTextarea = document.getElementById("whitelist");
const statusText = document.getElementById("status-text");
const videoList = document.getElementById("video-list");
const settingsButton = document.getElementById("settings-button");
const imageList = document.getElementById("image-list");
const downloadAllImagesButton = document.getElementById("download-all-images");
const downloadImagesZipButton = document.getElementById("download-images-zip");
const openImageGalleryButton = document.getElementById("open-image-gallery");
const zipStatus = document.getElementById("zip-status");

let currentImages = [];
let currentVideos = [];
let isZipping = false;
let zipTabId = null;

const BLOCKED_DOWNLOAD_EXTENSIONS = new Set(["htm"]);
const IMAGE_VALIDATION_CONCURRENCY = 4;
const DOWNLOAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
        <path d="M12 4v10m0 0l-3-3m3 3l3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M6 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>
`;

function getUrlExtension(url) {
    try {
        const pathname = new URL(url).pathname;
        const lastDot = pathname.lastIndexOf(".");
        if (lastDot === -1) return "";
        return pathname.slice(lastDot + 1).toLowerCase();
    } catch (_) {
        return "";
    }
}

function getDisplayName(url) {
    try {
        const segments = new URL(url).pathname.split("/");
        const last = segments.pop();
        return last || url;
    } catch (_) {
        return url;
    }
}

function isBlockedExtension(url) {
    const extension = getUrlExtension(url);
    return BLOCKED_DOWNLOAD_EXTENSIONS.has(extension);
}

function setDownloadLoading(button, loading) {
    if (!button) return;
    button.classList.toggle("loading", Boolean(loading));
    button.disabled = Boolean(loading);
    if (loading) {
        button.setAttribute("aria-busy", "true");
    } else {
        button.removeAttribute("aria-busy");
    }
}

function setPopupScrollbarsHidden(hidden) {
    document.body.classList.toggle("scrollbars-hidden", Boolean(hidden));
}

function setPageScrollbarsHidden(tabId, hidden) {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: "dexter_set_scrollbars_hidden", hidden: Boolean(hidden) }, () => {
        void chrome.runtime.lastError;
    });
}

function downloadZipBuffer({ buffer, filename }) {
    return new Promise((resolve) => {
        try {
            const blob = new Blob([buffer], { type: "application/zip" });
            const blobUrl = URL.createObjectURL(blob);

            const cleanup = () => setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

            if (chrome?.downloads?.download) {
                chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, (downloadId) => {
                    cleanup();
                    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
                    else resolve({ ok: true, downloadId });
                });
                return;
            }

            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = (filename || "dexter.zip").split("/").pop();
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            a.remove();
            cleanup();
            resolve({ ok: true });
        } catch (e) {
            resolve({ ok: false, error: String(e) });
        }
    });
}

settingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

function saveSettings() {
    const settings = {
        enabled: enabledCheckbox.checked,
        mode: modeSelect.value,
        whitelist: whitelistTextarea.value.split(',').map(s => s.trim()).filter(Boolean)
    };
    chrome.storage.sync.set({ dexterSettings: settings });
}

function loadSettings() {
    chrome.storage.sync.get("dexterSettings", (data) => {
        const settings = data.dexterSettings || { enabled: true, mode: 'all', whitelist: [] };
        enabledCheckbox.checked = settings.enabled;
        modeSelect.value = settings.mode;
        whitelistTextarea.value = settings.whitelist.join(', ');
        toggleWhitelistVisibility();
    });
}

function getStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: "dexter_get_status" }, (response) => {
                if (chrome.runtime.lastError) {
                    statusText.textContent = 'Inactive';
                    statusText.style.color = '#e74c3c';
                } else if (response && response.active) {
                    statusText.textContent = 'Active';
                    statusText.style.color = '#2ecc71';
                } else {
                    statusText.textContent = 'Inactive';
                    statusText.style.color = '#e74c3c';
                }
            });
        }
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function fetchImageContentLength(url) {
    try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) return null;
        const header = response.headers.get("content-length");
        if (!header) return null;
        const size = parseInt(header, 10);
        return Number.isNaN(size) ? null : size;
    } catch (_) {
        return null;
    }
}

async function validateImageUrlEntry(url) {
    if (isBlockedExtension(url)) return null;
    const size = await fetchImageContentLength(url);
    if (size === 0) return null;
    return { url, size };
}

async function validateImageUrls(urls) {
    if (!urls.length) return [];
    const results = new Array(urls.length);
    let cursor = 0;
    const concurrency = Math.min(IMAGE_VALIDATION_CONCURRENCY, urls.length);
    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= urls.length) break;
            results[index] = await validateImageUrlEntry(urls[index]);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results.filter(Boolean);
}

function loadVideos() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: "dexter_get_videos" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.videos || response.videos.length === 0) {
                    currentVideos = [];
                    videoList.innerHTML = '<li>No videos found on this page.</li>';
                    return;
                }

                const videoPromises = response.videos.map(url =>
                    new Promise(resolve => {
                        chrome.runtime.sendMessage({ type: "dexter_get_video_size", url }, (sizeResponse) => {
                            if (sizeResponse?.ok) {
                                resolve({ url, size: sizeResponse.size });
                            } else {
                                resolve(null);
                            }
                        });
                    })
                );

                Promise.all(videoPromises).then(videosWithSize => {
                    const validVideos = videosWithSize.filter(Boolean);
                    const filteredVideos = validVideos.filter(video => !isBlockedExtension(video.url));
                    filteredVideos.sort((a, b) => (b.size || 0) - (a.size || 0));
                    
                    if (filteredVideos.length === 0) {
                        currentVideos = [];
                        videoList.innerHTML = '<li>No enabled videos found on this page.</li>';
                        return;
                    }

                    currentVideos = filteredVideos;
                    videoList.innerHTML = ''; // Clear list
                    filteredVideos.forEach(video => {
                        const li = document.createElement('li');
                        const videoName = getDisplayName(video.url);
                        const sizeLabel = typeof video.size === 'number' ? formatBytes(video.size) : 'Unknown';

                        li.innerHTML = `
                            <span class="video-info" title="${video.url}">${videoName}</span>
                            <span class="video-size">${sizeLabel}</span>
                            <button class="open-btn" data-url="${video.url}" type="button">Open</button>
                            <button class="download-icon" data-url="${video.url}" type="button" aria-label="Download video">${DOWNLOAD_ICON_SVG}</button>
                        `;
                        videoList.appendChild(li);
                    });
                });
            });
        }
    });
}

function loadImages() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { type: "dexter_get_images" }, async (response) => {
            if (chrome.runtime.lastError || !response || !Array.isArray(response.images) || response.images.length === 0) {
                currentImages = [];
                imageList.innerHTML = '<li>No images found on this page.</li>';
                return;
            }

            const dedupedImages = Array.from(new Set(response.images.filter(Boolean)));
            if (!dedupedImages.length) {
                currentImages = [];
                imageList.innerHTML = '<li>No images found on this page.</li>';
                return;
            }

            imageList.innerHTML = '<li>Validating images...</li>';
            let validated = [];
            try {
                validated = await validateImageUrls(dedupedImages);
            } catch (error) {
                console.error("Failed to validate images", error);
            }

            currentImages = validated;
            if (!currentImages.length) {
                imageList.innerHTML = '<li>No downloadable images found on this page.</li>';
                return;
            }

            const maxShown = 50;
            const shown = currentImages.slice(0, maxShown);
            imageList.innerHTML = '';
            shown.forEach((image) => {
                const li = document.createElement('li');
                const name = getDisplayName(image.url);
                li.innerHTML = `
                    <span class="image-info" title="${image.url}">${name}</span>
                    <button class="download-icon" data-url="${image.url}" type="button" aria-label="Download image">${DOWNLOAD_ICON_SVG}</button>
                `;
                imageList.appendChild(li);
            });

            if (currentImages.length > maxShown) {
                const li = document.createElement('li');
                li.innerHTML = `<span class="image-info">Showing ${maxShown} of ${currentImages.length} images</span>`;
                imageList.appendChild(li);
            }
        });
    });
}


function toggleWhitelistVisibility() {
    whitelistContainer.style.display = modeSelect.value === 'whitelist' ? 'flex' : 'none';
}

enabledCheckbox.addEventListener("change", saveSettings);
modeSelect.addEventListener("change", () => {
    toggleWhitelistVisibility();
    saveSettings();
});
whitelistTextarea.addEventListener("input", saveSettings);

videoList.addEventListener('click', (e) => {
    const downloadBtn = e.target.closest?.('button.download-icon');
    const openBtn = e.target.closest?.('button.open-btn');
    if (downloadBtn) {
        const url = downloadBtn.dataset.url;
        if (!url) return;
        setDownloadLoading(downloadBtn, true);
        chrome.runtime.sendMessage({ type: "dexter_download", url }, (resp) => {
            setDownloadLoading(downloadBtn, false);
            if (chrome.runtime.lastError) {
                console.warn("Download error:", chrome.runtime.lastError.message);
            } else if (!resp?.ok) {
                console.warn("Download blocked:", resp?.error);
            }
        });
    } else if (openBtn) {
        const url = openBtn.dataset.url;
        chrome.tabs.create({ url });
    }
});

imageList.addEventListener('click', (e) => {
    const downloadBtn = e.target.closest?.('button.download-icon');
    if (!downloadBtn) return;
    const url = downloadBtn.dataset.url;
    if (!url) return;
    setDownloadLoading(downloadBtn, true);
    chrome.runtime.sendMessage({ type: "dexter_download", url }, (resp) => {
        setDownloadLoading(downloadBtn, false);
        if (chrome.runtime.lastError) {
            console.warn("Download error:", chrome.runtime.lastError.message);
        } else if (!resp?.ok) {
            console.warn("Download blocked:", resp?.error);
        }
    });
});

downloadAllImagesButton.addEventListener('click', () => {
    if (!currentImages.length) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const pageUrl = tabs?.[0]?.url;
        chrome.runtime.sendMessage({ type: "dexter_download_many", urls: currentImages.map(img => img.url), kind: "images", pageUrl });
    });
});

downloadImagesZipButton.addEventListener('click', () => {
    if (!currentImages.length && !currentVideos.length) return;
    if (isZipping) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        const pageUrl = tabs?.[0]?.url;
        const imageUrls = currentImages.map(img => img.url);
        const videoUrls = currentVideos.map(video => video.url);
        const urls = Array.from(new Set([...imageUrls, ...videoUrls]));
        if (!urls.length) return;
        isZipping = true;
        zipTabId = tabId || null;
        setPopupScrollbarsHidden(true);
        setPageScrollbarsHidden(zipTabId, true);
        downloadImagesZipButton.disabled = true;
        zipStatus.textContent = 'Preparing ZIP...';
        chrome.runtime.sendMessage({ type: "dexter_download_zip", urls, kind: "media", pageUrl, tabId: zipTabId }, (resp) => {
            if (chrome.runtime.lastError) {
                chrome.runtime.sendMessage({ type: "dexter_zip_error", error: chrome.runtime.lastError.message });
                return;
            }
            if (!resp?.ok) {
                chrome.runtime.sendMessage({ type: "dexter_zip_error", error: resp?.error || "ZIP failed" });
                return;
            }
            if (!resp?.buffer || !resp?.filename) {
                chrome.runtime.sendMessage({ type: "dexter_zip_error", error: "ZIP failed" });
                return;
            }

            downloadZipBuffer({ buffer: resp.buffer, filename: resp.filename }).then((r) => {
                if (!r.ok) chrome.runtime.sendMessage({ type: "dexter_zip_error", error: r.error || "ZIP failed" });
                else chrome.runtime.sendMessage({ type: "dexter_zip_done", downloadId: r.downloadId, skipped: resp.skipped || 0 });
            });
        });
    });
});

openImageGalleryButton.addEventListener('click', () => {
    if (!currentImages.length && !currentVideos.length) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        const pageUrl = tabs?.[0]?.url;
        chrome.storage.local.set({
            dexterImageGallery: {
                pageUrl,
                images: currentImages.map(img => img.url),
                savedAt: Date.now()
            },
            dexterMediaGallery: {
                tabId,
                pageUrl,
                images: currentImages.map(img => img.url),
                videos: currentVideos.map(video => video.url),
                savedAt: Date.now()
            }
        }, () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("images.html") });
        });
    });
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'dexter_zip_progress') {
        zipStatus.textContent = `Zipping ${message.processed}/${message.total} (skipped ${message.skipped})`;
    } else if (message?.type === 'dexter_zip_done') {
        isZipping = false;
        setPopupScrollbarsHidden(false);
        setPageScrollbarsHidden(zipTabId, false);
        zipTabId = null;
        downloadImagesZipButton.disabled = false;
        zipStatus.textContent = message.skipped
            ? `ZIP downloaded (skipped ${message.skipped})`
            : 'ZIP downloaded';
    } else if (message?.type === 'dexter_zip_error') {
        isZipping = false;
        setPopupScrollbarsHidden(false);
        setPageScrollbarsHidden(zipTabId, false);
        zipTabId = null;
        downloadImagesZipButton.disabled = false;
        zipStatus.textContent = message.error || 'ZIP failed';
    }
});

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    getStatus();
    loadVideos();
    loadImages();
});
