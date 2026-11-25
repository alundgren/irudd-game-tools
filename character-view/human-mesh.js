import * as T from "three";
import { humanFace } from "./human-face.js";
import { castMeshes } from "./human-cast.js";
import { wornCast } from "./human-cast-looks.js";
import { studioHead, wearsStudioHead } from "./human-studio-head.js";
import { faceMaterial, skinMaterial } from "./human-complexion.js";
import { armInkBones, armInkChart, inkedSkin } from "./human-arm-ink.js";
import { skinShade } from "./human-skin-tone.js";
import { markFace } from "./human-face-marks.js";
import { stageMakeupFace } from "./human-makeup.js";
import { applyFacePlanes } from "./human-face-planes.js";
import { applyNativePortrait } from "./native-portrait.js";
import { portraitImage } from "./portrait-images.js";
import { faceAnatomyFields, facialMorphNormals, refineExpressions, refineFaceForm, shadeFaceForm } from "./human-face-anatomy.js";
import {
  evaluateHuman,
  smoothHumanSurface,
  expressionDisplacements,
} from "./human-surface.js";

function geometry(surface, corners, normals, origin, tinted, shade, joined, chart, paintedLips) {
  const here = new Map(),
    positions = [],
    normal = [],
    uv = [],
    colors = [],
    indices = [],
    boneIndices = [],
    weights = [],
    vertexIds = [],
    anchors = [];
  // Triangles crossing the inside-arm seam lie wholly in the blank margin.
  // Split only their chart coordinates so interpolation cannot mirror the design.
  let seam = false;
  const coordinates = chart ? new Map() : null;
  const inkUV = v => {
    if (!coordinates.has(v)) coordinates.set(v, chart(v));
    return coordinates.get(v);
  };
  for (let c = 0; c < corners.length; c++) {
    const corner = corners[c];
    if (chart && c % 3 === 0) {
      const a = inkUV(surface.indices[corner])[0];
      const b = inkUV(surface.indices[corners[c+1]])[0];
      const d = inkUV(surface.indices[corners[c+2]])[0];
      seam = Math.max(a,b,d) - Math.min(a,b,d) > .5;
    }
    const v = surface.indices[corner],
      tex = surface.uvFaces[corner],
      key = seam ? -1 - v * 65536 - tex : v * 65536 + tex;
    if (!here.has(key)) {
      here.set(key, positions.length / 3);
      vertexIds.push(v);
      anchors.push(joined?.[v] ?? 0);
      for (let d = 0; d < 3; d++) {
        positions.push(surface.positions[v * 3 + d] - origin[d]);
        normal.push(normals[v * 3 + d]);
      }
      if (chart) {
        const [u, h] = inkUV(v);
        uv.push(seam ? 0 : u, h);
      } else uv.push(surface.uv[tex * 2] / 65535, surface.uv[tex * 2 + 1] / 65535);
      if (tinted) {
        const [lipZone, lid, mouth, nail] = surface.pigments.subarray(
          tex * 4,
          tex * 4 + 4,
        );
        // The registered skin already carries the vermilion colour of its donor.
        const lip = lipZone * (paintedLips ? 0.22 : 1);
        const [r, g, b] = shade ? shade.subarray(v * 3, v * 3 + 3) : [1, 1, 1];
        colors.push(
          r * (1 - (0.48 * mouth) / 255) * (1 - (0.05 * lip) / 255),
          g * (1 - (0.32 * lip) / 255) *
            (1 - (0.68 * mouth) / 255) *
            (1 - (0.08 * lid) / 255),
          b * ((1 - (0.23 * lip) / 255) * (1 - (0.63 * mouth) / 255) +
            (0.06 * nail) / 255),
        );
      }
      for (let j = 0; j < 4; j++) {
        boneIndices.push(surface.boneIndices[v * 4 + j]);
        weights.push(surface.weights[v * 4 + j]);
      }
    }
    indices.push(here.get(key));
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(normal, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  if (tinted) g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  // The head and the body are reduced apart for a game. Both keep the points they share.
  if (joined) g.setAttribute("lodAnchor", new T.Uint8BufferAttribute(anchors, 1));
  g.setIndex(indices);
  return {
    geometry: g,
    vertexIds,
    humanWeights: { boneIndices, weights, names: surface.names },
  };
}

export function humanRegions(form, material, plain, styleMeshes) {
  const cage = evaluateHuman(form.human, form.humanFit, form.humanDetail),
    s = refineFaceForm(smoothHumanSurface(cage)),
    bins = s.names.map(() => []);
  const cast = wornCast(form);
  if (cast) return part => {
    const group = new T.Group();
    if (part.humanBone === "head") {
      const k = s.names.indexOf("head") * 3;
      group.add(...castMeshes(cast, s, s.joints.slice(k, k + 3), material, plain, form.humanStyle.castSkin ?? part.color, form.humanStyle, form.eyeColor));
    }
    return group;
  };
  const full = new T.BufferGeometry();
  full.setAttribute("position", new T.BufferAttribute(s.positions, 3));
  full.setIndex(new T.BufferAttribute(s.indices, 1));
  full.computeVertexNormals();
  const totals = new Float32Array(s.names.length);
  const styled = styleMeshes?.(cage) ?? [];
  const hidden = styled.hidden,
    skip = new Set();
  if (hidden?.size) {
    for (let j = 0; j < s.quadIds.length; j += 4)
      if ([0, 1, 2, 3].every((k) => hidden.has(cage.ids[s.quadIds[j + k]])))
        skip.add(j / 4);
  }
  for (let c = 0; c < s.bodyTriangles * 3; c += 3) {
    if (skip.has(s.parentFaces[c / 3])) continue;
    totals.fill(0);
    for (let i = 0; i < 3; i++) {
      const v = s.indices[c + i];
      for (let j = v * 4; j < v * 4 + 4; j++)
        totals[s.boneIndices[j]] += s.weights[j];
    }
    let best = 0;
    for (let i = 1; i < totals.length; i++)
      if (totals[i] > totals[best]) best = i;
    bins[best].push(c, c + 1, c + 2);
  }
  // Points on the cut between the head and the neck, which are separate meshes in a game file.
  const headBin = s.names.indexOf("head"), joined = new Uint8Array(s.positions.length / 3), onHead = new Uint8Array(joined.length);
  for (const c of bins[headBin] ?? []) onHead[s.indices[c]] = 1;
  bins.forEach((bin, k) => { if (k !== headBin) for (const c of bin) if (onHead[s.indices[c]]) joined[s.indices[c]] = 1; });
  // Pin the visible eyelid margin loops (opening, outer thickness bevel) and upper supratarsal
  // crease fold so 24K game decimation cannot flatten lid depth or reveal the eye during Blink.
  const { lidAnchors } = faceAnatomyFields();
  for (let v = 0; v < joined.length; v++) if (lidAnchors[v]) joined[v] = 1;
  const bodySkins = new Map(), inkedSkins = new Map(), shades = new Map();
  const inkBones = plain ? [] : armInkBones(form.humanStyle?.armInk);
  const inkCharts = new Map();
  const shadeOf = (colour) => {
    if (!shades.has(colour)) shades.set(colour, skinShade(s, full.attributes.normal.array, new T.Color(colour)));
    return shades.get(colour);
  };
  return (part) => {
    const k = s.names.indexOf(part.humanBone),
      group = new T.Group(),
      origin = s.joints.slice(k * 3, k * 3 + 3);
    if (part.humanBone === "head" && !part.nativePortrait && wearsStudioHead(form)) {
      const bodySkin = plain ? null : skinMaterial(material(part.color), form);
      for (const mesh of studioHead({ form, surface: s, corners: bins[k], normals: full.attributes.normal.array, origin, material, plain, colour: part.color, shade: plain ? null : shadeOf(part.color), roughness: bodySkin?.roughness, worn: styled.filter((m) => m.userData.styleRegion === "head") }))
        group.add(mesh);
      bodySkin?.dispose();
      return group;
    }
    if (bins[k].length) {
      const ink = inkBones.includes(part.humanBone);
      const chartKey = ink ? (part.humanBone.endsWith("_r") ? "r" : "l") : null;
      if (ink && !inkCharts.has(chartKey)) inkCharts.set(chartKey, armInkChart(s, part.humanBone, form.humanStyle.armInk));
      const base = material(part.color);
      let skin = base;
      if (!plain) {
        if (part.humanBone === "head") skin = markFace(stageMakeupFace(faceMaterial(base, form), form), form);
        else {
          if (!bodySkins.has(part.color)) bodySkins.set(part.color, skinMaterial(base, form));
          skin = bodySkins.get(part.color);
          if (ink) {
            const inkKey = `${part.color}|${chartKey}`;
            if (!inkedSkins.has(inkKey)) inkedSkins.set(inkKey, inkedSkin(skin, form.humanStyle.armInk, form.origin?.seed ?? 0));
            skin = inkedSkins.get(inkKey);
          }
        }
      }
      const piece = geometry(
        s,
        bins[k],
        full.attributes.normal.array,
        origin,
        !plain,
        plain ? null : shadeOf(part.color),
        joined,
        ink ? inkCharts.get(chartKey) : null,
        Boolean(skin.userData?.paintedLips),
      );
      if (part.humanBone === "head" && form.humanStyle?.facePlanes && form.humanStyle.facePlanes !== "None") {
        applyFacePlanes(piece.geometry, cage, origin, form.humanStyle.facePlanes, !plain);
      }
      if (part.humanBone === "head" && !plain) shadeFaceForm(piece.geometry, piece.vertexIds);
      const mesh = new T.Mesh(piece.geometry, skin);
      mesh.humanWeights = piece.humanWeights;
      // Anatomical skin, for the sculpt brush: smooth-surface corners and vertices, rest origin.
      mesh.humanSkin = { faces: bins[k], vertices: piece.vertexIds, origin };
      if (!plain) skin.vertexColors = true;
      if (part.humanBone === "head") {
        const g = piece.geometry;
        g.morphTargetsRelative = true;
        g.morphAttributes.position = ["Blink", "Smile", "BrowLift"].map(
          (name) => {
            const deltas = expressionDisplacements(name, true, cage),
              values = new Float32Array(piece.vertexIds.length * 3);
            for (const [i, v] of piece.vertexIds.entries())
              for (let d = 0; d < 3; d++)
                values[i * 3 + d] = (deltas[v * 3 + d] * s.height) / 1.72;
            const attr = new T.BufferAttribute(values, 3);
            attr.name = name;
            return attr;
          },
        );
        refineExpressions(g, piece.vertexIds, s.height / 1.72);
        facialMorphNormals(g, piece.vertexIds);
        mesh.updateMorphTargets();
        mesh.userData.faceSurface = true;
        mesh.userData.fittedEyes = true;
      }
      mesh.castShadow = true;
      group.add(mesh);
    }
    if (part.humanBone === "head") {
      const positions = cage.positions.slice();
      positions.set(s.positions.subarray(0, cage.bodyVertices * 3));
      humanFace(group, { ...cage, positions }, origin, material, plain, form);
      if (!plain && part.nativePortrait)
        applyNativePortrait(group.children.find(mesh => mesh.userData.faceSurface), portraitImage(part.nativePortrait));
    }
    for (const source of styled.filter(
      (m) => m.userData.styleRegion === part.humanBone,
    )) {
      const mesh = source.clone();
      mesh.geometry = source.geometry.clone();
      mesh.geometry.translate(-origin[0], -origin[1], -origin[2]);
      if (source.humanWeights)
        mesh.humanWeights = { ...source.humanWeights, names: s.names };
      group.add(mesh);
    }
    return group;
  };
}

// Resolve source joint names in this branch, including duplicated arms or legs.
export function humanBinding(owner, regions, index, names) {
  function path(region) {
    const chain = [];
    while (region) {
      chain.push(region.part.id);
      region = regions.get(region.part.parent);
    }
    return chain.reverse();
  }
  const a = path(owner);
  const closest = new Map();
  for (const region of regions.values()) {
    if (!region.part.humanBone) continue;
    const b = path(region);
    let prefix = 0;
    while (prefix < a.length && a[prefix] === b[prefix]) prefix++;
    const distance = a.length + b.length - 2 * prefix;
    const prev = closest.get(region.part.humanBone);
    if (!prev || prev.distance > distance)
      closest.set(region.part.humanBone, {
        distance,
        bone: index.get(region.bones[0]),
      });
  }
  return names.map(
    (name) => closest.get(name)?.bone ?? index.get(owner.bones[0]),
  );
}
