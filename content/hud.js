/**
 * F1 Car Telemetry Overlay HUD - Content Script
 * Injected on FanCode to render draggable real-time F1 car telemetry.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__F1_HUD_INITIALIZED__) return;
  window.__F1_HUD_INITIALIZED__ = true;

  // State
  const state = {
    visible: true,
    minimized: false,
    session: null,
    sessionKey: 'latest',
    drivers: [],
    selectedDriver: null,
    syncOffset: 0, // seconds delay offset (adjust for stream delay)
    opacity: 0.95,
    preset: 'pos-top-right',
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    simulatedMode: false,
    telemetryBuffer: [],
    currentTelemetry: {
      speed: 0,
      gear: 'N',
      rpm: 0,
      throttle: 0,
      brake: 0,
      drs: 0
    }
  };

  let hudRoot = null;
  let hudContainer = null;
  let pollTimer = null;
  let renderLoopId = null;

  // Initialize
  init();

  async function init() {
    loadSavedSettings();
    createHUDDOM();
    setupEventListeners();
    setupFullscreenHandler();
    startRenderLoop();
    await loadF1Session();
  }

  function loadSavedSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['f1_driver', 'f1_offset', 'f1_preset', 'f1_opacity', 'f1_pos'], (res) => {
        if (res.f1_offset !== undefined) state.syncOffset = res.f1_offset;
        if (res.f1_preset) state.preset = res.f1_preset;
        if (res.f1_opacity) state.opacity = res.f1_opacity;
        if (res.f1_driver) state.savedDriverNumber = res.f1_driver;

        applySavedStyles(res.f1_pos);
      });
    }
  }

  function applySavedStyles(savedPos) {
    if (!hudContainer) return;
    hudContainer.style.opacity = state.opacity;
    const opacityInput = hudRoot.querySelector('#f1-opacity-slider');
    if (opacityInput) opacityInput.value = state.opacity * 100;

    const offsetInput = hudRoot.querySelector('#f1-offset-slider');
    const offsetVal = hudRoot.querySelector('#f1-offset-val');
    if (offsetInput) offsetInput.value = state.syncOffset;
    if (offsetVal) offsetVal.textContent = `${state.syncOffset > 0 ? '+' : ''}${state.syncOffset}s`;

    if (savedPos && savedPos.left && savedPos.top) {
      hudContainer.className = 'f1-hud-container';
      hudContainer.style.left = savedPos.left;
      hudContainer.style.top = savedPos.top;
      hudContainer.style.right = 'auto';
      hudContainer.style.bottom = 'auto';
    } else {
      setPresetPosition(state.preset);
    }
  }

  function createHUDDOM() {
    hudRoot = document.createElement('div');
    hudRoot.id = 'f1-telemetry-hud-root';

    hudRoot.innerHTML = `
      <div class="f1-hud-container ${state.preset}">
        <!-- Team Accent Line -->
        <div class="f1-team-stripe" id="f1-team-stripe"></div>

        <!-- Draggable Top Bar -->
        <div class="f1-hud-header" id="f1-hud-header">
          <div class="f1-header-left">
            <div class="f1-drag-icon" title="Drag to move">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <!-- Driver Switcher Dropdown Trigger -->
            <div class="f1-driver-badge" id="f1-driver-badge" title="Click to choose driver">
              <span class="f1-driver-num" id="f1-badge-num">--</span>
              <span class="f1-driver-code" id="f1-badge-code">SELECT</span>
              <span class="f1-driver-arrow">▼</span>
            </div>
          </div>

          <div class="f1-header-controls">
            <button class="f1-btn-icon" id="f1-btn-settings" title="Video Sync & Settings">⚙</button>
            <button class="f1-btn-icon" id="f1-btn-minimize" title="Minimize / Expand">_</button>
            <button class="f1-btn-icon" id="f1-btn-close" title="Hide HUD">×</button>
          </div>
        </div>

        <!-- Driver Selection Dropdown -->
        <div class="f1-driver-dropdown" id="f1-driver-dropdown">
          <div style="padding: 6px; font-size: 11px; color: #888; text-transform: uppercase;">Select Driver:</div>
          <div id="f1-driver-list"></div>
        </div>

        <!-- RPM Shift Lights (15 LEDs) -->
        <div class="f1-rpm-section">
          <div class="f1-led-bar" id="f1-led-bar">
            ${Array.from({ length: 15 }).map((_, i) => `<div class="f1-led" data-idx="${i}"></div>`).join('')}
          </div>
          <div class="f1-rpm-label">
            <span id="f1-rpm-text">0 RPM</span>
            <span id="f1-speed-sub">KM/H</span>
          </div>
        </div>

        <!-- Telemetry Body: Speed, Gear, Pedals -->
        <div class="f1-telemetry-body">
          <div class="f1-center-metrics">
            <div class="f1-gear-box">
              <div class="f1-gear-label">GEAR</div>
              <div class="f1-gear-val" id="f1-gear-val">N</div>
            </div>

            <div class="f1-speed-box">
              <div class="f1-speed-val" id="f1-speed-val">0</div>
              <div class="f1-speed-unit">SPEED (KM/H)</div>
            </div>
          </div>

          <!-- Throttle & Brake Pedals -->
          <div class="f1-pedals-box">
            <div class="f1-pedal">
              <div class="f1-pedal-track">
                <div class="f1-pedal-fill throttle" id="f1-throttle-fill" style="height: 0%;"></div>
              </div>
              <div class="f1-pedal-name">THR</div>
              <div class="f1-pedal-val" id="f1-throttle-val">0%</div>
            </div>

            <div class="f1-pedal">
              <div class="f1-pedal-track">
                <div class="f1-pedal-fill brake" id="f1-brake-fill" style="height: 0%;"></div>
              </div>
              <div class="f1-pedal-name">BRK</div>
              <div class="f1-pedal-val" id="f1-brake-val">0%</div>
            </div>
          </div>
        </div>

        <!-- Status & DRS Bar -->
        <div class="f1-status-bar">
          <div class="f1-drs-badge" id="f1-drs-badge">DRS OFF</div>
          <div class="f1-session-tag" id="f1-session-tag">Loading OpenF1...</div>
        </div>

        <!-- Settings & Video Sync Drawer -->
        <div class="f1-settings-panel" id="f1-settings-panel">
          <div class="f1-control-row">
            <label title="Adjust if video stream is ahead or behind telemetry">FanCode Stream Sync:</label>
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

          <div class="f1-control-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
            <label>Demo / Practice Mode:</label>
            <button class="f1-dock-btn" id="f1-toggle-demo" style="width: auto; padding: 4px 10px;">
              ${state.simulatedMode ? '🟢 Running Demo Lap' : '⚪ Test Demo Lap'}
            </button>
          </div>
        </div>
      </div>
    `;

    mountHUD(hudRoot);
    hudContainer = hudRoot.querySelector('.f1-hud-container');
  }

  function mountHUD(element) {
    // Try to find the video container on FanCode, or attach to document.body
    const video = document.querySelector('video');
    const container = video?.parentElement || document.body;
    container.appendChild(element);
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
    const header = hudRoot.querySelector('#f1-hud-header');
    const driverBadge = hudRoot.querySelector('#f1-driver-badge');
    const driverDropdown = hudRoot.querySelector('#f1-driver-dropdown');
    const btnSettings = hudRoot.querySelector('#f1-btn-settings');
    const btnMinimize = hudRoot.querySelector('#f1-btn-minimize');
    const btnClose = hudRoot.querySelector('#f1-btn-close');
    const settingsPanel = hudRoot.querySelector('#f1-settings-panel');
    const offsetSlider = hudRoot.querySelector('#f1-offset-slider');
    const offsetVal = hudRoot.querySelector('#f1-offset-val');
    const offsetPlus = hudRoot.querySelector('#f1-offset-plus');
    const offsetMinus = hudRoot.querySelector('#f1-offset-minus');
    const opacitySlider = hudRoot.querySelector('#f1-opacity-slider');
    const toggleDemoBtn = hudRoot.querySelector('#f1-toggle-demo');

    // Drag and Drop
    header.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // Touch support for drag
    header.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        onDragStart({ clientX: touch.clientX, clientY: touch.clientY, target: e.target });
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (state.isDragging && e.touches.length === 1) {
        const touch = e.touches[0];
        onDragMove({ clientX: touch.clientX, clientY: touch.clientY });
      }
    }, { passive: true });

    document.addEventListener('touchend', onDragEnd);

    // Driver Dropdown Toggle
    driverBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      driverDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!driverDropdown.contains(e.target) && !driverBadge.contains(e.target)) {
        driverDropdown.classList.remove('active');
      }
    });

    // Settings Toggle
    btnSettings.addEventListener('click', () => {
      settingsPanel.classList.toggle('active');
    });

    // Minimize Toggle
    btnMinimize.addEventListener('click', () => {
      state.minimized = !state.minimized;
      hudContainer.classList.toggle('minimized', state.minimized);
      btnMinimize.textContent = state.minimized ? '▢' : '_';
    });

    // Close Button (minimize or toggle)
    btnClose.addEventListener('click', () => {
      hudRoot.style.display = 'none';
      state.visible = false;
    });

    // Sync Offset Controls
    const updateOffset = (newOffset) => {
      state.syncOffset = parseInt(newOffset, 10);
      offsetSlider.value = state.syncOffset;
      offsetVal.textContent = `${state.syncOffset > 0 ? '+' : ''}${state.syncOffset}s`;
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ f1_offset: state.syncOffset });
      }
    };

    offsetSlider.addEventListener('input', (e) => updateOffset(e.target.value));
    offsetPlus.addEventListener('click', () => updateOffset(state.syncOffset + 1));
    offsetMinus.addEventListener('click', () => updateOffset(state.syncOffset - 1));

    // Opacity
    opacitySlider.addEventListener('input', (e) => {
      state.opacity = e.target.value / 100;
      hudContainer.style.opacity = state.opacity;
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ f1_opacity: state.opacity });
      }
    });

    // Docking Preset Buttons
    hudRoot.querySelectorAll('.f1-dock-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        setPresetPosition(preset);
      });
    });

    // Toggle Demo / Simulation Mode
    toggleDemoBtn.addEventListener('click', () => {
      state.simulatedMode = !state.simulatedMode;
      toggleDemoBtn.textContent = state.simulatedMode ? '🟢 Running Demo Lap' : '⚪ Test Demo Lap';
      if (state.simulatedMode) {
        startSimulation();
      }
    });

    // Listen to background extension messages
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'TOGGLE_HUD') {
          state.visible = !state.visible;
          hudRoot.style.display = state.visible ? 'block' : 'none';
          sendResponse({ visible: state.visible });
        }
        if (msg.action === 'SELECT_DRIVER') {
          const d = state.drivers.find(x => x.number === msg.driverNumber);
          if (d) selectDriver(d);
          sendResponse({ success: true });
        }
      });
    }
  }

  function setPresetPosition(presetClass) {
    state.preset = presetClass;
    hudContainer.className = `f1-hud-container ${presetClass}`;
    if (state.minimized) hudContainer.classList.add('minimized');
    hudContainer.style.left = '';
    hudContainer.style.top = '';
    hudContainer.style.right = '';
    hudContainer.style.bottom = '';
    hudContainer.style.transform = '';

    if (presetClass === 'pos-top-center') {
      hudContainer.style.transform = 'translateX(-50%)';
    }

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ f1_preset: presetClass, f1_pos: null });
    }
  }

  // Dragging handlers
  function onDragStart(e) {
    if (e.target.closest('button') || e.target.closest('#f1-driver-badge') || e.target.closest('input')) return;
    state.isDragging = true;
    const rect = hudContainer.getBoundingClientRect();
    state.dragOffset.x = e.clientX - rect.left;
    state.dragOffset.y = e.clientY - rect.top;
    if (e.cancelable && e.preventDefault) {
      e.preventDefault();
    }
  }

  function onDragMove(e) {
    if (!state.isDragging) return;

    // Convert from preset to free drag
    hudContainer.className = 'f1-hud-container';
    if (state.minimized) hudContainer.classList.add('minimized');

    let x = e.clientX - state.dragOffset.x;
    let y = e.clientY - state.dragOffset.y;

    // Boundary containment within window
    const maxX = window.innerWidth - hudContainer.offsetWidth - 10;
    const maxY = window.innerHeight - hudContainer.offsetHeight - 10;

    x = Math.max(10, Math.min(x, maxX));
    y = Math.max(10, Math.min(y, maxY));

    hudContainer.style.left = `${x}px`;
    hudContainer.style.top = `${y}px`;
    hudContainer.style.right = 'auto';
    hudContainer.style.bottom = 'auto';
    hudContainer.style.transform = 'none';
  }

  function onDragEnd() {
    if (!state.isDragging) return;
    state.isDragging = false;

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        f1_pos: {
          left: hudContainer.style.left,
          top: hudContainer.style.top
        }
      });
    }
  }

  // Load Session & Drivers from OpenF1
  async function loadF1Session() {
    const sessionTag = hudRoot.querySelector('#f1-session-tag');
    try {
      sessionTag.textContent = 'Connecting to OpenF1...';
      const schedule = await window.OpenF1Client.getWeekendEventSchedule();
      const session = schedule?.activeSession || await window.OpenF1Client.getLatestSession();

      if (!session) {
        sessionTag.textContent = 'No active session found';
        startSimulation();
        return;
      }

      state.session = session;

      if (schedule && schedule.status === 'UPCOMING') {
        const diffMs = new Date(session.date_start).getTime() - Date.now();
        const diffH = Math.floor(diffMs / 3600000);
        const diffM = Math.floor((diffMs % 3600000) / 60000);
        const timeStr = diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`;
        sessionTag.textContent = `⏳ NEXT: ${session.session_name} (in ${timeStr})`;
      } else if (schedule && schedule.status === 'LIVE') {
        sessionTag.textContent = `🔴 LIVE: ${session.session_name}`;
      } else {
        sessionTag.textContent = `${session.circuit_short_name || 'F1'} - ${session.session_name || 'Session'}`;
      }

      // Load Drivers
      const drivers = await window.OpenF1Client.getDrivers(session.session_key);
      state.drivers = drivers;
      renderDriverDropdown(drivers);

      // Select initial driver
      let initialDriver = drivers.find(d => d.number === state.savedDriverNumber) || drivers[0];
      if (initialDriver) {
        selectDriver(initialDriver);
      }

      // Start live polling loop
      startTelemetryPolling();
    } catch (err) {
      console.error('[F1 Telemetry HUD] Failed to load session:', err);
      sessionTag.textContent = 'OpenF1 Demo Lap Mode';
      startSimulation();
    }
  }

  function renderDriverDropdown(drivers) {
    const list = hudRoot.querySelector('#f1-driver-list');
    list.innerHTML = '';

    drivers.forEach(driver => {
      const item = document.createElement('div');
      item.className = 'f1-driver-item';
      if (state.selectedDriver && state.selectedDriver.number === driver.number) {
        item.classList.add('selected');
      }

      item.innerHTML = `
        <div class="f1-driver-item-color" style="background-color: ${driver.color}"></div>
        <div class="f1-driver-num" style="color: ${driver.color}; font-weight:bold; min-width: 20px;">${driver.number}</div>
        <div class="f1-driver-item-name">${driver.name || driver.code}</div>
        <div class="f1-driver-item-team">${driver.team || ''}</div>
      `;

      item.addEventListener('click', () => {
        selectDriver(driver);
        hudRoot.querySelector('#f1-driver-dropdown').classList.remove('active');
      });

      list.appendChild(item);
    });
  }

  function selectDriver(driver) {
    state.selectedDriver = driver;
    state.telemetryBuffer = []; // reset buffer for new driver

    // Update UI Elements
    hudRoot.querySelector('#f1-badge-num').textContent = driver.number;
    hudRoot.querySelector('#f1-badge-code').textContent = driver.code;
    hudRoot.querySelector('#f1-badge-num').style.color = driver.color;
    hudRoot.querySelector('#f1-team-stripe').style.backgroundColor = driver.color;
    hudRoot.querySelector('#f1-team-stripe').style.boxShadow = `0 0 8px ${driver.color}`;

    document.documentElement.style.setProperty('--f1-team-color', driver.color);

    // Update selected class in dropdown
    hudRoot.querySelectorAll('.f1-driver-item').forEach(item => {
      const num = item.querySelector('.f1-driver-num')?.textContent;
      item.classList.toggle('selected', num == driver.number);
    });

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ f1_driver: driver.number });
    }
  }

  // Telemetry Polling Loop
  function startTelemetryPolling() {
    if (pollTimer) clearInterval(pollTimer);

    const poll = async () => {
      if (!state.selectedDriver || !state.session) return;

      try {
        const data = await window.OpenF1Client.getRecentCarData(state.session.session_key, state.selectedDriver.number, 15);
        if (Array.isArray(data) && data.length > 0) {
          // Live telemetry received! Stop simulation and switch to live data
          state.simulatedMode = false;
          state.telemetryBuffer = data.sort((a, b) => new Date(a.date) - new Date(b.date));
          const sessionTag = hudRoot.querySelector('#f1-session-tag');
          if (sessionTag && state.session) {
            sessionTag.textContent = `🔴 LIVE • ${state.session.circuit_short_name || 'F1'} - ${state.session.session_name}`;
          }
        } else if (!state.simulatedMode) {
          // No live telemetry on track right now (cars in garage, red flag, or post-session)
          // Automatically run the flying lap simulation so HUD is actively revving & moving!
          const sessionTag = hudRoot.querySelector('#f1-session-tag');
          if (sessionTag && state.session) {
            sessionTag.textContent = `⚡ DEMO LAP • ${state.session.circuit_short_name || 'Austin'} GP`;
          }
          startSimulation();
        }
      } catch (e) {
        console.warn('[F1 Telemetry] Polling note:', e);
        if (!state.simulatedMode) {
          startSimulation();
        }
      }
    };

    poll();
    pollTimer = setInterval(poll, 3000);
  }

  // Smooth Telemetry Render Loop (60 FPS)
  function startRenderLoop() {
    const updateUI = () => {
      if (!state.simulatedMode && state.telemetryBuffer.length > 0) {
        interpolateTelemetryFromBuffer();
      }

      renderTelemetryUI(state.currentTelemetry);
      renderLoopId = requestAnimationFrame(updateUI);
    };

    renderLoopId = requestAnimationFrame(updateUI);
  }

  function interpolateTelemetryFromBuffer() {
    // Target playback time with offset applied
    const now = Date.now();
    const targetTime = now - (state.syncOffset * 1000);

    // Find the closest telemetry sample or interpolate between two
    const buffer = state.telemetryBuffer;
    let closest = buffer[buffer.length - 1];

    for (let i = 0; i < buffer.length - 1; i++) {
      const tA = new Date(buffer[i].date).getTime();
      const tB = new Date(buffer[i + 1].date).getTime();

      if (targetTime >= tA && targetTime <= tB) {
        const factor = (targetTime - tA) / (tB - tA);
        closest = {
          speed: Math.round(buffer[i].speed + (buffer[i + 1].speed - buffer[i].speed) * factor),
          rpm: Math.round(buffer[i].rpm + (buffer[i + 1].rpm - buffer[i].rpm) * factor),
          n_gear: factor > 0.5 ? buffer[i + 1].n_gear : buffer[i].n_gear,
          throttle: Math.round(buffer[i].throttle + (buffer[i + 1].throttle - buffer[i].throttle) * factor),
          brake: buffer[i + 1].brake > 0 ? buffer[i + 1].brake : buffer[i].brake,
          drs: buffer[i + 1].drs
        };
        break;
      }
    }

    if (closest) {
      state.currentTelemetry = {
        speed: closest.speed || 0,
        gear: closest.n_gear === 0 ? 'N' : closest.n_gear,
        rpm: closest.rpm || 0,
        throttle: Math.min(100, closest.throttle || 0),
        brake: Math.min(100, closest.brake || 0),
        drs: closest.drs
      };
    }
  }

  function renderTelemetryUI(t) {
    if (!hudRoot) return;

    // Speed & Gear
    const gearEl = hudRoot.querySelector('#f1-gear-val');
    const speedEl = hudRoot.querySelector('#f1-speed-val');
    if (gearEl) gearEl.textContent = t.gear;
    if (speedEl) speedEl.textContent = t.speed;

    // Throttle & Brake Bars
    const thrFill = hudRoot.querySelector('#f1-throttle-fill');
    const thrVal = hudRoot.querySelector('#f1-throttle-val');
    const brkFill = hudRoot.querySelector('#f1-brake-fill');
    const brkVal = hudRoot.querySelector('#f1-brake-val');

    if (thrFill) thrFill.style.height = `${t.throttle}%`;
    if (thrVal) thrVal.textContent = `${t.throttle}%`;
    if (brkFill) brkFill.style.height = `${t.brake}%`;
    if (brkVal) brkVal.textContent = `${t.brake}%`;

    // RPM Text
    const rpmText = hudRoot.querySelector('#f1-rpm-text');
    if (rpmText) rpmText.textContent = `${t.rpm.toLocaleString()} RPM`;

    // Shift Lights (15 LEDs)
    // 0-4: Green (8,500 - 10,800)
    // 5-9: Red (10,800 - 12,200)
    // 10-14: Blue (12,200 - 13,200)
    const leds = hudRoot.querySelectorAll('.f1-led');
    const rpm = t.rpm;
    const minRpm = 8500;
    const maxRpm = 13200;

    let activeLeds = 0;
    if (rpm > minRpm) {
      const ratio = Math.min(1, Math.max(0, (rpm - minRpm) / (maxRpm - minRpm)));
      activeLeds = Math.round(ratio * 15);
    }

    leds.forEach((led, idx) => {
      led.className = 'f1-led';
      if (idx < activeLeds) {
        if (idx < 5) led.classList.add('lit-green');
        else if (idx < 10) led.classList.add('lit-red');
        else led.classList.add('lit-blue');
      }
    });

    // DRS Badge
    const drsBadge = hudRoot.querySelector('#f1-drs-badge');
    if (drsBadge) {
      if (t.drs === 10 || t.drs === 12 || t.drs === 14) {
        drsBadge.className = 'f1-drs-badge active';
        drsBadge.textContent = 'DRS ACTIVE';
      } else if (t.drs === 8) {
        drsBadge.className = 'f1-drs-badge avail';
        drsBadge.textContent = 'DRS AVAIL';
      } else {
        drsBadge.className = 'f1-drs-badge';
        drsBadge.textContent = 'DRS OFF';
      }
    }
  }

  // Realistic F1 Hot Lap Simulation (for testing when off-race or on demo)
  function startSimulation() {
    state.simulatedMode = true;
    if (state.simTimer) clearInterval(state.simTimer);

    const toggleDemoBtn = hudRoot?.querySelector('#f1-toggle-demo');
    if (toggleDemoBtn) toggleDemoBtn.textContent = '🟢 Running Demo Lap';

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

    state.simTimer = setInterval(() => {
      if (!state.simulatedMode) return;
      simTime += 0.05;

      // 40 second lap cycle
      const phase = (simTime % 40) / 40;
      let speed = 0;
      let throttle = 0;
      let brake = 0;
      let drs = 0;
      let gear = 1;
      let rpm = 9000;

      if (phase < 0.35) {
        // Main Straight acceleration: 120 -> 338 km/h
        const prog = phase / 0.35;
        speed = Math.round(120 + Math.pow(prog, 0.7) * 218);
        throttle = 100;
        brake = 0;
        drs = prog > 0.25 ? 12 : 8; // DRS opens on straight!
      } else if (phase < 0.45) {
        // Heavy Braking into Turn 1: 338 -> 85 km/h
        const prog = (phase - 0.35) / 0.10;
        speed = Math.round(338 - prog * 253);
        throttle = 0;
        brake = Math.round(100 - prog * 20);
        drs = 0;
      } else if (phase < 0.65) {
        // Technical apex & mid-speed corners: 85 -> 190 km/h
        const prog = (phase - 0.45) / 0.20;
        speed = Math.round(85 + Math.sin(prog * Math.PI) * 105);
        throttle = Math.round(40 + Math.sin(prog * Math.PI) * 55);
        brake = prog > 0.4 && prog < 0.6 ? 45 : 0;
        drs = 0;
      } else {
        // Back straight surge: 190 -> 315 km/h
        const prog = (phase - 0.65) / 0.35;
        speed = Math.round(190 + prog * 125);
        throttle = Math.round(75 + prog * 25);
        brake = 0;
        drs = prog > 0.5 ? 12 : 0;
      }

      // Determine gear and rpm from speed
      for (let g of gearRatios) {
        if (speed <= g.maxSpeed || g.gear === 8) {
          gear = g.gear;
          const speedProg = Math.max(0, Math.min(1, (speed - g.minSpeed) / (g.maxSpeed - g.minSpeed)));
          rpm = Math.round(g.minRpm + speedProg * (g.maxRpm - g.minRpm));
          break;
        }
      }

      state.currentTelemetry = {
        speed,
        gear,
        rpm,
        throttle,
        brake,
        drs
      };
    }, 50);
  }

})();
