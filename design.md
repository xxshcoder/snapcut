# Snapcut: Video Editor UI Build Spec

Build a dark-themed, desktop video editor UI called **Snapcut** as a single-page web app. It is a static, high-fidelity recreation of the screen, with light interactivity where noted.

## Suggested stack
React + Vite + TypeScript, Tailwind CSS (or CSS modules), lucide-react or inline SVG for icons. No backend. Use a sample sunset video or image as the preview background (`<video>` or `<img>` with `object-fit: cover`).

## Design tokens
| Token | Value |
|---|---|
| Page background | Diagonal gradient `#1b2a40` → `#2f4a66` (slate blue) |
| App window bg | `#0e1124` (very dark navy), radius 40px, soft large drop shadow |
| Panel / surface | `#161a33` |
| Input / chip surface | `#1d2240` |
| Divider | `rgba(255,255,255,0.08)` |
| Primary blue | `#1f6bff` |
| Text primary | `#ffffff` |
| Text muted | `#8a90b0` |
| Clip red | `#ff5c50` |
| Clip green | `#4dff7c` |
| Swatches | white `#ffffff`, yellow `#ffe27a`, orange `#ff6b35` |
| Font (UI) | Inter / Poppins, 500 weight, 14–18px |
| Font (overlay text) | Haettenschweiler (fallback: Anton, Impact), uppercase condensed |
| Radii | window 40px, panels 28–32px, inputs/chips 16–20px, buttons fully round |

## Overall layout (CSS grid)
The app window is centered with about 60px margin around it. Aspect is roughly 4:3 (≈2100×1360 inside a 2212×1659 canvas).

```
┌───────────────────────────── Top bar ─────────────────────────────┐
│ Logo+name      [ Video-footage ]                  ⚙   [ Export ]  │
├───────────────────────────────────────┬───────────────────────────┤
│ Preview (video + overlays + toolbar)  │ Properties panel          │
│ + playback bar                        │ (tabs, size, position,    │
│                                       │  rotation, cover image,   │
├───────────────────────────────────────┤  effect settings)         │
│ Timeline (ruler, tracks, playhead)    │                           │
└───────────────────────────────────────┴───────────────────────────┘
```
- Columns: `1fr` (left, ~75%) and `~460px` (right panel).
- Rows: top bar (~90px), preview (~860px), timeline (rest).
- The right panel spans the preview and timeline rows.

## 1. Top bar
- **Left:** logo mark (blue stylized mark; the reference shows a "V"-like shape, so use a simple blue "S" or scissor-style placeholder for Snapcut), followed by the wordmark "Snapcut" in a white script/handwritten font.
- **Center:** a project title field, ~500px wide, 40px tall, 1px `#3a4060` border, radius 8px, transparent bg, centered white text "Video-footage".
- **Right:** a gear/settings icon button (outlined, white), then the **Export** button. It is blue `#1f6bff`, pill-shaped, ~215×64px, with a cloud-with-up-arrow icon on the left and bold, letter-spaced white text "Export".

## 2. Preview area (left, top)
Rounded container (radius ~32px) with `overflow: hidden`.
- **Background media:** photo of a woman in a long dress silhouetted against an orange/blue dusk sky, holding up a glowing white moon-like globe, with sea and pebble beach below.
- **Floating vertical toolbar** (right edge, inset ~16px from the edge). It is a tall translucent dark rounded pill (~100px wide) containing 8 stacked outline icon buttons, ~84px apart, white strokes:
  1. layers / captions
  2. cut / sticker
  3. effects (cookie/bitten circle)
  4. **Text "I" tool, ACTIVE:** white 3px outline, radius 20px, filled slightly lighter
  5. pen / pencil
  6. brush / paint
  7. sliders / adjustments
  8. crop / frame
- **Text overlay** (selected state), positioned top-left of the video (~x 130, y 460):
  - Giant white bold condensed text "Sa" (~170px, Haettenschweiler) with a thin white text caret `|` after it.
  - Behind it, a semi-transparent rounded rectangle (`rgba(255,255,255,0.15)`, radius 24px, ~520×220px).
  - Selection frame: thin 2px white lines on the top and left/right edges, with small white square handles at the corners (top-left, bottom-right) and a resize/expand icon at the bottom-left.
  - **Delete button:** a dark navy circle (~76px) at the top-right of the frame with a white trash icon.
  - **Text style bar** under the frame, in one row: expand icon, small dash, a font dropdown "Haettenschweiler ⌄" (bold white), a thin line, three color swatch circles (white one selected with a thick white ring and grey inner ring; yellow; orange), an eyedropper icon, and a dash ending in a small white square handle.
- **Playback bar** (pinned to the bottom of the preview, dark translucent rounded strip, ~110px tall) with two groups:
  - Left group: "back 15" circular-arrow icon, a large blue circular **Play** button (~76px, white outlined triangle), a "forward 15" icon, and a speed label "1.2 X" (small, muted).
  - Right group: a scrubber made of ~28 evenly spaced tick positions. Played positions (first 11) show a tall blue vertical tick above a blue dot; the current one is a white-ringed dot; the unplayed ones are small grey dots. Time readout top-right: "00:11 / 12:31".

## 3. Timeline (left, bottom)
Container bg `#0e1124`/`#161a33`, radius 30px.
- **Ruler** above the tracks: labels "00:00s, 00:05, 00:10, 00:15, 00:20, 00:25" in muted grey, evenly spaced (~220px per 5s). The 00:10 label is hidden behind the playhead pill.
- **Playhead:** a 2px white vertical line from the ruler through all tracks, located at 00:11. At the top is a white rounded "tag" pill with black bold text "00:11".
- **Left label column** (~300px wide, with a vertical divider on the right):
  - Row 1: ▸ "Sunset.jpg"
  - Row 2 (expanded, highlighted `#1d2240`, radius 20px): ▾ "Text" (larger, bold)
    - Sub-row: ▸ "font- size" with a pale-blue badge "24pt" (bg `#b9c4ff`, text `#3b4bd6`)
    - Sub-row: ▸ "Add property"
  - Row 3: ▸ "Roll.mp3"
- **Track area:**
  - **Image clip:** coral-red `#ff5c50` pill, from x≈00:00 to ≈00:12, height ~56px, label "Image" in dark text. At the left is a white square "−" trim handle. At the right are `>>>` chevrons and a white-outlined circle "+" handle.
  - **Text clip:** neon green `#4dff7c` pill starting at the playhead (~00:11) and ending ≈00:17, label "Sa|" in dark text, with a white "−" handle on the left, `>>>` chevrons and a "+" circle handle on the right. It sits on the row below the image clip.
  - **Audio track (Roll.mp3):** a full-width waveform of white vertical bars of varying height (rounded), on a slightly lighter dark strip, with a white "−" trim handle at the left.

## 4. Properties panel (right)
Surface `#161a33`, radius 32px, padding ~32px.
- **Tab header:** two tabs, "Properties" (white, bold, with a short white underline) and "Info" (muted). The header bar has a slightly darker bg.
- **Size:** label "Size" (bold). A horizontal slider (blue filled track to the left of the thumb, grey remainder, white round thumb at ~60%). Right of it, a value chip "128 Px" (`#1d2240`, radius 20px). A yellow cursor/pointer graphic sits just below the thumb (decorative).
- **Position:** label "Position". Three inline numeric fields: `X [100]`, `Y [0]`, `Z [180]`. Axis letters are muted; inputs are dark rounded chips, 100–140px wide, with separators between groups.
- **Rotation:** label "Rotation". Three underlined numeric inputs, all "0". To the right, a **3D axis gizmo:** vertical axis (blue, Z label on top in a blue circle), horizontal axis (red, X label in a red circle on the left, a darker red dot on the right), and a green center circle labeled "Y". Dark-blue dot at the bottom.
- **Checkbox:** a checked blue-outlined rounded square plus the label "Cover Image".
- **Drop zone:** dashed 2px border (`#4a5078`), radius 40px, ~830×600px, with a centered download-tray icon and the text "Drag Image or **Browse**" ("Browse" is brighter/white).
- **Divider line** (1px).
- **Effect Settings** (heading, bold, larger):
  - "Stroke" label, slider with thumb at far left (grey track), value chip "0".
  - "BG blur" label, slider with blue fill up to ~75% and a white thumb, value chip "24".

## Interactions (nice to have)
- Play/pause toggles the video; the scrubber ticks and the playhead advance with time.
- Dragging the Size slider updates the "128 Px" chip and the overlay text size.
- Clicking the text tool, swatches or font dropdown updates the overlay style.
- Dragging clip edges (the − and + handles) resizes the clips.
- Position and rotation inputs are controlled numbers.
- The trash button removes the text overlay.

## Component tree
```
<App>
  <TopBar>  <Logo/> <ProjectTitle/> <SettingsButton/> <ExportButton/>
  <PreviewPane>
    <VideoSurface/>
    <ToolRail tools=[...8] activeTool="text"/>
    <TextOverlay>  <SelectionFrame/> <DeleteButton/> <TextStyleBar/>
    <PlaybackBar>  <Transport/> <TickScrubber/> <TimeReadout/>
  <Timeline>
    <Ruler/> <Playhead time="00:11"/>
    <TrackLabels/> <TrackLanes> <Clip color=red/> <Clip color=green/> <Waveform/>
  <PropertiesPanel>
    <Tabs/> <SizeSlider/> <PositionInputs/> <RotationInputs + AxisGizmo/>
    <CoverImageCheckbox/> <DropZone/> <EffectSettings/>
```

Keep spacing generous, use consistent rounded corners, and keep all text on the dark surfaces white or muted grey as above.
