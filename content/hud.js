/**
 * F1 Car Telemetry Overlay HUD - Content Script
 * Supports:
 * - Live Circuit Track Minimap with real-time car GPS position
 * - Side-by-side Dual Driver Comparison Mode (2 draggable HUDs)
 * - Telemetry Delta (Speed delta, throttle/brake comparison)
 * - FanCode Video Sync Offset & Fullscreen support
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__F1_HUD_INITIALIZED__) return;
  window.__F1_HUD_INITIALIZED__ = true;

  // Global State
  const state = {
    visible: true,
    minimized: false,
    session: null,
    sessionKey: 'latest',
    drivers: [],
    showMap: true,
    showTrace: false,
    preset: 'pos-top-left',
    syncOffset: 0,
    opacity: 0.95,
    simulatedMode: false,

    // Primary Driver (HUD 1)
    selectedDriver: null,
    telemetryBuffer: [],
    currentTelemetry: {
      speed: 0,
      gear: 'N',
      rpm: 0,
      throttle: 0,
      brake: 0,
      drs: 0,
      trackProgress: 0
    },

    // Comparison Driver (HUD 2)
    compareMode: false,
    compareDriver: null,
    compareTelemetryBuffer: [],
    compareTelemetry: {
      speed: 0,
      gear: 'N',
      rpm: 0,
      throttle: 0,
      brake: 0,
      drs: 0,
      trackProgress: 0
    }
  };

  let hudRoot = null;
  let hudPrimary = null;
  let hudSecondary = null;
  let pollTimer = null;
  let renderLoopId = null;
  let pollNow = null;
  let pollDebounce = null;
  let manualUntil = 0;
  let holdTimer = null;
  let frameCount = 0;

  // Cached element refs and last-written values: no per-frame DOM lookups, write only on change
  const els = { 1: {}, 2: {} };
  const lastVals = { 1: {}, 2: {} };
  const ledStates = { 1: new Array(15).fill(''), 2: new Array(15).fill('') };
  const traceHistory = [];
  const TRACE_POINTS = 150;

  const hasStorage = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  // Initialize
  init();

  async function init() {
    loadSavedSettings();
    createHUDDOM();
    cacheElements();
    setupEventListeners();
    setupFullscreenHandler();
    setupVideoObserver();
    setupStorageSync();
    startRenderLoop();
    await loadF1Session();
  }

  function cacheElements() {
    [1, 2].forEach(slot => {
      const q = (s) => hudRoot.querySelector(s);
      Object.assign(els[slot], {
        gear: q(`#f1-gear-val-${slot}`),
        speed: q(`#f1-speed-val-${slot}`),
        thrFill: q(`#f1-throttle-fill-${slot}`),
        thrVal: q(`#f1-throttle-val-${slot}`),
        brkFill: q(`#f1-brake-fill-${slot}`),
        brkVal: q(`#f1-brake-val-${slot}`),
        rpmText: q(`#f1-rpm-text-${slot}`),
        drs: q(`#f1-drs-badge-${slot}`),
        ledBar: q(`#f1-led-bar-${slot}`),
        leds: Array.from(hudRoot.querySelectorAll(`#f1-led-bar-${slot} .f1-led`))
      });
    });
    els[1].trace = hudRoot.querySelector('#f1-trace');
  }

  function setVisible(visible, persist) {
    state.visible = visible;
    if (hudRoot) hudRoot.style.display = visible ? 'block' : 'none';
    if (persist && hasStorage()) chrome.storage.local.set({ hudEnabled: visible });
  }

  function applyTraceVisibility(persist) {
    const wrap = hudRoot.querySelector('#f1-trace-wrap');
    const btn = hudRoot.querySelector('#f1-toggle-trace');
    if (wrap) wrap.style.display = state.showTrace ? 'block' : 'none';
    if (btn) btn.textContent = state.showTrace ? 'Hide' : 'Show';
    if (persist && hasStorage()) chrome.storage.local.set({ f1_show_trace: state.showTrace });
  }

  function updateOffsetUI() {
    if (!hudRoot) return;
    const slider = hudRoot.querySelector('#f1-offset-slider');
    const val = hudRoot.querySelector('#f1-offset-val');
    if (slider) slider.value = state.syncOffset;
    if (val) val.textContent = `${state.syncOffset > 0 ? '+' : ''}${state.syncOffset}s`;
  }

  function applyOffset(newOffset, persist) {
    const v = parseInt(newOffset, 10);
    if (Number.isNaN(v)) return;
    state.syncOffset = v;
    updateOffsetUI();
    if (persist && hasStorage()) chrome.storage.local.set({ f1_offset: v });
    // Re-fetch around the new playback point shortly after the user stops adjusting
    if (pollNow) {
      clearTimeout(pollDebounce);
      pollDebounce = setTimeout(pollNow, 400);
    }
  }

  function applyPreset(preset, persist) {
    if (!hudPrimary) return;
    state.preset = preset;
    setPresetPosition(hudPrimary, preset);
    if (persist && hasStorage()) chrome.storage.local.set({ f1_preset: preset, f1_pos: null });
  }

  function applyFreePosition(pos) {
    hudPrimary.className = hudPrimary.classList.contains('minimized') ? 'f1-hud-container minimized' : 'f1-hud-container';
    hudPrimary.style.left = pos.left;
    hudPrimary.style.top = pos.top;
    hudPrimary.style.right = 'auto';
    hudPrimary.style.bottom = 'auto';
    hudPrimary.style.transform = 'none';
  }

  function loadSavedSettings() {
    if (hasStorage()) {
      chrome.storage.local.get(['f1_driver', 'f1_offset', 'f1_preset', 'f1_opacity', 'f1_pos', 'f1_show_map', 'f1_show_trace', 'hudEnabled'], (res) => {
        if (res.hudEnabled === false) setVisible(false, false);
        if (res.f1_show_trace !== undefined) { state.showTrace = res.f1_show_trace; applyTraceVisibility(false); }
        if (res.f1_offset !== undefined) { state.syncOffset = res.f1_offset; updateOffsetUI(); }
        if (res.f1_opacity) state.opacity = res.f1_opacity;
        if (res.f1_driver) state.savedDriverNumber = res.f1_driver;
        if (res.f1_show_map !== undefined) state.showMap = res.f1_show_map;

        if (hudPrimary) {
          hudPrimary.style.opacity = state.opacity;
          const opacityInput = hudRoot.querySelector('#f1-opacity-slider');
          if (opacityInput) opacityInput.value = state.opacity * 100;
          const mapSec = hudPrimary.querySelector('#f1-map-section');
          if (mapSec) mapSec.style.display = state.showMap ? 'flex' : 'none';

          if (res.f1_pos && res.f1_pos.left && res.f1_pos.top) applyFreePosition(res.f1_pos);
          else if (res.f1_preset) applyPreset(res.f1_preset, false);
        }
      });
    }
  }

  // Keep the HUD in sync with popup changes without reloading the page
  function setupStorageSync() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.hudEnabled && changes.hudEnabled.newValue !== undefined) {
        const v = !!changes.hudEnabled.newValue;
        if (v !== state.visible) setVisible(v, false);
      }
      if (changes.f1_offset && changes.f1_offset.newValue !== state.syncOffset) {
        applyOffset(changes.f1_offset.newValue, false);
      }
      if (changes.f1_preset && changes.f1_preset.newValue && changes.f1_preset.newValue !== state.preset) {
        applyPreset(changes.f1_preset.newValue, false);
      }
      if (changes.f1_pos && !changes.f1_pos.newValue && hudPrimary.style.left) {
        applyPreset(state.preset, false);
      }
    });
  }

  // The player is often rendered late or re-rendered (SPA); re-attach when it appears
  function setupVideoObserver() {
    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        const video = document.querySelector('video');
        if (hudRoot && video && video.parentElement && hudRoot.parentElement !== video.parentElement) {
          mountHUD(hudRoot);
        }
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function createHUDDOM() {
    hudRoot = document.createElement('div');
    hudRoot.id = 'f1-telemetry-hud-root';

    hudRoot.innerHTML = `
      <!-- PRIMARY HUD (Driver 1) -->
      <div class="f1-hud-container pos-top-left" id="f1-hud-primary">
        <div class="f1-team-stripe" id="f1-team-stripe-1"></div>

        <!-- Top Header -->
        <div class="f1-hud-header" id="f1-hud-header-1">
          <div class="f1-header-left">
            <div class="f1-drag-icon" title="Drag to move">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div class="f1-driver-badge" id="f1-driver-badge-1" title="Select Driver 1">
              <span class="f1-driver-num" id="f1-badge-num-1">--</span>
              <span class="f1-driver-code" id="f1-badge-code-1">SELECT</span>
              <span class="f1-driver-arrow">▼</span>
            </div>
          </div>

          <div class="f1-header-controls">
            <!-- Map Toggle -->
            <button class="f1-btn-icon" id="f1-btn-map" title="Toggle Circuit Track Map">🗺️</button>
            <!-- Compare Button -->
            <button class="f1-btn-compare" id="f1-btn-compare" title="Compare with 2nd driver">⚔️ Compare</button>
            <!-- Settings & Minimize -->
            <button class="f1-btn-icon" id="f1-btn-settings" title="Settings & Sync">⚙</button>
            <button class="f1-btn-icon" id="f1-btn-minimize-1" title="Minimize">_</button>
            <button class="f1-btn-icon" id="f1-btn-close-1" title="Hide">×</button>
          </div>
        </div>

        <!-- Driver 1 Dropdown -->
        <div class="f1-driver-dropdown" id="f1-driver-dropdown-1">
          <div style="padding: 6px; font-size: 11px; color: #888; text-transform: uppercase;">Select Driver:</div>
          <div id="f1-driver-list-1"></div>
        </div>

        <!-- Circuit Track Map -->
        <div class="f1-map-section" id="f1-map-section">
          <div class="f1-map-header" id="f1-map-title">COTA • AUSTIN GP</div>
          <svg class="f1-track-svg" viewBox="0 0 300 140" xmlns="http://www.w3.org/2000/svg">
            <!-- Glow background line -->
            <path class="f1-track-line-bg" d="M 50,110 L 195,110 C 215,110 228,100 236,88 C 242,78 232,65 218,65 L 175,65 C 160,65 152,52 160,40 C 166,30 180,30 190,38 C 200,48 218,48 226,38 L 244,20 C 254,10 270,15 270,28 L 270,75 C 270,95 250,122 225,122 L 115,122 C 95,122 80,105 68,88 L 38,50 C 28,36 16,45 20,58 L 38,88 C 44,98 44,106 50,110 Z" />
            <!-- Main Track Path -->
            <path id="f1-track-path" class="f1-track-line" d="M 50,110 L 195,110 C 215,110 228,100 236,88 C 242,78 232,65 218,65 L 175,65 C 160,65 152,52 160,40 C 166,30 180,30 190,38 C 200,48 218,48 226,38 L 244,20 C 254,10 270,15 270,28 L 270,75 C 270,95 250,122 225,122 L 115,122 C 95,122 80,105 68,88 L 38,50 C 28,36 16,45 20,58 L 38,88 C 44,98 44,106 50,110 Z" />
            <!-- Finish Line -->
            <line x1="90" y1="104" x2="90" y2="116" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
            <!-- Car 1 Dot -->
            <g id="f1-car-marker-1" class="f1-car-marker-group" style="display: none;">
              <circle class="f1-car-dot" id="f1-car-dot-1" r="6" fill="#e10600" />
              <text class="f1-car-text" id="f1-car-txt-1" y="0.5">1</text>
            </g>
            <!-- Car 2 Dot (Compare Mode) -->
            <g id="f1-car-marker-2" class="f1-car-marker-group" style="display: none;">
              <circle class="f1-car-dot" id="f1-car-dot-2" r="6" fill="#ff8000" />
              <text class="f1-car-text" id="f1-car-txt-2" y="0.5">4</text>
            </g>
          </svg>
        </div>

        <!-- Telemetry Data (Speed, RPM, Gear, Pedals) -->
        <div class="f1-rpm-section">
          <div class="f1-led-bar" id="f1-led-bar-1">
            ${Array.from({ length: 15 }).map((_, i) => `<div class="f1-led" data-idx="${i}"></div>`).join('')}
          </div>
          <div class="f1-rpm-label">
            <span id="f1-rpm-text-1">0 RPM</span>
            <span id="f1-delta-display-1" class="f1-delta-badge" style="display: none;">Δ 0 KM/H</span>
          </div>
        </div>

        <!-- Scrolling input trace (last ~5s) -->
        <div class="f1-trace-wrap" id="f1-trace-wrap" style="display: none;">
          <canvas id="f1-trace" width="600" height="128"></canvas>
          <div class="f1-trace-legend">
            <span><i style="background:#00e676"></i>THR</span>
            <span><i style="background:#ff1744"></i>BRK</span>
            <span><i style="background:#00f0ff"></i>SPD</span>
          </div>
        </div>

        <div class="f1-telemetry-body">
          <div class="f1-center-metrics">
            <div class="f1-gear-box">
              <div class="f1-gear-label">GEAR</div>
              <div class="f1-gear-val" id="f1-gear-val-1">N</div>
            </div>
            <div class="f1-speed-box">
              <div class="f1-speed-val" id="f1-speed-val-1">0</div>
              <div class="f1-speed-unit">KM/H</div>
            </div>
          </div>

          <div class="f1-pedals-box">
            <div class="f1-pedal">
              <div class="f1-pedal-track">
                <div class="f1-pedal-fill throttle" id="f1-throttle-fill-1" style="height: 0%;"></div>
              </div>
              <div class="f1-pedal-name">THR</div>
              <div class="f1-pedal-val" id="f1-throttle-val-1">0%</div>
            </div>
            <div class="f1-pedal">
              <div class="f1-pedal-track">
                <div class="f1-pedal-fill brake" id="f1-brake-fill-1" style="height: 0%;"></div>
              </div>
              <div class="f1-pedal-name">BRK</div>
              <div class="f1-pedal-val" id="f1-brake-val-1">0%</div>
            </div>
          </div>
        </div>

        <div class="f1-status-bar">
          <div class="f1-drs-badge" id="f1-drs-badge-1">DRS OFF</div>
          <div class="f1-session-tag" id="f1-session-tag">Connecting to OpenF1...</div>
        </div>

        <!-- Settings Drawer -->
        <div class="f1-settings-panel" id="f1-settings-panel">
          <div class="f1-control-row">
            <label>FanCode Stream Sync:</label>
            <div class="f1-stepper">
              <button class="f1-stepper-btn" id="f1-offset-minus">-1s</button>
              <input type="range" id="f1-offset-slider" min="-60" max="60" step="1" value="0">
              <button class="f1-stepper-btn" id="f1-offset-plus">+1s</button>
              <span id="f1-offset-val" style="min-width: 32px; font-weight: bold;">0s</span>
            </div>
          </div>
          <div class="f1-control-row">
            <label>HUD Opacity:</label>
            <div class="f1-stepper">
              <input type="range" id="f1-opacity-slider" min="30" max="100" value="95">
            </div>
          </div>
          <div class="f1-control-row">
            <label>Quick Dock:</label>
            <div class="f1-preset-dock-buttons">
              <button class="f1-dock-btn" data-preset="pos-top-left">TL</button>
              <button class="f1-dock-btn" data-preset="pos-top-center">TC</button>
              <button class="f1-dock-btn" data-preset="pos-top-right">TR</button>
              <button class="f1-dock-btn" data-preset="pos-bottom-left">BL</button>
              <button class="f1-dock-btn" data-preset="pos-bottom-right">BR</button>
            </div>
          </div>
          <div class="f1-control-row">
            <label>Input Trace Graph:</label>
            <button class="f1-dock-btn" id="f1-toggle-trace">Show</button>
          </div>
        </div>
      </div>

      <!-- SECONDARY HUD (Driver 2 Comparison) -->
      <div class="f1-hud-container pos-top-right" id="f1-hud-secondary" style="display: none;">
        <div class="f1-team-stripe" id="f1-team-stripe-2"></div>

        <div class="f1-hud-header" id="f1-hud-header-2">
          <div class="f1-header-left">
            <div class="f1-drag-icon" title="Drag comparison HUD">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div class="f1-driver-badge" id="f1-driver-badge-2" title="Select Driver 2">
              <span class="f1-driver-num" id="f1-badge-num-2">--</span>
              <span class="f1-driver-code" id="f1-badge-code-2">COMPARE</span>
              <span class="f1-driver-arrow">▼</span>
            </div>
          </div>

          <div class="f1-header-controls">
            <span id="f1-delta-display-2" class="f1-delta-badge ahead" style="display: none;">Δ 0 KM/H</span>
            <button class="f1-btn-compare close" id="f1-btn-close-compare" title="Close Comparison">✕ Close</button>
          </div>
        </div>

        <div class="f1-driver-dropdown" id="f1-driver-dropdown-2">
          <div style="padding: 6px; font-size: 11px; color: #888; text-transform: uppercase;">Compare Against:</div>
          <div id="f1-driver-list-2"></div>
        </div>

        <!-- Telemetry Data Driver 2 -->
        <div class="f1-rpm-section">
          <div class="f1-led-bar" id="f1-led-bar-2">
            ${Array.from({ length: 15 }).map((_, i) => `<div class="f1-led" data-idx="${i}"></div>`).join('')}
          </div>
          <div class="f1-rpm-label">
            <span id="f1-rpm-text-2">0 RPM</span>
            <span>SPEED DELTA</span>
          </div>
        </div>

        <div class="f1-telemetry-body">
          <div class="f1-center-metrics">
            <div class="f1-gear-box">
              <div class="f1-gear-label">GEAR</div>
              <div class="f1-gear-val" id="f1-gear-val-2">N</div>
            </div>
            <div class="f1-speed-box">
              <div class="f1-speed-val" id="f1-speed-val-2">0</div>
              <div class="f1-speed-unit">KM/H</div>
            </div>
          </div>

          <div class="f1-pedals-box">
            <div class="f1-pedal">
              <div class="f1-pedal-track">
                <div class="f1-pedal-fill throttle" id="f1-throttle-fill-2" style="height: 0%;"></div>
              </div>
              <div class="f1-pedal-name">THR</div>
              <div class="f1-pedal-val" id="f1-throttle-val-2">0%</div>
            </div>
            <div class="f1-pedal">
              <div class="f1-pedal-track">
                <div class="f1-pedal-fill brake" id="f1-brake-fill-2" style="height: 0%;"></div>
              </div>
              <div class="f1-pedal-name">BRK</div>
              <div class="f1-pedal-val" id="f1-brake-val-2">0%</div>
            </div>
          </div>
        </div>

        <div class="f1-status-bar">
          <div class="f1-drs-badge" id="f1-drs-badge-2">DRS OFF</div>
          <div class="f1-session-tag" id="f1-compare-team-tag">Driver 2 Comparison</div>
        </div>
      </div>
    `;

    mountHUD(hudRoot);
    hudPrimary = hudRoot.querySelector('#f1-hud-primary');
    hudSecondary = hudRoot.querySelector('#f1-hud-secondary');
  }

  function mountHUD(element) {
    const video = document.querySelector('video');
    const container = video?.parentElement || document.getElementById('player-container') || document.body;
    if (element.parentElement !== container) container.appendChild(element);
  }

  function setupFullscreenHandler() {
    const handleFS = () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsElement && hudRoot) {
        fsElement.appendChild(hudRoot);
      } else if (hudRoot) {
        mountHUD(hudRoot);
      }
    };
    document.addEventListener('fullscreenchange', handleFS);
    document.addEventListener('webkitfullscreenchange', handleFS);
  }

  function setupEventListeners() {
    // Primary Header & Controls
    const header1 = hudRoot.querySelector('#f1-hud-header-1');
    const badge1 = hudRoot.querySelector('#f1-driver-badge-1');
    const dropdown1 = hudRoot.querySelector('#f1-driver-dropdown-1');
    const btnMap = hudRoot.querySelector('#f1-btn-map');
    const btnCompare = hudRoot.querySelector('#f1-btn-compare');
    const btnSettings = hudRoot.querySelector('#f1-btn-settings');
    const btnMinimize1 = hudRoot.querySelector('#f1-btn-minimize-1');
    const btnClose1 = hudRoot.querySelector('#f1-btn-close-1');
    const settingsPanel = hudRoot.querySelector('#f1-settings-panel');
    const mapSection = hudRoot.querySelector('#f1-map-section');

    // Secondary Header & Controls
    const header2 = hudRoot.querySelector('#f1-hud-header-2');
    const badge2 = hudRoot.querySelector('#f1-driver-badge-2');
    const dropdown2 = hudRoot.querySelector('#f1-driver-dropdown-2');
    const btnCloseCompare = hudRoot.querySelector('#f1-btn-close-compare');

    // Dragging setup for both HUDs
    setupDraggable(header1, hudPrimary);
    setupDraggable(header2, hudSecondary);

    // Map Toggle
    btnMap.addEventListener('click', () => {
      state.showMap = !state.showMap;
      mapSection.style.display = state.showMap ? 'flex' : 'none';
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ f1_show_map: state.showMap });
      }
    });

    // Compare Button Toggle
    btnCompare.addEventListener('click', () => {
      toggleCompareMode();
    });

    btnCloseCompare.addEventListener('click', () => {
      closeCompareMode();
    });

    // Dropdown Toggles
    badge1.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown1.classList.toggle('active');
      dropdown2.classList.remove('active');
    });

    badge2.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown2.classList.toggle('active');
      dropdown1.classList.remove('active');
    });

    document.addEventListener('click', (e) => {
      if (!dropdown1.contains(e.target) && !badge1.contains(e.target)) dropdown1.classList.remove('active');
      if (!dropdown2.contains(e.target) && !badge2.contains(e.target)) dropdown2.classList.remove('active');
    });

    // Settings Toggle
    btnSettings.addEventListener('click', () => {
      settingsPanel.classList.toggle('active');
    });

    // Minimize & Close HUD 1
    btnMinimize1.addEventListener('click', () => {
      state.minimized = !state.minimized;
      hudPrimary.classList.toggle('minimized', state.minimized);
      btnMinimize1.textContent = state.minimized ? '▢' : '_';
    });

    btnClose1.addEventListener('click', () => setVisible(false, true));

    // Sync Offset Handlers
    const offsetSlider = hudRoot.querySelector('#f1-offset-slider');
    const offsetPlus = hudRoot.querySelector('#f1-offset-plus');
    const offsetMinus = hudRoot.querySelector('#f1-offset-minus');
    const opacitySlider = hudRoot.querySelector('#f1-opacity-slider');

    offsetSlider.addEventListener('input', (e) => applyOffset(e.target.value, true));
    offsetPlus.addEventListener('click', () => applyOffset(state.syncOffset + 1, true));
    offsetMinus.addEventListener('click', () => applyOffset(state.syncOffset - 1, true));

    hudRoot.querySelectorAll('.f1-dock-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset, true));
    });

    hudRoot.querySelector('#f1-toggle-trace').addEventListener('click', () => {
      state.showTrace = !state.showTrace;
      applyTraceVisibility(true);
    });
    opacitySlider.addEventListener('input', (e) => {
      state.opacity = e.target.value / 100;
      hudPrimary.style.opacity = state.opacity;
      if (hudSecondary) hudSecondary.style.opacity = state.opacity;
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ f1_opacity: state.opacity });
      }
    });

    // Listen to background extension messages
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'TOGGLE_HUD') {
          setVisible(!state.visible, true);
          sendResponse({ visible: state.visible });
        }
        if (msg.action === 'SELECT_DRIVER') {
          const d = state.drivers.find(x => x.number === msg.driverNumber);
          if (d) selectDriver(d, 1);
          sendResponse({ success: true });
        }
        if (msg.action === 'TOGGLE_COMPARE') {
          toggleCompareMode();
          sendResponse({ compareMode: state.compareMode });
        }
        if (msg.action === 'SELECT_COMPARE_DRIVER') {
          const d = state.drivers.find(x => x.number === msg.driverNumber);
          if (d) selectDriver(d, 2);
          sendResponse({ success: true });
        }
      });
    }
  }

  // Generic Draggable Helper for HUDs
  function setupDraggable(headerEl, containerEl) {
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    headerEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('.f1-driver-badge') || e.target.closest('input')) return;
      isDragging = true;
      const rect = containerEl.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      if (e.cancelable) e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      containerEl.className = containerEl.classList.contains('minimized') ? 'f1-hud-container minimized' : 'f1-hud-container';

      let x = e.clientX - dragOffset.x;
      let y = e.clientY - dragOffset.y;

      const maxX = window.innerWidth - containerEl.offsetWidth - 10;
      const maxY = window.innerHeight - containerEl.offsetHeight - 10;

      x = Math.max(10, Math.min(x, maxX));
      y = Math.max(10, Math.min(y, maxY));

      containerEl.style.left = `${x}px`;
      containerEl.style.top = `${y}px`;
      containerEl.style.right = 'auto';
      containerEl.style.bottom = 'auto';
      containerEl.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      if (containerEl === hudPrimary && hasStorage()) {
        chrome.storage.local.set({ f1_pos: { left: containerEl.style.left, top: containerEl.style.top } });
      }
    });
  }

  function setPresetPosition(containerEl, presetClass) {
    containerEl.className = `f1-hud-container ${presetClass}${containerEl.classList.contains('minimized') ? ' minimized' : ''}`;
    containerEl.style.left = '';
    containerEl.style.top = '';
    containerEl.style.right = '';
    containerEl.style.bottom = '';
    containerEl.style.transform = '';
  }

  // Compare Mode Toggle
  function toggleCompareMode() {
    state.compareMode = !state.compareMode;
    const btn = hudRoot.querySelector('#f1-btn-compare');

    if (state.compareMode) {
      btn.classList.add('active');
      hudSecondary.style.display = 'block';

      // Pick comparison driver (different from driver 1)
      if (!state.compareDriver && state.drivers.length > 1) {
        const other = state.drivers.find(d => d.number !== state.selectedDriver?.number) || state.drivers[1];
        selectDriver(other, 2);
      }
    } else {
      closeCompareMode();
    }
  }

  function closeCompareMode() {
    state.compareMode = false;
    const btn = hudRoot.querySelector('#f1-btn-compare');
    if (btn) btn.classList.remove('active');
    if (hudSecondary) hudSecondary.style.display = 'none';

    // Hide Car 2 marker on track map
    const car2 = hudRoot.querySelector('#f1-car-marker-2');
    if (car2) car2.style.display = 'none';

    // Hide delta badges
    const d1 = hudRoot.querySelector('#f1-delta-display-1');
    const d2 = hudRoot.querySelector('#f1-delta-display-2');
    if (d1) d1.style.display = 'none';
    if (d2) d2.style.display = 'none';
  }

  // Load Session & Drivers
  async function loadF1Session() {
    const sessionTag = hudRoot.querySelector('#f1-session-tag');
    try {
      sessionTag.textContent = 'Connecting to OpenF1...';
      const schedule = await window.OpenF1Client.getWeekendEventSchedule();
      const session = schedule?.activeSession || await window.OpenF1Client.getLatestSession();

      if (!session) {
        sessionTag.textContent = 'United States GP';
        startSimulation();
        return;
      }

      state.session = session;

      // Update Map Header
      const mapTitle = hudRoot.querySelector('#f1-map-title');
      if (mapTitle) {
        mapTitle.textContent = `${session.circuit_short_name || 'CIRCUIT'} • ${session.country_name || 'F1'} GP`;
      }

      if (schedule && schedule.status === 'UPCOMING') {
        const diffMs = new Date(session.date_start).getTime() - Date.now();
        const diffH = Math.floor(diffMs / 3600000);
        const diffM = Math.floor((diffMs % 3600000) / 60000);
        sessionTag.textContent = `⏳ NEXT: ${session.session_name} (in ${diffH}h ${diffM}m)`;
      } else if (schedule && schedule.status === 'LIVE') {
        sessionTag.textContent = `🔴 LIVE: ${session.session_name}`;
      } else {
        sessionTag.textContent = `${session.circuit_short_name || 'F1'} - ${session.session_name || 'Session'}`;
      }

      // Load Drivers
      const drivers = await window.OpenF1Client.getDrivers(session.session_key);
      state.drivers = drivers;
      renderDriverDropdowns(drivers);

      // Select initial driver
      let d1 = drivers.find(d => d.number === state.savedDriverNumber) || drivers[0];
      if (d1) selectDriver(d1, 1);

      // Initial comparison driver candidate
      let d2 = drivers.find(d => d.number !== d1.number) || drivers[1];
      if (d2) selectDriver(d2, 2);

      startTelemetryPolling();
    } catch (err) {
      console.error('[F1 Telemetry HUD] Session error:', err);
      sessionTag.textContent = 'OpenF1 Demo Lap Mode';
      startSimulation();
    }
  }

  function renderDriverDropdowns(drivers) {
    [1, 2].forEach(slot => {
      const list = hudRoot.querySelector(`#f1-driver-list-${slot}`);
      if (!list) return;
      list.innerHTML = '';

      drivers.forEach(driver => {
        const item = document.createElement('div');
        item.className = 'f1-driver-item';

        const add = (cls, text) => {
          const el = document.createElement('div');
          el.className = cls;
          el.textContent = text;
          item.appendChild(el);
          return el;
        };

        add('f1-driver-item-color', '').style.backgroundColor = driver.color;
        const num = add('f1-driver-num', driver.number);
        num.style.color = driver.color;
        num.style.fontWeight = 'bold';
        num.style.minWidth = '20px';
        add('f1-driver-item-name', driver.name || driver.code);
        add('f1-driver-item-team', driver.team || '');

        item.addEventListener('click', () => {
          selectDriver(driver, slot);
          hudRoot.querySelector(`#f1-driver-dropdown-${slot}`).classList.remove('active');
        });

        list.appendChild(item);
      });
    });
  }

  function selectDriver(driver, slot = 1) {
    if (slot === 1) {
      state.selectedDriver = driver;
      state.telemetryBuffer = [];

      hudRoot.querySelector('#f1-badge-num-1').textContent = driver.number;
      hudRoot.querySelector('#f1-badge-code-1').textContent = driver.code;
      hudRoot.querySelector('#f1-badge-num-1').style.color = driver.color;
      hudRoot.querySelector('#f1-team-stripe-1').style.backgroundColor = driver.color;
      hudRoot.querySelector('#f1-team-stripe-1').style.boxShadow = `0 0 8px ${driver.color}`;

      // Track dot 1
      const dot1 = hudRoot.querySelector('#f1-car-dot-1');
      const txt1 = hudRoot.querySelector('#f1-car-txt-1');
      if (dot1) dot1.setAttribute('fill', driver.color);
      if (txt1) txt1.textContent = driver.number;

      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ f1_driver: driver.number });
      }
    } else {
      state.compareDriver = driver;
      state.compareTelemetryBuffer = [];

      hudRoot.querySelector('#f1-badge-num-2').textContent = driver.number;
      hudRoot.querySelector('#f1-badge-code-2').textContent = driver.code;
      hudRoot.querySelector('#f1-badge-num-2').style.color = driver.color;
      hudRoot.querySelector('#f1-team-stripe-2').style.backgroundColor = driver.color;
      hudRoot.querySelector('#f1-team-stripe-2').style.boxShadow = `0 0 8px ${driver.color}`;

      const compareTag = hudRoot.querySelector('#f1-compare-team-tag');
      if (compareTag) compareTag.textContent = `${driver.name} (${driver.team})`;

      // Track dot 2
      const dot2 = hudRoot.querySelector('#f1-car-dot-2');
      const txt2 = hudRoot.querySelector('#f1-car-txt-2');
      if (dot2) dot2.setAttribute('fill', driver.color);
      if (txt2) txt2.textContent = driver.number;
    }
  }

  // Merge new samples into a buffer: de-duplicate by timestamp, keep only what playback can need
  const isHolding = () => Date.now() < manualUntil;

  // Pin a telemetry snapshot on the primary HUD for a few seconds, then resume (used by demo.html)
  function holdTelemetry(t, ms = 4000) {
    const resumeSim = state.simulatedMode || isBufferStale(state.telemetryBuffer);
    manualUntil = Date.now() + ms;
    state.simulatedMode = false;
    state.currentTelemetry = { ...state.currentTelemetry, ...t };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      manualUntil = 0;
      if (resumeSim) startSimulation();
    }, ms);
  }

  window.F1HUD = {
    holdTelemetry,
    toggleTrace: () => hudRoot.querySelector('#f1-toggle-trace').click(),
    toggleCompare: () => toggleCompareMode()
  };

  function mergeSamples(buffer, incoming) {
    const seen = new Set(buffer.map(s => s.date));
    const merged = buffer.slice();
    for (const s of incoming) {
      if (!seen.has(s.date)) merged.push(s);
    }
    merged.sort((a, b) => new Date(a.date) - new Date(b.date));
    const cutoff = Date.now() - (Math.max(0, state.syncOffset) + 30) * 1000;
    return merged.filter(s => new Date(s.date).getTime() >= cutoff);
  }

  function isBufferStale(buffer) {
    if (!buffer || buffer.length === 0) return true;
    const newest = new Date(buffer[buffer.length - 1].date).getTime();
    return newest < Date.now() - (Math.max(0, state.syncOffset) + 20) * 1000;
  }

  // Telemetry Polling Loop
  function startTelemetryPolling() {
    if (pollTimer) clearInterval(pollTimer);

    const poll = async () => {
      if (!state.selectedDriver || !state.session) return;

      try {
        const key = state.session.session_key;
        const promises = [
          window.OpenF1Client.getCarWindow(key, state.selectedDriver.number, state.syncOffset)
        ];

        if (state.compareMode && state.compareDriver) {
          promises.push(window.OpenF1Client.getCarWindow(key, state.compareDriver.number, state.syncOffset));
        }

        const [d1Data, d2Data] = await Promise.all(promises);

        if (Array.isArray(d1Data) && d1Data.length > 0) {
          state.simulatedMode = false;
          state.telemetryBuffer = mergeSamples(state.telemetryBuffer, d1Data);
          if (Array.isArray(d2Data) && d2Data.length > 0) {
            state.compareTelemetryBuffer = mergeSamples(state.compareTelemetryBuffer, d2Data);
          }
        } else if (!state.simulatedMode && !isHolding() && isBufferStale(state.telemetryBuffer)) {
          startSimulation();
        }
      } catch (e) {
        if (!state.simulatedMode && !isHolding() && isBufferStale(state.telemetryBuffer)) startSimulation();
      }
    };

    pollNow = poll;
    poll();
    pollTimer = setInterval(poll, 2000);
  }

  // Render Loop (60 FPS)
  function startRenderLoop() {
    const updateUI = () => {
      if (!state.simulatedMode && !isHolding() && state.telemetryBuffer.length > 0) {
        interpolateTelemetry();
      }

      renderTelemetryUI(state.currentTelemetry, 1);
      if (state.compareMode) {
        renderTelemetryUI(state.compareTelemetry, 2);
        renderDeltaUI();
      }

      // Sample the trace at ~30 Hz and redraw only while the HUD is on screen
      if (frameCount++ % 2 === 0 && state.visible && state.showTrace) {
        const t = state.currentTelemetry;
        traceHistory.push({ speed: t.speed, throttle: t.throttle, brake: t.brake });
        if (traceHistory.length > TRACE_POINTS) traceHistory.shift();
        if (!state.minimized) drawTrace();
      }

      updateTrackMapMarkers();

      renderLoopId = requestAnimationFrame(updateUI);
    };

    renderLoopId = requestAnimationFrame(updateUI);
  }

  function interpolateTelemetry() {
    const now = Date.now();
    const targetTime = now - (state.syncOffset * 1000);

    const sample = (buffer) => {
      if (!buffer || buffer.length === 0) return null;
      const trackProgress = (now % 35000) / 35000;
      // Hold the first/last sample when the playback point is outside the buffered range
      if (targetTime <= new Date(buffer[0].date).getTime()) return { ...buffer[0], trackProgress };
      let closest = { ...buffer[buffer.length - 1], trackProgress };
      for (let i = 0; i < buffer.length - 1; i++) {
        const tA = new Date(buffer[i].date).getTime();
        const tB = new Date(buffer[i + 1].date).getTime();
        if (targetTime >= tA && targetTime <= tB) {
          const factor = (targetTime - tA) / (tB - tA);
          return {
            speed: Math.round(buffer[i].speed + (buffer[i + 1].speed - buffer[i].speed) * factor),
            rpm: Math.round(buffer[i].rpm + (buffer[i + 1].rpm - buffer[i].rpm) * factor),
            n_gear: factor > 0.5 ? buffer[i + 1].n_gear : buffer[i].n_gear,
            throttle: Math.round(buffer[i].throttle + (buffer[i + 1].throttle - buffer[i].throttle) * factor),
            brake: buffer[i + 1].brake > 0 ? buffer[i + 1].brake : buffer[i].brake,
            drs: buffer[i + 1].drs,
            trackProgress
          };
        }
      }
      return closest;
    };

    const s1 = sample(state.telemetryBuffer);
    if (s1) {
      state.currentTelemetry = {
        speed: s1.speed || 0,
        gear: s1.n_gear === 0 ? 'N' : s1.n_gear,
        rpm: s1.rpm || 0,
        throttle: Math.min(100, s1.throttle || 0),
        brake: Math.min(100, s1.brake || 0),
        drs: s1.drs,
        trackProgress: s1.trackProgress || 0
      };
    }

    if (state.compareMode) {
      const s2 = sample(state.compareTelemetryBuffer);
      if (s2) {
        state.compareTelemetry = {
          speed: s2.speed || 0,
          gear: s2.n_gear === 0 ? 'N' : s2.n_gear,
          rpm: s2.rpm || 0,
          throttle: Math.min(100, s2.throttle || 0),
          brake: Math.min(100, s2.brake || 0),
          drs: s2.drs,
          trackProgress: (s2.trackProgress + 0.05) % 1
        };
      }
    }
  }

  function setText(slot, key, el, value) {
    const cache = lastVals[slot];
    if (el && cache[key] !== value) {
      el.textContent = value;
      cache[key] = value;
    }
  }

  function setHeight(slot, key, el, value) {
    const cache = lastVals[slot];
    if (el && cache[key] !== value) {
      el.style.height = value;
      cache[key] = value;
    }
  }

  function drawTrace() {
    const canvas = els[1].trace;
    if (!canvas || traceHistory.length < 2) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }

    const line = (key, max, color) => {
      ctx.beginPath();
      traceHistory.forEach((p, i) => {
        const x = (i / (TRACE_POINTS - 1)) * W;
        const y = H - (Math.min(p[key], max) / max) * (H - 4) - 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    line('speed', 350, '#00f0ff');
    line('throttle', 100, '#00e676');
    line('brake', 100, '#ff1744');
  }

  function renderTelemetryUI(t, slot = 1) {
    if (!hudRoot) return;
    const e = els[slot];

    setText(slot, 'gear', e.gear, t.gear);
    setText(slot, 'speed', e.speed, t.speed);

    setHeight(slot, 'thrFill', e.thrFill, `${t.throttle}%`);
    setText(slot, 'thrVal', e.thrVal, `${t.throttle}%`);
    setHeight(slot, 'brkFill', e.brkFill, `${t.brake}%`);
    setText(slot, 'brkVal', e.brkVal, `${t.brake}%`);

    setText(slot, 'rpm', e.rpmText, `${t.rpm.toLocaleString()} RPM`);

    // Shift LEDs: 0-4 green, 5-9 red, 10-14 blue
    const rpm = t.rpm;
    const minRpm = 8500;
    const maxRpm = 13200;

    let activeLeds = 0;
    if (rpm > minRpm) {
      const ratio = Math.min(1, Math.max(0, (rpm - minRpm) / (maxRpm - minRpm)));
      activeLeds = Math.round(ratio * 15);
    }

    const ledState = ledStates[slot];
    e.leds.forEach((led, idx) => {
      const cls = idx < activeLeds ? (idx < 5 ? 'lit-green' : idx < 10 ? 'lit-red' : 'lit-blue') : '';
      if (ledState[idx] !== cls) {
        led.className = cls ? `f1-led ${cls}` : 'f1-led';
        ledState[idx] = cls;
      }
    });

    // Flash all LEDs at the redline as a shift cue
    const flash = rpm > 13000;
    if (e.ledBar && lastVals[slot].flash !== flash) {
      e.ledBar.classList.toggle('flash', flash);
      lastVals[slot].flash = flash;
    }

    const drsState = (t.drs === 10 || t.drs === 12 || t.drs === 14) ? 'active' : (t.drs === 8 ? 'avail' : 'off');
    if (e.drs && lastVals[slot].drs !== drsState) {
      e.drs.className = drsState === 'off' ? 'f1-drs-badge' : `f1-drs-badge ${drsState}`;
      e.drs.textContent = drsState === 'active' ? 'DRS ACTIVE' : drsState === 'avail' ? 'DRS AVAIL' : 'DRS OFF';
      lastVals[slot].drs = drsState;
    }
  }

  function renderDeltaUI() {
    const delta = state.currentTelemetry.speed - state.compareTelemetry.speed;
    const d1 = hudRoot.querySelector('#f1-delta-display-1');
    const d2 = hudRoot.querySelector('#f1-delta-display-2');

    if (d1 && d2) {
      d1.style.display = 'inline-block';
      d2.style.display = 'inline-block';

      if (delta >= 0) {
        d1.className = 'f1-delta-badge ahead';
        d1.textContent = `Δ +${delta} KM/H`;
        d2.className = 'f1-delta-badge behind';
        d2.textContent = `Δ -${delta} KM/H`;
      } else {
        d1.className = 'f1-delta-badge behind';
        d1.textContent = `Δ ${delta} KM/H`;
        d2.className = 'f1-delta-badge ahead';
        d2.textContent = `Δ +${Math.abs(delta)} KM/H`;
      }
    }
  }

  // Update Circuit Track Map Car Marker Dots
  function updateTrackMapMarkers() {
    if (!state.showMap) return;
    const path = hudRoot.querySelector('#f1-track-path');
    if (!path) return;

    const totalLen = path.getTotalLength();
    if (totalLen <= 0) return;

    // Car 1 Marker
    const marker1 = hudRoot.querySelector('#f1-car-marker-1');
    if (marker1) {
      marker1.style.display = 'block';
      const prog1 = (state.currentTelemetry.trackProgress || 0) % 1;
      const pt1 = path.getPointAtLength(prog1 * totalLen);
      marker1.setAttribute('transform', `translate(${pt1.x}, ${pt1.y})`);
    }

    // Car 2 Marker (Compare Mode)
    const marker2 = hudRoot.querySelector('#f1-car-marker-2');
    if (marker2) {
      if (state.compareMode && state.compareDriver) {
        marker2.style.display = 'block';
        const prog2 = (state.compareTelemetry.trackProgress || 0) % 1;
        const pt2 = path.getPointAtLength(prog2 * totalLen);
        marker2.setAttribute('transform', `translate(${pt2.x}, ${pt2.y})`);
      } else {
        marker2.style.display = 'none';
      }
    }
  }

  // Realistic Simulation (Runs when off-track)
  function startSimulation() {
    state.simulatedMode = true;
    if (state.simTimer) clearInterval(state.simTimer);

    let simTime = 0;

    const gearRatios = [
      { gear: 1, minSpeed: 60, maxSpeed: 105, minRpm: 9000, maxRpm: 12800 },
      { gear: 2, minSpeed: 100, maxSpeed: 145, minRpm: 9200, maxRpm: 12900 },
      { gear: 3, minSpeed: 140, maxSpeed: 185, minRpm: 9500, maxRpm: 13000 },
      { gear: 4, minSpeed: 180, maxSpeed: 225, minRpm: 9800, maxRpm: 13100 },
      { gear: 5, minSpeed: 220, maxSpeed: 265, minRpm: 10000, maxRpm: 13150 },
      { gear: 6, minSpeed: 260, maxSpeed: 295, minRpm: 10200, maxRpm: 13200 },
      { gear: 7, minSpeed: 290, maxSpeed: 325, minRpm: 10400, maxRpm: 13300 },
      { gear: 8, minSpeed: 320, maxSpeed: 345, minRpm: 10600, maxRpm: 13400 }
    ];

    const calcCar = (tOffset) => {
      const phase = ((simTime + tOffset) % 40) / 40;
      let speed = 0, throttle = 0, brake = 0, drs = 0;

      if (phase < 0.35) {
        const prog = phase / 0.35;
        speed = Math.round(120 + Math.pow(prog, 0.7) * 218);
        throttle = 100;
        brake = 0;
        drs = prog > 0.25 ? 12 : 8;
      } else if (phase < 0.45) {
        const prog = (phase - 0.35) / 0.10;
        speed = Math.round(338 - prog * 253);
        throttle = 0;
        brake = Math.round(100 - prog * 20);
        drs = 0;
      } else if (phase < 0.65) {
        const prog = (phase - 0.45) / 0.20;
        speed = Math.round(85 + Math.sin(prog * Math.PI) * 105);
        throttle = Math.round(40 + Math.sin(prog * Math.PI) * 55);
        brake = prog > 0.4 && prog < 0.6 ? 45 : 0;
        drs = 0;
      } else {
        const prog = (phase - 0.65) / 0.35;
        speed = Math.round(190 + prog * 125);
        throttle = Math.round(75 + prog * 25);
        brake = 0;
        drs = prog > 0.5 ? 12 : 0;
      }

      let gear = 1, rpm = 9000;
      for (let g of gearRatios) {
        if (speed <= g.maxSpeed || g.gear === 8) {
          gear = g.gear;
          const prog = Math.max(0, Math.min(1, (speed - g.minSpeed) / (g.maxSpeed - g.minSpeed)));
          rpm = Math.round(g.minRpm + prog * (g.maxRpm - g.minRpm));
          break;
        }
      }

      return {
        speed,
        gear,
        rpm,
        throttle,
        brake,
        drs,
        trackProgress: phase
      };
    };

    state.simTimer = setInterval(() => {
      if (!state.simulatedMode) return;
      simTime += 0.05;

      // Driver 1
      state.currentTelemetry = calcCar(0);

      // Driver 2 (battling ~1.5s behind)
      if (state.compareMode) {
        state.compareTelemetry = calcCar(-1.5);
      }
    }, 50);
  }

})();
