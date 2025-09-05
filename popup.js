const enabledCheckbox = document.getElementById("enabled");
const modeSelect = document.getElementById("mode");
const whitelistContainer = document.getElementById("whitelist-container");
const whitelistTextarea = document.getElementById("whitelist");
const statusText = document.getElementById("status-text");

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

function toggleWhitelistVisibility() {
    whitelistContainer.style.display = modeSelect.value === 'whitelist' ? 'flex' : 'none';
}

enabledCheckbox.addEventListener("change", saveSettings);
modeSelect.addEventListener("change", () => {
    toggleWhitelistVisibility();
    saveSettings();
});
whitelistTextarea.addEventListener("input", saveSettings);

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    getStatus();
});
