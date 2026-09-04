/**
 * Stamps the official logo file onto a finished image.
 *
 * Image models redraw logos from references and never get them pixel-perfect
 * (thin outlines, lost lettering, wrong weights). So the model is told to leave
 * the area clean and this module composites the real PNG with sharp.
 *
 * Light backgrounds swallow light lettering (Essenza's "PIZZARIA" is white),
 * so the region under the logo is measured and, when it is bright, the logo is
 * placed on a rounded plate in the brand's darkest colour — the badge
 * treatment a designer would reach for.
 */

import sharp from 'sharp';
import { safeAreaPx, type FormatSpec } from './format-spec';
import type { LogoPlacement } from './creative-engine';

export type LogoCompositeOptions = {
  logoUrl: string;
  placement: LogoPlacement;
  /** Brand colours to pick the plate from (darkest wins). */
  plateCandidates?: Array<string | null | undefined>;
};

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function luminanceOfHex(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Darkest valid brand colour that is actually dark; otherwise a neutral slate. */
export function pickPlateColor(candidates: Array<string | null | undefined> = []): string {
  const valid = candidates.filter((c): c is string => !!c && HEX.test(c));
  valid.sort((a, b) => luminanceOfHex(a) - luminanceOfHex(b));
  const darkest = valid[0];
  return darkest && luminanceOfHex(darkest) < 0.4 ? darkest : '#1F2937';
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`logo download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

const LOGO_POSITION_ORDER: LogoPlacement['position'][] = ['top-center', 'bottom-center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

type Region = { left: number; top: number; width: number; height: number };

/**
 * Mean luminance and visual "busyness" of one region.
 *
 * sharp's `stats()` reads the INPUT image, not the pipeline — `extract().stats()`
 * silently measures the whole canvas. So the crop is materialised as raw pixels
 * and the numbers are computed here.
 */
async function regionMetrics(base: Buffer, region: Region): Promise<{ luminance: number; busy: number }> {
  const { data, info } = await sharp(base).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const px = info.width * info.height;
  if (!px) return { luminance: 0.5, busy: 0 };
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  for (let i = 0; i < data.length; i += ch) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      sum[c] += v;
      sumSq[c] += v * v;
    }
  }
  const mean = sum.map((t) => t / px);
  const stdev = sumSq.map((t, c) => Math.sqrt(Math.max(0, t / px - mean[c] * mean[c])));
  return {
    luminance: (0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]) / 255,
    busy: (stdev[0] + stdev[1] + stdev[2]) / 3 / 255,
  };
}

export type CompositeResult = {
  buffer: Buffer; plate: boolean; luminance: number; x: number; y: number; width: number; height: number;
  /** Where it actually landed, and how cluttered that area was. */
  position: LogoPlacement['position']; busy: number; relocated: boolean;
};

/** Pure variant: takes the logo bytes, so it can be tested without a network. */
export async function compositeLogoBuffer(
  base: Buffer,
  spec: FormatSpec,
  logoRaw: Buffer,
  placement: LogoPlacement,
  plateColor: string,
): Promise<CompositeResult> {
  // Trim transparent padding so widthRatio measures the mark itself.
  const trimmed = await sharp(logoRaw).ensureAlpha().trim({ threshold: 10 }).png().toBuffer();
  const targetW = Math.round(spec.width * placement.widthRatio);
  const logoBuf = await sharp(trimmed).resize({ width: targetW }).png().toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const lw = meta.width ?? targetW;
  const lh = meta.height ?? Math.round(targetW * 0.7);

  const margin = Math.round(spec.width * 0.045);
  const safe = safeAreaPx(spec);
  const topLimit = Math.max(margin, safe.top ?? 0);
  const bottomLimit = spec.height - Math.max(margin, safe.bottom ?? 0);
  const pad = Math.round(lw * 0.1);

  const boxFor = (pos: LogoPlacement['position']) => {
    const x = clamp(pos.endsWith('left') ? margin : pos.endsWith('right') ? spec.width - lw - margin : Math.round((spec.width - lw) / 2), 0, spec.width - lw);
    const y = clamp(pos.startsWith('top') ? topLimit : bottomLimit - lh, 0, spec.height - lh);
    const left = clamp(x - pad, 0, spec.width - 1);
    const top = clamp(y - pad, 0, spec.height - 1);
    return { x, y, region: { left, top, width: clamp(lw + 2 * pad, 1, spec.width - left), height: clamp(lh + 2 * pad, 1, spec.height - top) } };
  };

  // "Busy" = high pixel variance: drawn logos, text and hard edges all raise it.
  // A calm sky or gradient sits near zero, so the stamp never lands on a
  // headline or on a logo the model drew despite being told not to.
  const busyness = async (region: Region) => (await regionMetrics(base, region)).busy;

  // Candidates: three horizontal alignments swept vertically through the band
  // the plan asked for (and the opposite band as a fallback). Six fixed corners
  // are not enough — when the model writes a headline across the whole top, the
  // only clean slot may be a few hundred pixels lower.
  const wantsTop = placement.position.startsWith('top');
  const xFor = (align: 'left' | 'center' | 'right') =>
    clamp(align === 'left' ? margin : align === 'right' ? spec.width - lw - margin : Math.round((spec.width - lw) / 2), 0, spec.width - lw);

  const bandFor = (top: boolean) => (top
    ? { from: topLimit, to: Math.max(topLimit, Math.round(spec.height * 0.34) - lh) }
    : { from: Math.min(bottomLimit - lh, Math.round(spec.height * 0.66)), to: bottomLimit - lh });

  const alignOf = (pos: LogoPlacement['position']): 'left' | 'center' | 'right' =>
    pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center';

  const regionAt = (x: number, y: number): Region => {
    const left = clamp(x - pad, 0, spec.width - 1);
    const top = clamp(y - pad, 0, spec.height - 1);
    return { left, top, width: clamp(lw + 2 * pad, 1, spec.width - left), height: clamp(lh + 2 * pad, 1, spec.height - top) };
  };

  type Candidate = { x: number; y: number; region: Region; busy: number; align: 'left' | 'center' | 'right'; top: boolean; preferred: boolean };
  const candidates: Candidate[] = [];
  const STEPS = 5;
  for (const top of [wantsTop, !wantsTop]) {
    const band = bandFor(top);
    for (const align of ['center', 'left', 'right'] as const) {
      for (let i = 0; i < STEPS; i++) {
        const y = clamp(Math.round(band.from + ((band.to - band.from) * i) / (STEPS - 1)), 0, spec.height - lh);
        const x = xFor(align);
        const region = regionAt(x, y);
        candidates.push({
          x, y, region, busy: await busyness(region), align, top,
          preferred: top === wantsTop && align === alignOf(placement.position),
        });
      }
    }
  }

  const BUSY_LIMIT = 0.10;
  // Prefer the planned spot when it is genuinely clean; otherwise take the
  // calmest slot found, with a small bias toward the planned band/alignment.
  const score = (c: Candidate) => c.busy - (c.preferred ? 0.02 : 0) - (c.top === wantsTop ? 0.01 : 0);
  candidates.sort((a, b) => score(a) - score(b));
  const best = candidates[0];
  const plannedCandidate = candidates.find((c) => c.preferred && c.y === clamp(bandFor(wantsTop).from, 0, spec.height - lh));
  const chosen = { pos: `${best.top ? 'top' : 'bottom'}-${best.align}` as LogoPlacement['position'], x: best.x, y: best.y, region: best.region, busy: best.busy };
  const relocated = !(plannedCandidate && plannedCandidate.x === best.x && plannedCandidate.y === best.y);

  const { luminance } = await regionMetrics(base, chosen.region);
  // A plate both fixes contrast on light grounds and isolates the logo when no
  // fully clean slot exists.
  const plate = luminance > 0.55 || chosen.busy > BUSY_LIMIT;

  const layers: sharp.OverlayOptions[] = [];
  if (plate) {
    const rx = Math.round(pad * 1.2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${chosen.region.width}" height="${chosen.region.height}"><rect x="0" y="0" width="${chosen.region.width}" height="${chosen.region.height}" rx="${rx}" ry="${rx}" fill="${plateColor}" fill-opacity="0.94"/></svg>`;
    layers.push({ input: Buffer.from(svg), left: chosen.region.left, top: chosen.region.top });
  }
  layers.push({ input: logoBuf, left: chosen.x, top: chosen.y });

  const buffer = await sharp(base).composite(layers).png().toBuffer();
  return { buffer, plate, luminance, x: chosen.x, y: chosen.y, width: lw, height: lh, position: chosen.pos, busy: chosen.busy, relocated };
}

export async function compositeLogo(base: Buffer, spec: FormatSpec, opts: LogoCompositeOptions): Promise<Buffer> {
  const logoRaw = await fetchBuffer(opts.logoUrl);
  const plateColor = pickPlateColor(opts.plateCandidates);
  const out = await compositeLogoBuffer(base, spec, logoRaw, opts.placement, plateColor);
  console.log(JSON.stringify({ event: 'logo_composited', planned: opts.placement.position, position: out.position, relocated: out.relocated, widthRatio: opts.placement.widthRatio, plate: out.plate, plateColor: out.plate ? plateColor : null, luminance: Number(out.luminance.toFixed(2)), busy: Number(out.busy.toFixed(3)) }));
  return out.buffer;
}
