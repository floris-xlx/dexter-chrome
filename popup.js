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
let isZipping = false;

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

function loadVideos() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: "dexter_get_videos" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.videos || response.videos.length === 0) {
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
                    validVideos.sort((a, b) => b.size - a.size); // Sort descending
                    
                    if (validVideos.length === 0) {
                        videoList.innerHTML = '<li>No enabled videos found on this page.</li>';
                        return;
                    }

                    videoList.innerHTML = ''; // Clear list
                    validVideos.forEach(video => {
                        const li = document.createElement('li');
                        const videoName = new URL(video.url).pathname.split('/').pop();

                        li.innerHTML = `
                            <span class="video-info" title="${video.url}">${videoName}</span>
                            <span class="video-size">${formatBytes(video.size)}</span>
                            <button class="open-btn" data-url="${video.url}">Open</button>
                            <button class="download-btn" data-url="${video.url}"><img src="icons/download.svg" alt="Download"></button>
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
        chrome.tabs.sendMessage(tabs[0].id, { type: "dexter_get_images" }, (response) => {
            if (chrome.runtime.lastError || !response || !Array.isArray(response.images) || response.images.length === 0) {
                currentImages = [];
                imageList.innerHTML = '<li>No images found on this page.</li>';
                return;
            }

            currentImages = response.images.slice();
            const maxShown = 50;
            const shown = currentImages.slice(0, maxShown);
            imageList.innerHTML = '';

            shown.forEach((url) => {
                const li = document.createElement('li');
                const name = new URL(url).pathname.split('/').pop() || url;
                li.innerHTML = `
                    <span class="image-info" title="${url}">${name}</span>
                    <button class="download-btn" data-url="${url}"><img src="icons/download.svg" alt="Download"></button>
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
    const downloadBtn = e.target.closest?.('button.download-btn');
    const openBtn = e.target.closest?.('button.open-btn');
    if (downloadBtn) {
        const url = downloadBtn.dataset.url;
        chrome.runtime.sendMessage({ type: "dexter_download", url });
    } else if (openBtn) {
        const url = openBtn.dataset.url;
        chrome.tabs.create({ url });
    }
});

imageList.addEventListener('click', (e) => {
    const downloadBtn = e.target.closest?.('button.download-btn');
    if (!downloadBtn) return;
    const url = downloadBtn.dataset.url;
    chrome.runtime.sendMessage({ type: "dexter_download", url });
});

downloadAllImagesButton.addEventListener('click', () => {
    if (!currentImages.length) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const pageUrl = tabs?.[0]?.url;
        chrome.runtime.sendMessage({ type: "dexter_download_many", urls: currentImages, kind: "images", pageUrl });
    });
});

downloadImagesZipButton.addEventListener('click', () => {
    if (!currentImages.length) return;
    if (isZipping) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const pageUrl = tabs?.[0]?.url;
        isZipping = true;
        downloadImagesZipButton.disabled = true;
        zipStatus.textContent = 'Preparing ZIP...';
        chrome.runtime.sendMessage({ type: "dexter_download_zip", urls: currentImages, kind: "images", pageUrl }, (resp) => {
            if (chrome.runtime.lastError) return;
            if (resp?.ok) return;
            if (resp?.error) zipStatus.textContent = resp.error;
        });
    });
});

openImageGalleryButton.addEventListener('click', () => {
    if (!currentImages.length) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const pageUrl = tabs?.[0]?.url;
        chrome.storage.local.set({
            dexterImageGallery: {
                pageUrl,
                images: currentImages,
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
        downloadImagesZipButton.disabled = false;
        zipStatus.textContent = message.skipped
            ? `ZIP downloaded (skipped ${message.skipped})`
            : 'ZIP downloaded';
    } else if (message?.type === 'dexter_zip_error') {
        isZipping = false;
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
