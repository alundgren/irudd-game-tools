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

<div class="actions"><button id="hfit-prop" aria-pressed="false">Match proportions</button></div>
<div id="hfit-prop-panel" hidden>
  <label class="field">Proportion to mark
    <select id="hfit-prop-pick"></select>
  </label>
  <p class="micro" id="hfit-prop-hint" aria-live="polite"></p>
  <table id="hfit-prop-list" hidden>
    <thead><tr><th>Marked</th><th>Reference</th><th>Yours</th><th>Apart</th><th></th></tr></thead>
    <tbody></tbody>
  </table>
  <div id="hfit-prop-choice" hidden>
    <p class="micro">Controls to move. Untick one to keep it as it is.</p>
    <div id="hfit-prop-controls"></div>
    <p class="micro" id="hfit-prop-kept"></p>
    <div class="actions"><button id="hfit-prop-fit" class="solid">Fit controls to the marks</button></div>
  </div>
</div>
<p class="micro" id="hfit-prop-reading" aria-live="polite"></p>

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
