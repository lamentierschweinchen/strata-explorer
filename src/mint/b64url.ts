/**
 * URL-safe base64 of a UTF-8 string — byte-for-byte identical to the encoder in
 * `src/audio/StudioDesk.ts`, so a `#p=<b64url>` link this module builds opens the real studio's
 * shared-preset reader. Reimplemented here (rather than imported) to keep the mint chunk free of
 * the 1000-line desk UI. Dependency-free; runs in the browser.
 */
export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
