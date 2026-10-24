// Popup Script for F1 Telemetry Extension

document.addEventListener('DOMContentLoaded', async () => {
  const toggleHud = document.getElementById('toggle-hud');
  const eventStatusPill = document.getElementById('event-status-pill');
  const eventCountry = document.getElementById('event-country');
  const sessionTitle = document.getElementById('session-title');
  const countdownLabel = document.getElementById('countdown-label');
  const countdownDigits = document.getElementById('countdown-digits');
  const sessionMeta = document.getElementById('session-meta');
  const btnToggleSchedule = document.getElementById('btn-toggle-schedule');
  const accordionArrow = document.getElementById('accordion-arrow');
  const scheduleList = document.getElementById('schedule-list');
  const driverSelect = document.getElementById('driver-select');
  const compareDriverSelect = document.getElementById('compare-driver-select');
  const btnToggleCompare = document.getElementById('btn-toggle-compare');
  const compareBadge = document.getElementById('compare-badge');
  const syncSlider = document.getElementById('sync-slider');
  const offsetDisplay = document.getElementById('offset-display');
  const btnSub5 = document.getElementById('btn-sub-5');
  const btnSub1 = document.getElementById('btn-sub-1');
  const btnAdd1 = document.getElementById('btn-add-1');
  const btnAdd5 = document.getElementById('btn-add-5');
  const dockButtons = document.querySelectorAll('.dock-btn');
  const btnOpenDemo = document.getElementById('btn-open-demo');

  let countdownInterval = null;

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

  // Fetch OpenF1 Weekend Schedule & Active Event
  try {
    const eventData = await window.OpenF1Client.getWeekendEventSchedule();
    if (eventData && eventData.activeSession) {
      const active = eventData.activeSession;
      eventCountry.textContent = `${eventData.country || 'Formula 1'} GP`;
      sessionTitle.textContent = `${active.session_name || 'F1 Session'}`;

      // Format Start Date & Time in User's Local Timezone
      const startDate = new Date(active.date_start);
      const endDate = new Date(active.date_end);
      const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

      // Target timestamp for countdown
      let targetTime = startDate.getTime();

      if (eventData.status === 'LIVE') {
        eventStatusPill.className = 'status-pill live';
        eventStatusPill.textContent = '🔴 LIVE NOW';
        countdownLabel.textContent = 'SESSION ENDS IN:';
        targetTime = endDate.getTime();
        sessionMeta.textContent = `Started at ${timeStr} • FanCode Live Broadcast`;
      } else if (eventData.status === 'UPCOMING') {
        eventStatusPill.className = 'status-pill upcoming';
        eventStatusPill.textContent = '⏳ NEXT EVENT';
        countdownLabel.textContent = 'STARTS IN:';
        sessionMeta.textContent = `${dateStr} at ${timeStr} (Your local time)`;
      } else {
        eventStatusPill.className = 'status-pill completed';
        eventStatusPill.textContent = '🏁 COMPLETED';
        countdownLabel.textContent = 'STATUS:';
        countdownDigits.textContent = 'Weekend Done';
        sessionMeta.textContent = `Finished on ${dateStr}`;
      }

      // Start live countdown timer
      if (eventData.status === 'LIVE' || eventData.status === 'UPCOMING') {
        startCountdown(targetTime);
      }

      // Render full weekend schedule list
      renderWeekendSchedule(eventData.sessions, active.session_key);

      // Load Drivers for active session
      const drivers = await window.OpenF1Client.getDrivers(active.session_key);
      driverSelect.innerHTML = '';
      if (compareDriverSelect) compareDriverSelect.innerHTML = '';

      chrome.storage.local.get(['f1_driver', 'f1_compare_driver', 'f1_compare_mode'], (stored) => {
        if (stored.f1_compare_mode) {
          compareBadge.textContent = 'ON';
          compareBadge.style.background = 'rgba(255, 145, 0, 0.25)';
          compareBadge.style.color = '#ff9100';
        }

        drivers.forEach((d, i) => {
          const opt1 = document.createElement('option');
          opt1.value = d.number;
          opt1.textContent = `#${d.number} ${d.code} - ${d.name} (${d.team})`;
          if (stored.f1_driver && stored.f1_driver === d.number) {
            opt1.selected = true;
          }
          driverSelect.appendChild(opt1);

          if (compareDriverSelect) {
            const opt2 = document.createElement('option');
            opt2.value = d.number;
            opt2.textContent = `#${d.number} ${d.code} - ${d.name} (${d.team})`;
            if (stored.f1_compare_driver ? stored.f1_compare_driver === d.number : i === 1) {
              opt2.selected = true;
            }
            compareDriverSelect.appendChild(opt2);
          }
        });
      });
    } else {
      sessionTitle.textContent = 'No Live Session Active';
      sessionMeta.textContent = 'Using telemetry demo simulation mode';
    }
  } catch (e) {
    console.warn('[Popup] Error loading schedule:', e);
    sessionTitle.textContent = 'United States GP';
    sessionMeta.textContent = 'OpenF1 Demo Lap Mode';
  }

  // Live countdown calculation
  function startCountdown(targetTimestamp) {
    if (countdownInterval) clearInterval(countdownInterval);

    const update = () => {
      const now = Date.now();
      const diff = targetTimestamp - now;

      if (diff <= 0) {
        countdownDigits.textContent = '00h 00m 00s';
        clearInterval(countdownInterval);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      const pad = (n) => String(n).padStart(2, '0');

      if (days > 0) {
        countdownDigits.textContent = `${days}d ${pad(hours)}h ${pad(mins)}m`;
      } else {
        countdownDigits.textContent = `${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
      }
    };

    update();
    countdownInterval = setInterval(update, 1000);
  }

  // Render Weekend Schedule List
  function renderWeekendSchedule(sessions, activeSessionKey) {
    if (!sessions || sessions.length === 0) return;
    scheduleList.innerHTML = '';

    const now = new Date();

    sessions.forEach(s => {
      const start = new Date(s.date_start);
      const end = new Date(s.date_end);
      const isLive = now >= start && now <= end;
      const isPast = now > end;

      let statusClass = 'upcoming';
      let icon = '⏳';
      if (isLive) {
        statusClass = 'live';
        icon = '🔴';
      } else if (isPast) {
        statusClass = 'completed';
        icon = '✓';
      }

      const row = document.createElement('div');
      row.className = `schedule-row ${statusClass} ${s.session_key === activeSessionKey ? 'active' : ''}`;

      const timeText = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dayText = start.toLocaleDateString([], { weekday: 'short' });

      row.innerHTML = `
        <div class="schedule-row-left">
          <span class="schedule-dot"></span>
          <span>${s.session_name}</span>
        </div>
        <div class="schedule-time">${dayText} ${timeText}</div>
      `;

      scheduleList.appendChild(row);
    });
  }

  // Accordion Toggle
  btnToggleSchedule.addEventListener('click', () => {
    const isHidden = scheduleList.style.display === 'none';
    scheduleList.style.display = isHidden ? 'flex' : 'none';
    accordionArrow.classList.toggle('open', isHidden);
  });

  // Toggle HUD
  toggleHud.addEventListener('change', () => {
    chrome.storage.local.set({ hudEnabled: toggleHud.checked });
    sendTabMessage({ action: 'TOGGLE_HUD' });
  });

  // Driver 1 Change
  driverSelect.addEventListener('change', () => {
    const driverNum = parseInt(driverSelect.value, 10);
    chrome.storage.local.set({ f1_driver: driverNum });
    sendTabMessage({ action: 'SELECT_DRIVER', driverNumber: driverNum });
  });

  // Driver 2 (Comparison) Change
  if (compareDriverSelect) {
    compareDriverSelect.addEventListener('change', () => {
      const driverNum = parseInt(compareDriverSelect.value, 10);
      chrome.storage.local.set({ f1_compare_driver: driverNum });
      sendTabMessage({ action: 'SELECT_COMPARE_DRIVER', driverNumber: driverNum });
    });
  }

  // Toggle Dual HUD Comparison Mode
  if (btnToggleCompare) {
    btnToggleCompare.addEventListener('click', () => {
      chrome.storage.local.get(['f1_compare_mode'], (stored) => {
        const nextState = !stored.f1_compare_mode;
        chrome.storage.local.set({ f1_compare_mode: nextState });
        compareBadge.textContent = nextState ? 'ON' : 'OFF';
        compareBadge.style.background = nextState ? 'rgba(255, 145, 0, 0.25)' : '';
        compareBadge.style.color = nextState ? '#ff9100' : '';
        sendTabMessage({ action: 'TOGGLE_COMPARE' });
      });
    });
  }

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
