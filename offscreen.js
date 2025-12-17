chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "dexter_offscreen_revoke_blob_url") {
        try {
            if (message?.blobUrl) URL.revokeObjectURL(message.blobUrl);
            sendResponse({ ok: true });
        } catch (e) {
            sendResponse({ ok: false, error: String(e) });
        }
        return true;
    }

    if (message?.type !== "dexter_offscreen_download_blob") return;

    try {
        const { buffer, mimeType } = message;
        const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
        const blobUrl = URL.createObjectURL(blob);
        sendResponse({ ok: true, blobUrl });
    } catch (e) {
        sendResponse({ ok: false, error: String(e) });
    }

    return true;
});

