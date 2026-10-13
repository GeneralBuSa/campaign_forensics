const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

export function isImagePath(url: string): boolean {
  return IMAGE_EXT.test(url);
}

export function isVideoPath(url: string): boolean {
  return VIDEO_EXT.test(url);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
