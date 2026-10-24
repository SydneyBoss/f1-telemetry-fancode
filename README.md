# F1 Car Telemetry & Pit Wall Overlay for FanCode 🏎️💨

A professional Formula 1 broadcast telemetry overlay and pit wall extension for **FanCode**, powered by the **OpenF1 API**.

Brings real-time car telemetry, an **interactive circuit track minimap**, **dual-driver comparison mode**, and a **live Grand Prix event countdown** directly onto your FanCode video player.

---

## 🌟 Key Features

### 1. 🗺️ Live Circuit Track Minimap
* **Real-time GPS Tracking**: Follows cars around the official Grand Prix track layout (Austin COTA, Silverstone, Monza, Spa, etc.).
* **Dynamic Driver Markers**: Glowing car dots styled with official team colors and driver numbers (e.g. Papaya `#1 NOR`, Red Bull Blue `#3 VER`).
* **Collapsible Map View**: Click the **`🗺️`** icon in the header to expand or collapse the minimap above the telemetry data anytime.

### 2. ⚔️ Dual-Driver Comparison Mode
* **"⚔️ Compare" Button**: Click **`⚔️ Compare`** to instantly spawn a **Second Independent HUD** for Driver 2 (e.g. Verstappen vs. Norris).
* **Both Cars on One Track Map**: View both drivers battling simultaneously on the circuit to see the physical gap between them into braking zones.
* **Live Speed Delta**: Real-time comparison badge (**`Δ +14 KM/H`** / **`Δ -14 KM/H`**) showing who is carrying more speed through straights and corners.
* **Independent Dragging**: Move each driver's HUD anywhere on screen (e.g. Verstappen Top-Left, Norris Top-Right, or docked side-by-side).
* **One-Click Exit**: Click **`✕ Close`** on HUD 2 to return to single-driver mode.

### 3. 🏎️ Broadcast-Grade Telemetry HUD
* **Digital Speedometer**: Tabular `km/h` readout with racing typography.
* **Gear Indicator**: Current gear (`1`–`8`, `N`).
* **15-LED Shift Lights**: Realistic green $\rightarrow$ red $\rightarrow$ electric blue rev lights as the engine approaches redline.
* **Pedal Input Gauges**: Vertical glowing bars for **Throttle (0–100%)** and **Brake (0–100%)**.
* **DRS Badge**: Real-time DRS flap status (`DRS OFF`, `DRS AVAIL`, `DRS ACTIVE`).
* **Driver Selector**: Switch between any driver in the session lineup with dynamic team color stripes.

### 4. ⏱️ Event Countdown & Weekend Schedule
* **Next Event Auto-Detection**: Displays the next upcoming session (e.g. **United States GP - Practice 3**).
* **Local Timezone Conversion**: Automatically converts session start times to your local timezone (e.g. `Today at 11:00 PM`).
* **Live Ticking Countdown**: Displays remaining time down to the second (`STARTS IN: 05h 18m 42s` or `🔴 LIVE NOW`).
* **Expandable Weekend Timetable**: Accordion menu showing all 5 weekend sessions (Practice 1, 2, 3, Qualifying, Race) with completion status.

### 5. 🎛️ FanCode Stream Latency Sync Offset Slider
* Streaming services like FanCode typically run **20s to 45s behind** live track timing.
* Includes an **offset slider** (`-60s` to `+60s` with `-1s`/`+1s` precision buttons) so you can sync telemetry gear shifts and braking points with the video broadcast once per session.

### 6. 🖱️ Drag, Dock & Opacity Controls
* **Free Drag**: Grab any HUD header bar to drag it anywhere across the video player.
* **Corner Presets**: Quick-dock buttons for Top-Left (TL), Top-Center (TC), Top-Right (TR), Bottom-Left (BL), Bottom-Right (BR).
* **Opacity Slider**: Adjust transparency (30% to 100%) so track action is never blocked.
* **Minimize Mode**: Collapse into a compact header badge with one click.
* **Fullscreen Support**: Automatically attaches inside HTML5 player fullscreen containers.

---

## 🚀 Installation Guide

### Microsoft Edge
1. Open Edge and navigate to:
   ```
   edge://extensions
   ```
2. In the left sidebar, turn **Developer mode** toggle **ON**.
3. Click the **"Load unpacked"** button at the top.
4. Select the project folder:
   ```
   Desktop ➔ f1-telemetry-fancode
   ```
5. *(Recommended)* Click the **puzzle piece icon** in the Edge toolbar and click the **eye icon** next to "F1 Telemetry Overlay" to pin it to your toolbar.

### Google Chrome / Brave
1. Open Chrome or Brave and go to:
   ```
   chrome://extensions
   ```
2. Turn **Developer mode** toggle **ON** in the top-right corner.
3. Click **"Load unpacked"** in the top-left.
4. Select the `f1-telemetry-fancode` folder.

---

## 🧪 Testing Immediately (No Live Race Required)

You don't need to wait for a live race weekend to try the extension!

1. Open [`demo.html`](demo.html) directly in Microsoft Edge or Chrome:
   - Double-click `demo.html` in Finder, or click **"Launch Interactive Demo"** from the extension popup.
2. Experience:
   - The car dot gliding along the Circuit of the Americas track map above the telemetry.
   - Clicking **`⚔️ Compare`** to spawn HUD 2 and battle two cars side-by-side.
   - Live speed delta updates and shift LED animations.
   - Dragging both HUDs around the screen independently.

---

## 📺 How to Use on FanCode

1. Visit [FanCode](https://www.fancode.com) and start watching an F1 session.
2. The HUD overlay will automatically appear over the video player.
3. Select your primary driver (e.g. `1 VER`).
4. Click **`⚔️ Compare`** if you want to track a second driver (e.g. `4 NOR`).
5. **Sync with broadcast**:
   - When the car shifts gear or brakes into Turn 1 on the video stream, adjust the **Sync Offset** slider so the HUD changes at the exact same moment.

---

## 🛠️ Project Architecture

```
f1-telemetry-fancode/
├── manifest.json            # Manifest V3 configuration & host permissions
├── background.js            # Service worker proxy (bypasses CORS for OpenF1 API)
├── icons/                   # Extension icons (16px, 48px, 128px, SVG)
├── content/
│   ├── openf1.js            # OpenF1 client (sessions, schedule, telemetry, GPS location)
│   ├── hud.js               # Dual HUD controller, draggable engine, circuit map SVG
│   └── hud.css              # Broadcast aesthetics, shift lights, minimap & compare styling
├── popup/                   # Toolbar popup menu
│   ├── popup.html           # Event countdown, schedule accordion, dual-mode launcher
│   ├── popup.css
│   └── popup.js
├── demo.html                # Interactive testbench simulator
├── package.py               # One-click ZIP packager for Chrome & Edge Store releases
└── README.md
```

---

## 🏎️ OpenF1 Endpoints Used

* `GET https://api.openf1.org/v1/sessions?session_key=latest`
* `GET https://api.openf1.org/v1/sessions?meeting_key={meeting_key}`
* `GET https://api.openf1.org/v1/drivers?session_key={session_key}`
* `GET https://api.openf1.org/v1/car_data?session_key={session_key}&driver_number={driver_number}`
* `GET https://api.openf1.org/v1/location?session_key={session_key}&driver_number={driver_number}`
