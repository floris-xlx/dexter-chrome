document.addEventListener('DOMContentLoaded', () => {
    const extensionList = document.getElementById('extension-list');
    const checkboxes = extensionList.querySelectorAll('input[type="checkbox"]');

    // Load saved settings
    chrome.storage.sync.get('enabledExtensions', (data) => {
        const enabledExtensions = data.enabledExtensions || {};
        checkboxes.forEach(checkbox => {
            checkbox.checked = enabledExtensions[checkbox.value] !== false; // enabled by default
        });
    });

    // Save settings on change
    extensionList.addEventListener('change', (event) => {
        const checkbox = event.target;
        if (checkbox.type === 'checkbox') {
            chrome.storage.sync.get('enabledExtensions', (data) => {
                const enabledExtensions = data.enabledExtensions || {};
                enabledExtensions[checkbox.value] = checkbox.checked;
                chrome.storage.sync.set({ enabledExtensions });
            });
        }
    });
});
