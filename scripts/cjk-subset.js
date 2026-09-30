// ABOUTME: Pure GB2312 → Unicode subset collector used to subset LXGW WenKai Lite.
// ABOUTME: Scans the GB2312 two-byte space and keeps Hanzi + CJK punctuation/fullwidth.

/**
 * Collect the characters to retain when subsetting a font to GB2312.
 *
 * Iterates the GB2312 two-byte encoding space (lead byte 0xA1–0xF7, trail byte
 * 0xA1–0xFE), decodes each pair with TextDecoder('gb2312'), and keeps every
 * character whose code point falls in the CJK Symbols and Punctuation
 * (U+3000–303F), CJK Unified Ideographs (U+4E00–9FFF), or Halfwidth and
 * Fullwidth Forms (U+FF00–FFEF) block.
 *
 * @returns {string} De-duplicated subset text — 6881 characters
 *   (6763 Hanzi + 118 CJK punctuation/fullwidth symbols). ASCII is excluded so
 *   Latin always renders in the system font.
 */
function collectGb2312SubsetChars() {
  const decoder = new TextDecoder("gb2312", { fatal: false });
  const pair = Buffer.alloc(2);
  const kept = new Set();

  for (let lead = 0xa1; lead <= 0xf7; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      pair[0] = lead;
      pair[1] = trail;
      const decoded = decoder.decode(pair);
      if (!decoded || decoded === "\uFFFD") continue;
      for (const ch of decoded) {
        const cp = ch.codePointAt(0);
        if (
          (cp >= 0x3000 && cp <= 0x303f) ||
          (cp >= 0x4e00 && cp <= 0x9fff) ||
          (cp >= 0xff00 && cp <= 0xffef)
        ) {
          kept.add(ch);
        }
      }
    }
  }

  return [...kept].join("");
}

module.exports = { collectGb2312SubsetChars };
