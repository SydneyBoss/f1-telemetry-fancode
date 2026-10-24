# F1 Car Telemetry Overlay for FanCode 🏎️💨

A modern Manifest V3 browser extension that brings **real-time Formula 1 car telemetry** directly onto your **FanCode** video player.

Powered by the **OpenF1 API**, this extension renders an authentic F1 broadcast-style floating HUD featuring digital speedometer, gear indicator, 15-LED RPM shift lights, live throttle/brake gauges, DRS activation badge, and team-colored driver badging.

---

## 🌟 Key Features

1. **Broadcast-Grade F1 HUD**:
   - **Speedometer**: Digital km/h display with high-contrast racing typography.
   - **Gear Indicator**: Current gear (1–8, N).
   - **15-LED RPM Shift Lights**: Green $\rightarrow$ Red $\rightarrow$ Electric Blue rev counter lights.
   - **Pedal Inputs**: Vertical glowing bars for Throttle (0–100%) and Brake (0–100%).
   - **DRS Status**: Real-time DRS badge (`DRS OFF`, `DRS AVAIL`, `DRS ACTIVE`).

2. **Driver Switcher & Team Styling**:
   - Click the driver badge to open the session lineup.
   - Automatically adopts official team colors (McLaren Papaya, Ferrari Red, Red Bull Blue, Mercedes Cyan, etc.).
   - Displays driver numbers and 3-letter acronyms (e.g. `1 VER`, `4 NOR`, `16 LEC`, `44 HAM`).

3. **Draggable & Dockable Screen Positioning**:
   - **Free Drag**: Grab the top header and drag the HUD anywhere on screen.
   - **Snap Presets**: 1-click snap to **Top-Left (TL)**, **Top-Center (TC)**, **Top-Right (TR)**, **Bottom-Left (BL)**, or **Bottom-Right (BR)**.
   - **Opacity Slider**: Control transparency (30% to 100%) so track action is never blocked.
   - **Minimize Mode**: Collapse into a mini pill with one click.

4. **Stream Latency Sync Offset Slider (Crucial for FanCode)**:
   - Streaming services like FanCode typically have a 20s–45s broadcast delay behind live track timing.
   - The HUD includes an **offset slider** (`-60s` to `+60s` with `-1s`/`+1s` precision buttons) so you can easily sync telemetry with the video broadcast once per session.

5. **Fullscreen Video Support**:
   - Seamlessly moves with the player container when entering or exiting full-screen mode.

6. **Offline / Demo Lap Mode**:
   - Built-in hot lap simulation engine so you can test and enjoy the HUD anytime, even during off-race hours.

---

## 🚀 Quick Start / How to Install

### Step 1: Open Chrome / Edge Extension Manager
1. Open Google Chrome, Brave, or Microsoft Edge.
2. In the address bar, navigate to:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** (toggle switch in the top-right corner).

### Step 2: Load Unpacked Extension
1. Click the **"Load unpacked"** button in the top-left.
2. Select this project folder:
   ```
   /Users/kasinathreddy/Desktop/f1 car telemetry
   ```
3. The extension **"F1 Telemetry Overlay for FanCode"** will now appear in your browser toolbar!

---

## 🧪 Testing Immediately (No Race Required)

You don't need to wait for a live race weekend to try it out!

1. Simply open [`demo.html`](demo.html) directly in your browser:
   - Double-click `demo.html` in Finder, or open it in Chrome (`file:///Users/kasinathreddy/Desktop/f1 car telemetry/demo.html`).
2. You will see a simulated FanCode player with an onboard track view.
3. Test:
   - Dragging the HUD around the screen.
   - Clicking on the driver badge to switch drivers.
   - Clicking the ⚙ (Gear) icon to adjust the sync slider or opacity.
   - Clicking Fullscreen (`⛶ Fullscreen`).
   - Clicking **"Simulate Turn 1 Braking"** or **"Simulate Main Straight DRS"**.

---

## 📺 Using on FanCode During a Race

1. Go to [FanCode](https://www.fancode.com) and start watching an F1 session (Practice, Qualifying, Sprint, or Race).
2. The telemetry HUD will automatically appear over the video player.
3. Select your driver of interest from the dropdown.
4. **Syncing the stream**:
   - Notice when the car on video shifts gear or brakes into Turn 1.
   - If the HUD changes gear *before* the video, bump the offset slider (e.g. `+25s`) until the gear changes match the car's engine sound and visuals.

---

## 🛠️ Project Structure

```
f1-car-telemetry/
├── manifest.json            # Manifest V3 configuration & permissions
├── background.js            # Background service worker (OpenF1 API proxy & CORS handling)
├── icons/                   # Extension icons (16, 48, 128px + SVG)
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg
├── content/
│   ├── openf1.js            # OpenF1 client (sessions, drivers, car data)
│   ├── hud.js               # HUD controller, draggable engine, interpolation & sync
│   └── hud.css              # Broadcast aesthetics, rev shift lights & gauges
├── popup/                   # Toolbar popup menu
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── demo.html                # Interactive testbench simulator
└── README.md
```

---

## 🏎️ OpenF1 Endpoints Used

- `GET https://api.openf1.org/v1/sessions?session_key=latest`
- `GET https://api.openf1.org/v1/drivers?session_key={session_key}`
- `GET https://api.openf1.org/v1/car_data?session_key={session_key}&driver_number={driver_number}&date>={timestamp}`
