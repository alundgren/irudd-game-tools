export interface HeadwearTexture {
  readonly width: number;
  readonly height: number;
  readonly flip: boolean;
  readonly wrapS?: number;
  readonly wrapT?: number;
  readonly repeat?: readonly [number, number];
  readonly data: string;
}
export interface HeadwearMesh {
  readonly morphs?: readonly { readonly name: string; readonly data: string }[];
  readonly name: string;
  readonly tone: string;
  readonly source: string;
  readonly double: boolean;
  readonly alpha: number;
  readonly rough: number;
  readonly metal: number;
  readonly transparent: boolean;
  readonly points: string;
  readonly normals: string;
  readonly uv: string;
  readonly colors: string;
  readonly indices: string;
  readonly map: HeadwearTexture | null;
  readonly bones?: string | null;
  readonly weights?: string | null;
  readonly bumpMap?: HeadwearTexture | null;
  readonly bumpScale?: number;
  readonly normalScale?: readonly [number, number];
  readonly roughMap?: HeadwearTexture | null;
  readonly metalMap?: HeadwearTexture | null;
  readonly occlusion?: HeadwearTexture | null;
  readonly normalMap: HeadwearTexture | null;
}
