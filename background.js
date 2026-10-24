// Background Service Worker for F1 Telemetry HUD (Manifest V3)
// Handles API requests to OpenF1 to bypass CORS restrictions on fancode.com

const OPENF1_BASE = 'https://api.openf1.org/v1';

// Cache for static data like sessions and driver lists to reduce network calls
const cache = {
  sessions: null,
  drivers: {}, // keyed by session_key
  cacheExpiry: 60 * 1000 // 1 minute
};

chrome.runtime.onInstalled.addListener(() => {
  console.log('[F1 Telemetry HUD] Extension installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_OPENF1') {
    handleOpenF1Request(request)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async sendResponse
  }

  if (request.action === 'GET_EXTENSION_STATE') {
    chrome.storage.local.get(['hudEnabled', 'selectedDriver', 'sessionKey', 'syncOffset', 'hudPosition', 'hudOpacity', 'customPreset'], (data) => {
      sendResponse(data);
    });
    return true;
  }

  if (request.action === 'SET_EXTENSION_STATE') {
    chrome.storage.local.set(request.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function handleOpenF1Request({ endpoint, params = {} }) {
  const url = new URL(`${OPENF1_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) {
      url.searchParams.append(key, val);
    }
  });

  const urlStr = url.toString();

  // Check cache for driver lists
  if (endpoint === 'drivers' && params.session_key && cache.drivers[params.session_key]) {
    return cache.drivers[params.session_key];
  }

  try {
    const res = await fetch(urlStr);
    if (!res.ok) {
      throw new Error(`OpenF1 API responded with HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();

    // Cache drivers
    if (endpoint === 'drivers' && params.session_key) {
      cache.drivers[params.session_key] = data;
    }

    return data;
  } catch (error) {
    console.error(`[F1 Telemetry] Error fetching ${urlStr}:`, error);
    throw error;
  }
}
