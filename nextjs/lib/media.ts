/** A cached, display-sized copy of a catalogue photograph. */
export function mediaPreviewUrl(url: string, width: 160 | 320 | 960): string {
  if (!url.startsWith("/media/")) return url;
  return `/thumb/${url.slice("/media/".length)}?w=${width}`;
}
