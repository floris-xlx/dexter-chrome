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
    }
});


