// Markup and styles of the reference fitting dialog. The editor adds both to the page on first use.
export const style = `
#hfit-room {
  width: min(1240px, 97vw);
  max-height: 96dvh;
  overflow: hidden;
  border: 1px solid #8c9e92;
  border-radius: 8px;
  background: #f4f4ec;
  color: #263a32;
  padding: 16px;
}
#hfit-room[open] {
  display: flex;
  flex-direction: column;
}
#hfit-room::backdrop {
  background: #152a24a6;
}
#hfit-room h2 {
  margin: 0;
}
#hfit-room h3 {
  font: 650 0.86rem/1.2 "Segoe UI", sans-serif;
  margin: 0 0 6px;
}
.hfit-bar {
  display: flex;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
#hfit-room .hfit-bar .actions,
#hfit-room .hfit-bar .check,
#hfit-room .hfit-bar .field {
  margin: 0;
}
#hfit-room .hfit-bar .switch {
  min-width: min(100%, 330px);
}
#hfit-room .hfit-bar .field {
  display: flex;
  gap: 8px;
  align-items: center;
}
#hfit-room .hfit-bar select {
  width: auto;
  margin: 0;
}
.hfit-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 345px;
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  margin-top: 12px;
}
.hfit-view {
  display: grid;
  gap: 8px;
  align-content: start;
}
.hfit-panel {
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}
#hfit-stage {
  position: relative;
  height: clamp(280px, calc(96dvh - 224px), 760px);
  background: #dfe5df;
  border-radius: 4px;
  overflow: hidden;
  touch-action: none;
}
#hfit-stage.hfit-drop {
  outline: 3px dashed #2c5144;
  outline-offset: -6px;
}
#hfit-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
#hfit-wipe-line {
  position: absolute;
  inset: 0 auto 0 50%;
  border-left: 1px solid #33483d80;
  pointer-events: none;
}
#hfit-labels {
  position: absolute;
  inset: 8px 0 auto;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  text-align: center;
  font: 600 0.72rem "IBM Plex Mono", Consolas, monospace;
  color: #2d453c;
  pointer-events: none;
}
#hfit-labels span {
  padding: 0 8px;
}
#hfit-legend {
  position: absolute;
  left: 12px;
  bottom: 10px;
  width: min(330px, calc(100% - 24px));
  font: 0.68rem "IBM Plex Mono", Consolas, monospace;
  color: #2d453c;
  pointer-events: none;
}
#hfit-legend i {
  display: block;
  height: 9px;
  border: 1px solid #7d8f84;
  background: linear-gradient(to right, #2f6fb3, #e9e6dc, #c6452d);
}
#hfit-legend div {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
}
#hfit-empty {
  position: absolute;
  inset: auto 0 14px;
  margin: 0;
  padding: 0 16px;
  text-align: center;
  font-size: 0.84rem;
  color: #40584e;
  pointer-events: none;
}
.hfit-panel section {
  padding: 11px 0;
  border-bottom: 1px solid var(--line, #cdd2c8);
}
.hfit-panel section:first-child {
  padding-top: 0;
}
.hfit-panel section:last-child {
  border: 0;
}
#hfit-room .hfit-panel section > .field:first-of-type {
  margin-top: 0;
}
#hfit-room input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 6px 7px;
  font: inherit;
  background: #fbfbf5;
  color: #243f36;
  border: 1px solid #a6b6a5;
  border-radius: 5px;
}
#hfit-room input[type="range"] {
  accent-color: #426b56;
}
#hfit-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 10px;
  font-size: 0.76rem;
  line-height: 1.35;
  margin: 9px 0 4px;
}
#hfit-facts dt {
  font-weight: 650;
  color: #40584e;
}
#hfit-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
#hfit-room details {
  margin-top: 8px;
  font-size: 0.8rem;
}
#hfit-room summary {
  cursor: pointer;
  font-weight: 600;
}
.hfit-three {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
#hfit-steps {
  margin: 8px 0 0;
  padding-left: 1.3em;
  font-size: 0.76rem;
  line-height: 1.4;
}
#hfit-steps:empty {
  display: none;
}
#hfit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
}
#hfit-table th,
#hfit-table td {
  padding: 3px 4px;
  text-align: right;
  border-bottom: 1px solid #d9ddd2;
  font-weight: 450;
}
#hfit-table th:first-child {
  text-align: left;
}
#hfit-table thead th {
  font-weight: 650;
  color: #40584e;
}
#hfit-table tbody tr:first-child th,
#hfit-table tbody tr:first-child td {
  font-weight: 650;
}
#hfit-warnings {
  margin: 8px 0 0;
  padding-left: 1.2em;
  font-size: 0.76rem;
  line-height: 1.4;
  color: #84451a;
}
#hfit-warnings:empty {
  display: none;
}
#hfit-note {
  flex: 1 1 280px;
  min-height: 1.3em;
  margin: 0;
  font-size: 0.85rem;
}
.hfit-foot {
  margin-top: 12px;
}
@media (max-width: 880px) {
  .hfit-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    overflow: auto;
  }
  .hfit-panel {
    overflow: visible;
    padding-right: 0;
  }
  #hfit-stage {
    height: clamp(240px, 46vh, 420px);
  }
  #hfit-room {
    padding: 10px;
  }
}
`;

export const template = `
<dialog id="hfit-room" aria-labelledby="hfit-title">
  <div class="hfit-bar">
    <h2 id="hfit-title">Fit to a 3D reference</h2>
    <div class="actions"><button id="hfit-close">Close</button></div>
  </div>
  <div class="hfit-body">
    <div class="hfit-view">
      <div class="hfit-bar">
        <div class="switch" id="hfit-views" role="group" aria-label="Comparison view">
          <button data-view="side" aria-pressed="true">Side by side</button
          ><button data-view="wipe" aria-pressed="false">Wipe</button
          ><button data-view="overlay" aria-pressed="false">Overlay</button
          ><button data-view="deviation" aria-pressed="false">Deviation map</button>
        </div>
        <div class="actions" id="hfit-angles" role="group" aria-label="Camera direction">
          <button data-angle="0">Front</button
          ><button data-angle="0.62">Three-quarter</button
          ><button data-angle="1.5708">Side</button
          ><button data-angle="3.1416">Back</button>
        </div>
      </div>
      <div id="hfit-stage">
        <canvas id="hfit-canvas" aria-label="Reference model and editable human in matching views. Drag to orbit, scroll to zoom."></canvas>
        <div id="hfit-wipe-line" hidden></div>
        <div id="hfit-labels"></div>
        <div id="hfit-legend" hidden>
          <i></i>
          <div><span>20 mm inside</span><span>on the reference</span><span>20 mm outside</span></div>
        </div>
        <p id="hfit-empty">Choose a reference model, or drop a GLB file here.</p>
      </div>
      <div class="hfit-bar">
        <label class="field">Frame
          <select id="hfit-frame">
            <option value="whole">Whole body</option>
            <option value="head">Head</option>
            <option value="trunk">Trunk</option>
            <option value="arms">Arms</option>
            <option value="legs">Legs</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" id="hfit-original" />Show my original shape</label>
        <label class="field" id="hfit-wipe-field" hidden>Reference coverage
          <input type="range" id="hfit-wipe" min="0" max="100" value="50" />
        </label>
        <label class="field" id="hfit-opacity-field" hidden>Reference opacity
          <input type="range" id="hfit-opacity" min="15" max="100" value="60" />
        </label>
      </div>
    </div>
    <div class="hfit-panel">
      <section>
        <h3>Reference</h3>
        <label class="field">Reference contains
          <select id="hfit-kind"><option value="body">Standing body</option><option value="head">Isolated head or bust</option></select>
        </label>
        <label class="field">Model<select id="hfit-source"></select></label>
        <div class="actions"><button id="hfit-browse">Choose a GLB file…</button></div>
        <input type="file" id="hfit-file" accept=".glb,.gltf,model/gltf-binary" hidden />
        <p class="micro" id="hfit-licence">A file you choose stays in this browser session. It is not uploaded or saved with the character.</p>
        <div id="hfit-head-tools" hidden>
          <button id="hfit-landmarks">Match three landmarks</button>
          <p id="hfit-landmark-instruction" class="micro" aria-live="polite"></p>
        </div>
        <div id="hfit-mask-tools" hidden>
          <div class="actions"><button id="hfit-mask" aria-pressed="false">Hide parts that are not skin</button></div>
          <div id="hfit-mask-settings" hidden>
            <label class="field">A click hides
              <select id="hfit-mask-kind">
                <option value="patch">A patch around the click</option>
                <option value="above">Everything above the click</option>
                <option value="below">Everything below the click</option>
              </select>
            </label>
            <label class="field" id="hfit-mask-size-field">Patch radius <output id="hfit-mask-size-reading"></output>
              <input type="range" id="hfit-mask-size" min="5" max="60" step="5" value="15" />
            </label>
            <div class="actions"><button id="hfit-mask-undo">Undo hide</button><button id="hfit-mask-clear">Show everything</button></div>
          </div>
          <p class="micro" id="hfit-mask-reading" aria-live="polite"></p>
        </div>
        <dl id="hfit-facts"></dl>
        <details id="hfit-alignment">
          <summary>Alignment</summary>
          <label class="field">Source units
            <select id="hfit-units">
              <option value="auto">Detect from height</option>
              <option value="m">Metres</option>
              <option value="cm">Centimetres</option>
              <option value="mm">Millimetres</option>
              <option value="in">Inches</option>
              <option value="ft">Feet</option>
              <option value="stature">Unknown, scale to the template</option>
            </select>
          </label>
          <label class="field">Up axis
            <select id="hfit-up">
              <option value="auto">Detect</option>
              <option value="y">Y up</option>
              <option value="z">Z up</option>
            </select>
          </label>
          <label class="field">Turn to face front
            <select id="hfit-turn">
              <option value="auto">Detect from width and feet</option>
              <option value="0">No turn</option>
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </select>
          </label>
          <div class="hfit-three">
            <label class="field">Right, mm<input type="number" id="hfit-nudge-x" step="5" value="0" /></label>
            <label class="field">Up, mm<input type="number" id="hfit-nudge-y" step="5" value="0" /></label>
            <label class="field">Forward, mm<input type="number" id="hfit-nudge-z" step="5" value="0" /></label>
          </div>
          <label class="check"><input type="checkbox" id="hfit-match-stature" checked />Set my stature to the reference</label>
          <label class="check"><input type="checkbox" id="hfit-match-arms" checked />Rest my arms at the reference angle</label>
        </details>
      </section>
      <section>
        <h3>Fit</h3>
        <label class="field">Region
          <select id="hfit-region">
            <option value="whole">Whole body</option>
            <option value="head">Head</option>
            <option value="trunk">Trunk</option>
            <option value="arms">Arms</option>
            <option value="legs">Legs</option>
          </select>
        </label>
        <label class="check" id="hfit-measure-field"><input type="checkbox" id="hfit-measure" checked />Fit measurements first</label>
        <label class="check" id="hfit-contour-field"><input type="checkbox" id="hfit-contour" />Refine facial contours</label>
        <div id="hfit-eyes-field" hidden>
          <label class="check"><input type="checkbox" id="hfit-eyes" />Keep my eye openings</label>
          <p class="micro">Leaves the lids, the eye sliders and the eyeballs as they are. Use it when the scan's eyes are not lid skin: open eyes with an eyeball, sculpted or painted eyes, or lashes.</p>
        </div>
        <p class="micro">Measurements adjust the body and its attached joints. For a local surface edit, turn off measurements and both template adjustments under Alignment.</p>
        <div class="actions">
          <button id="hfit-run" class="solid">Fit shape</button
          ><button id="hfit-undo">Undo step</button
          ><button id="hfit-reset">Start over</button>
        </div>
        <div class="actions"><button id="hfit-feature" aria-pressed="false">Match a feature</button></div>
        <div id="hfit-feature-settings" hidden>
          <label class="field">Area around the click <output id="hfit-feature-size"></output>
            <input type="range" id="hfit-feature-reach" min="3" max="14" step="1" value="5" />
          </label>
          <label class="check"><input type="checkbox" id="hfit-feature-mirror" />Mirror left and right</label>
        </div>
        <p class="micro" id="hfit-feature-reading" aria-live="polite"></p>
        <div id="hfit-prop-slot"></div>
        <details id="hfit-family">
          <summary>Head from a mesh family</summary>
          <p class="micro">For a reference made from a template you also have: the neutral and the reference must share one vertex order. The neutral is fitted and registered once, then the head follows the reference vertex by vertex. It does not work on an unrelated scan and changes only the head. Fit the whole body to the reference first when build or weight differ much.</p>
          <div class="actions"><button id="hfit-family-browse">Choose the family's neutral GLB…</button></div>
          <input type="file" id="hfit-family-file" accept=".glb,.gltf,model/gltf-binary" hidden />
          <p class="micro" id="hfit-family-reading" aria-live="polite"></p>
          <label class="check"><input type="checkbox" id="hfit-family-measure" checked />Head measurements</label>
          <label class="check"><input type="checkbox" id="hfit-family-detail" checked />Fine head layer</label>
          <div class="actions">
            <button id="hfit-family-run">Transfer head</button
            ><button id="hfit-family-clear">Remove fine layer</button>
          </div>
        </details>
        <ol id="hfit-steps"></ol>
      </section>
      <section>
        <h3>Distance to the reference</h3>
        <table id="hfit-table">
          <thead>
            <tr><th scope="col">Mean / 95% in mm</th><th scope="col">Original</th><th scope="col">Now</th><th scope="col">Bias</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="micro">Measured from the editable skin to the nearest reference surface, in one direction. Bias is positive where the skin lies outside the reference.</p>
        <button id="hfit-view-score">Measure this camera view</button>
        <p class="micro" id="hfit-view-reading" aria-live="polite"></p>
        <ul id="hfit-warnings"></ul>
      </section>
    </div>
  </div>
  <div class="hfit-bar hfit-foot">
    <p id="hfit-note" role="status"></p>
    <div class="actions"><button id="hfit-apply" class="solid">Apply to character</button></div>
  </div>
</dialog>
`;
