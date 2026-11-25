import { ImageLoader } from "three";

export const artworkImages = new Map();
export const portraitImage = id => artworkImages.get(id);

export async function registerPortraitImage(id, url) {
  if (!artworkImages.has(id))
    artworkImages.set(id, await new ImageLoader().loadAsync(url));
}
