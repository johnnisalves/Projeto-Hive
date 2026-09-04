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
  /** 1 = full size; smaller when the logo had to shrink to find a clean gap. */
  scale: number;
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
  const trimMeta = await sharp(trimmed).metadata();
  const aspect = (trimMeta.height ?? 1) / (trimMeta.width ?? 1);

  const margin = Math.round(spec.width * 0.045);
  const safe = safeAreaPx(spec);
  const topLimit = Math.max(margin, safe.top ?? 0);
  const bottomLimit = spec.height - Math.max(margin, safe.bottom ?? 0);

  const wantsTop = placement.position.startsWith('top');
  const alignOf = (pos: LogoPlacement['position']): 'left' | 'center' | 'right' =>
    pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center';
  const wantedAlign = alignOf(placement.position);

  const busyness = async (region: Region) => (await regionMetrics(base, region)).busy;

  const BUSY_LIMIT = 0.10;
  type Candidate = { x: number; y: number; region: Region; busy: number; align: 'left' | 'center' | 'right'; top: boolean; scale: number };

  /**
   * Sweeps the whole canvas — three horizontal alignments by rows from the top
   * margin to the bottom one — looking for the calmest place the logo fits.
   * Two corners are never enough: a poster with copy across the top and a hero
   * product below can have its only quiet gap halfway down the frame.
   */
  const sweep = async (scale: number): Promise<Candidate[]> => {
    const lw = Math.round(spec.width * placement.widthRatio * scale);
    const lh = Math.round(lw * aspect);
    const pad = Math.round(lw * 0.1);
    // Measured area is wider than the plate: a slot whose neighbour is a line of
    // copy must score as busy, otherwise the stamp lands touching the text.
    const guard = Math.round(lw * 0.3);
    const out: Candidate[] = [];
    const rows = 8;
    const from = topLimit;
    const to = Math.max(topLimit, bottomLimit - lh);
    for (let i = 0; i < rows; i++) {
      const y = clamp(Math.round(from + ((to - from) * i) / (rows - 1)), 0, spec.height - lh);
      for (const align of ['center', 'left', 'right'] as const) {
        const x = clamp(align === 'left' ? margin : align === 'right' ? spec.width - lw - margin : Math.round((spec.width - lw) / 2), 0, spec.width - lw);
        const left = clamp(x - pad, 0, spec.width - 1);
        const top = clamp(y - pad, 0, spec.height - 1);
        const region = { left, top, width: clamp(lw + 2 * pad, 1, spec.width - left), height: clamp(lh + 2 * pad, 1, spec.height - top) };
        const gLeft = clamp(x - guard, 0, spec.width - 1);
        const gTop = clamp(y - guard, 0, spec.height - 1);
        const guardRegion = { left: gLeft, top: gTop, width: clamp(lw + 2 * guard, 1, spec.width - gLeft), height: clamp(lh + 2 * guard, 1, spec.height - gTop) };
        out.push({ x, y, region, busy: await busyness(guardRegion), align, top: y < spec.height / 2, scale });
      }
    }
    return out;
  };

  // Full-size first. If nothing is genuinely clean, a smaller logo fits gaps a
  // big one cannot — better a discreet, legible mark than one over the copy.
  let candidates = await sweep(1);
  const scoreOf = (c: Candidate) => c.busy - (c.align === wantedAlign ? 0.015 : 0) - (c.top === wantsTop ? 0.01 : 0);
  candidates.sort((a, b) => scoreOf(a) - scoreOf(b));
  if (candidates[0].busy > BUSY_LIMIT) {
    const smaller = await sweep(0.72);
    const merged = [...candidates, ...smaller].sort((a, b) => scoreOf(a) - scoreOf(b));
    candidates = merged;
  }

  const best = candidates[0];
  const lw = Math.round(spec.width * placement.widthRatio * best.scale);
  const logoBuf = await sharp(trimmed).resize({ width: lw }).png().toBuffer();
  const lhMeta = await sharp(logoBuf).metadata();
  const lh = lhMeta.height ?? Math.round(lw * aspect);

  const chosenPos = `${best.top ? 'top' : 'bottom'}-${best.align}` as LogoPlacement['position'];

  // The slot the plan asked for, at full size — used only to report whether the
  // stamp had to move.
  const plannedW = Math.round(spec.width * placement.widthRatio);
  const plannedH = Math.round(plannedW * aspect);
  const plannedX = clamp(
    wantedAlign === 'left' ? margin : wantedAlign === 'right' ? spec.width - plannedW - margin : Math.round((spec.width - plannedW) / 2),
    0, spec.width - plannedW,
  );
  const plannedY = clamp(wantsTop ? topLimit : bottomLimit - plannedH, 0, spec.height - plannedH);
  const tolerance = Math.round(spec.height * 0.01);
  const plannedIsBest = best.scale === 1 && best.x === plannedX && Math.abs(best.y - plannedY) <= tolerance;

  const { luminance } = await regionMetrics(base, best.region);
  // A plate fixes contrast on light grounds and isolates the mark when no
  // perfectly clean slot exists.
  const plate = luminance > 0.55 || best.busy > BUSY_LIMIT;

  const layers: sharp.OverlayOptions[] = [];
  if (plate) {
    const rx = Math.round(best.region.width * 0.06);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${best.region.width}" height="${best.region.height}"><rect x="0" y="0" width="${best.region.width}" height="${best.region.height}" rx="${rx}" ry="${rx}" fill="${plateColor}" fill-opacity="0.94"/></svg>`;
    layers.push({ input: Buffer.from(svg), left: best.region.left, top: best.region.top });
  }
  layers.push({ input: logoBuf, left: clamp(best.x, 0, spec.width - lw), top: clamp(best.y, 0, spec.height - lh) });

  const buffer = await sharp(base).composite(layers).png().toBuffer();
  return { buffer, plate, luminance, x: best.x, y: best.y, width: lw, height: lh, position: chosenPos, busy: best.busy, relocated: !plannedIsBest, scale: best.scale };
}

export async function compositeLogo(base: Buffer, spec: FormatSpec, opts: LogoCompositeOptions): Promise<Buffer> {
  const logoRaw = await fetchBuffer(opts.logoUrl);
  const plateColor = pickPlateColor(opts.plateCandidates);
  const out = await compositeLogoBuffer(base, spec, logoRaw, opts.placement, plateColor);
  console.log(JSON.stringify({ event: 'logo_composited', planned: opts.placement.position, position: out.position, relocated: out.relocated, widthRatio: opts.placement.widthRatio, plate: out.plate, plateColor: out.plate ? plateColor : null, luminance: Number(out.luminance.toFixed(2)), busy: Number(out.busy.toFixed(3)), scale: out.scale }));
  return out.buffer;
}
