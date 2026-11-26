// Which GPU path a renderer runs on, so results can say when they come from a software fallback.

import type * as T from "three";

export interface GpuInfo {
  readonly vendor: string;
  readonly renderer: string;
  readonly webgl: string;
  /** True when the context runs on a software rasteriser (SwiftShader, llvmpipe, WARP). */
  readonly software: boolean;
}

const softwareRenderers = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|warp/i;

export function gpuInfo(renderer: T.WebGLRenderer): GpuInfo {
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const read = (unmasked: number | undefined, masked: number): string => {
    const value: unknown = gl.getParameter(unmasked ?? masked);
    return typeof value === "string" ? value : "";
  };
  const vendor = read(debug?.UNMASKED_VENDOR_WEBGL, gl.VENDOR);
  const name = read(debug?.UNMASKED_RENDERER_WEBGL, gl.RENDERER);
  const version: unknown = gl.getParameter(gl.VERSION);
  return {
    vendor,
    renderer: name,
    webgl: typeof version === "string" ? version : "",
    software: softwareRenderers.test(name),
  };
}
