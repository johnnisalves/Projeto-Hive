/**
 * Format specs — the single source of truth for canvas sizes.
 *
 * Before this module the codebase had two divergent maps: `ASPECT_MAP` in
 * nanobana.service.ts (which sized 4:5 as 864x1080) and `getSizeFromAspect` in
 * generate.routes.ts (which sized 4:5 as 1080x1350). Both are now derived from
 * here, so a requested format means one thing everywhere and every provider
 * receives it correctly.
 */

export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

export type FormatSpec = {
  width: number;
  height: number;
  ratio: AspectRatio;
  label: string;
  /** Fraction of the height that must stay clear of critical content. */
  safeTopPct?: number;
  safeBottomPct?: number;
};

/**
 * Named formats the UI can request. Aspect ratios remain accepted directly for
 * backward compatibility (the old API took only '1:1' | '4:5' | '9:16').
 */
export const FORMAT_SPECS: Record<string, FormatSpec> = {
  'ig-feed': { width: 1080, height: 1350, ratio: '4:5', label: 'Instagram portrait feed 1080x1350' },
  'ig-feed-square': { width: 1080, height: 1080, ratio: '1:1', label: 'Instagram square 1080x1080' },
  'ig-stories': { width: 1080, height: 1920, ratio: '9:16', label: 'Instagram Stories 1080x1920', safeTopPct: 0.14, safeBottomPct: 0.15 },
  'ig-reels': { width: 1080, height: 1920, ratio: '9:16', label: 'Reels 1080x1920', safeTopPct: 0.14, safeBottomPct: 0.15 },
  'fb-post': { width: 1080, height: 1350, ratio: '4:5', label: 'Facebook portrait 1080x1350' },
  'fb-square': { width: 1080, height: 1080, ratio: '1:1', label: 'Facebook square 1080x1080' },
  'li-post': { width: 1080, height: 1080, ratio: '1:1', label: 'LinkedIn square 1080x1080' },
  'li-portrait': { width: 1080, height: 1350, ratio: '4:5', label: 'LinkedIn portrait 1080x1350' },
  'yt-thumbnail': { width: 1280, height: 720, ratio: '16:9', label: 'YouTube thumbnail 1280x720' },
  'tw-post': { width: 1200, height: 675, ratio: '16:9', label: 'X/Twitter landscape 1200x675' },
  // Bare aspect ratios, for callers that only know the shape.
  '1:1': { width: 1080, height: 1080, ratio: '1:1', label: 'Square 1080x1080' },
  '4:5': { width: 1080, height: 1350, ratio: '4:5', label: 'Portrait 1080x1350' },
  '9:16': { width: 1080, height: 1920, ratio: '9:16', label: 'Vertical 1080x1920', safeTopPct: 0.14, safeBottomPct: 0.15 },
  '16:9': { width: 1280, height: 720, ratio: '16:9', label: 'Landscape 1280x720' },
};

const DEFAULT_KEY = '4:5';

export function getFormatSpec(format?: string | null): FormatSpec {
  if (!format) return FORMAT_SPECS[DEFAULT_KEY];
  return FORMAT_SPECS[format] || FORMAT_SPECS[DEFAULT_KEY];
}

export function safeAreaPx(spec: FormatSpec): { top?: number; bottom?: number } {
  return {
    top: spec.safeTopPct ? Math.round(spec.height * spec.safeTopPct) : undefined,
    bottom: spec.safeBottomPct ? Math.round(spec.height * spec.safeBottomPct) : undefined,
  };
}

export function aspectValue(spec: FormatSpec): number {
  return spec.width / spec.height;
}

// ── Provider mapping ─────────────────────────────────────────────────────────

/** Gemini image (native + via OpenRouter) accepts these through imageConfig. */
const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

/** Nearest supported ratio, so we never silently fall back to 1:1. */
function nearestRatio(spec: FormatSpec, supported: string[]): string {
  if (supported.includes(spec.ratio)) return spec.ratio;
  const target = aspectValue(spec);
  let best = supported[0];
  let bestDelta = Infinity;
  for (const candidate of supported) {
    const [w, h] = candidate.split(':').map(Number);
    const delta = Math.abs(w / h - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

export function geminiAspectRatio(spec: FormatSpec): string {
  return nearestRatio(spec, GEMINI_RATIOS);
}

/** OpenRouter passes the ratio through in the message; keep it native. */
export function openRouterAspectRatio(spec: FormatSpec): string {
  return nearestRatio(spec, GEMINI_RATIOS);
}

/** Hugging Face diffusion models need explicit pixels, multiples of 8. */
export function huggingFaceDimensions(spec: FormatSpec, maxSide = 1024): { width: number; height: number } {
  const target = aspectValue(spec);
  const round8 = (n: number) => Math.max(256, Math.round(n / 8) * 8);
  return target >= 1
    ? { width: round8(maxSide), height: round8(maxSide / target) }
    : { width: round8(maxSide * target), height: round8(maxSide) };
}
