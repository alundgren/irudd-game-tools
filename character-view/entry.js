import template from "../examples/rig-study.html";
import { mhrFit, rigs } from "../examples/local-references.js";

const installed = Boolean(mhrFit) && rigs.includes("mhr-rest");
if (!installed)
  document.querySelector('a[href="#compare-mhr"]')?.closest("p")?.remove();
const comparison = () => installed && location.hash === "#compare-mhr";
const openedComparison = comparison();
window.addEventListener("hashchange", () => {
  if (comparison() !== openedComparison) location.reload();
});
if (openedComparison && location.protocol === "file:") {
  location.replace(new URL("rig-study.html", location.href));
} else if (openedComparison) {
  const doc = new DOMParser().parseFromString(template, "text/html");
  document.title = doc.title;
  document.head.querySelectorAll("style").forEach((style) => style.remove());
  document.head.append(doc.querySelector("style"));
  document.body.replaceChildren(...Array.from(doc.body.childNodes));
  import("../examples/rig-study.js").then(({ startRigStudy }) =>
    startRigStudy("/examples/mhr-reference.glb"),
  );
} else {
  import("./app.js");
}
