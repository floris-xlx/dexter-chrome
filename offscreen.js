chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "dexter_offscreen_download_blob") return;

    try {
        if (!chrome?.downloads?.download) {
            sendResponse({ ok: false, error: "Downloads API not available" });
            return false;
        }
        const { buffer, mimeType, filename } = message;
        const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
        const blobUrl = URL.createObjectURL(blob);

        chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, (downloadId) => {
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ ok: true, downloadId });
            }
        });
    } catch (e) {
        sendResponse({ ok: false, error: String(e) });
    }

    return true;
});

