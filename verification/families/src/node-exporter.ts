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
