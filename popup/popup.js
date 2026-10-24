// Popup Script for F1 Telemetry Extension

document.addEventListener('DOMContentLoaded', async () => {
  const toggleHud = document.getElementById('toggle-hud');
  const sessionTitle = document.getElementById('session-title');
  const sessionMeta = document.getElementById('session-meta');
  const driverSelect = document.getElementById('driver-select');
  const syncSlider = document.getElementById('sync-slider');
  const offsetDisplay = document.getElementById('offset-display');
  const btnSub5 = document.getElementById('btn-sub-5');
  const btnSub1 = document.getElementById('btn-sub-1');
  const btnAdd1 = document.getElementById('btn-add-1');
  const btnAdd5 = document.getElementById('btn-add-5');
  const dockButtons = document.querySelectorAll('.dock-btn');
  const btnOpenDemo = document.getElementById('btn-open-demo');

  // Load existing settings
  chrome.storage.local.get(['f1_driver', 'f1_offset', 'f1_preset', 'hudEnabled'], (res) => {
    if (res.hudEnabled !== undefined) toggleHud.checked = res.hudEnabled;
    if (res.f1_offset !== undefined) updateOffsetUI(res.f1_offset);
    if (res.f1_preset) {
      dockButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pos === res.f1_preset);
      });
    }
  });

  // Fetch OpenF1 Session & Drivers
  try {
    const session = await window.OpenF1Client.getLatestSession();
    if (session) {
      sessionTitle.textContent = `${session.country_name || session.circuit_short_name} - ${session.session_name}`;
      sessionMeta.textContent = `${session.year} Season • Key #${session.session_key}`;

      const drivers = await window.OpenF1Client.getDrivers(session.session_key);
      driverSelect.innerHTML = '';

      chrome.storage.local.get(['f1_driver'], (stored) => {
        drivers.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.number;
          opt.textContent = `#${d.number} ${d.code} - ${d.name} (${d.team})`;
          if (stored.f1_driver && stored.f1_driver === d.number) {
            opt.selected = true;
          }
          driverSelect.appendChild(opt);
        });
      });
    } else {
      sessionTitle.textContent = 'No Live Session Active';
      sessionMeta.textContent = 'Using telemetry demo simulation mode';
    }
  } catch (e) {
    sessionTitle.textContent = 'OpenF1 Offline/Demo Mode';
    sessionMeta.textContent = 'Check your network connection';
  }

  // Toggle HUD
  toggleHud.addEventListener('change', () => {
    chrome.storage.local.set({ hudEnabled: toggleHud.checked });
    sendTabMessage({ action: 'TOGGLE_HUD' });
  });

  // Driver Change
  driverSelect.addEventListener('change', () => {
    const driverNum = parseInt(driverSelect.value, 10);
    chrome.storage.local.set({ f1_driver: driverNum });
    sendTabMessage({ action: 'SELECT_DRIVER', driverNumber: driverNum });
  });

  // Sync Offset Handlers
  function updateOffsetUI(val) {
    val = parseInt(val, 10);
    syncSlider.value = val;
    offsetDisplay.textContent = `${val > 0 ? '+' : ''}${val}s`;
    chrome.storage.local.set({ f1_offset: val });
  }

  syncSlider.addEventListener('input', (e) => updateOffsetUI(e.target.value));
  btnSub5.addEventListener('click', () => updateOffsetUI(parseInt(syncSlider.value, 10) - 5));
  btnSub1.addEventListener('click', () => updateOffsetUI(parseInt(syncSlider.value, 10) - 1));
  btnAdd1.addEventListener('click', () => updateOffsetUI(parseInt(syncSlider.value, 10) + 1));
  btnAdd5.addEventListener('click', () => updateOffsetUI(parseInt(syncSlider.value, 10) + 5));

  // Dock Buttons
  dockButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      dockButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const pos = btn.dataset.pos;
      chrome.storage.local.set({ f1_preset: pos, f1_pos: null });
    });
  });

  // Launch Demo Page
  btnOpenDemo.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('demo.html') });
  });

  function sendTabMessage(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, msg, () => {
          if (chrome.runtime.lastError) {
            // Content script not loaded on this tab, ignore
          }
        });
      }
    });
  }
});
