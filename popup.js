const enabledCheckbox = document.getElementById("enabled");
const modeSelect = document.getElementById("mode");
const whitelistContainer = document.getElementById("whitelist-container");
const whitelistTextarea = document.getElementById("whitelist");
const statusText = document.getElementById("status-text");
const videoList = document.getElementById("video-list");
const settingsButton = document.getElementById("settings-button");

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
                            <button class="download-btn" data-url="${video.url}">Download</button>
                        `;
                        videoList.appendChild(li);
                    });
                });
            });
        }
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
    if (e.target.classList.contains('download-btn')) {
        const url = e.target.dataset.url;
        chrome.runtime.sendMessage({ type: "dexter_download", url });
    } else if (e.target.classList.contains('open-btn')) {
        const url = e.target.dataset.url;
        chrome.tabs.create({ url });
    }
});

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    getStatus();
    loadVideos();
});
