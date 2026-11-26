// Run Three's GLTFExporter under Node for geometry-only presets.
//
// The exporter reads its packed buffers through the browser's FileReader. Node
// has Blob but no FileReader, so this verification-only module provides the
// two read methods the exporter calls. Textured presets need a canvas and run
// in the browser instead.

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,` + Buffer.from(buffer).toString("base64");
      this.onloadend?.();
    });
  }
}

export function installNodeExporter(): void {
  if (!("FileReader" in globalThis))
    Object.defineProperty(globalThis, "FileReader", { value: NodeFileReader, configurable: true });
}
