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

export type CompositeResult = { buffer: Buffer; plate: boolean; luminance: number; x: number; y: number; width: number; height: number };

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

  const pos = placement.position;
  const x = clamp(pos.endsWith('left') ? margin : pos.endsWith('right') ? spec.width - lw - margin : Math.round((spec.width - lw) / 2), 0, spec.width - lw);
  const y = clamp(pos.startsWith('top') ? topLimit : bottomLimit - lh, 0, spec.height - lh);

  // Region under the logo, with breathing room — measured for brightness and
  // reused as the plate rectangle when one is needed.
  const pad = Math.round(lw * 0.1);
  const left = clamp(x - pad, 0, spec.width - 1);
  const top = clamp(y - pad, 0, spec.height - 1);
  const region = { left, top, width: clamp(lw + 2 * pad, 1, spec.width - left), height: clamp(lh + 2 * pad, 1, spec.height - top) };

  const stats = await sharp(base).extract(region).stats();
  const [r, g, b] = stats.channels.map((c) => c.mean);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const plate = luminance > 0.55;

  const layers: sharp.OverlayOptions[] = [];
  if (plate) {
    const rx = Math.round(pad * 1.2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${region.width}" height="${region.height}"><rect x="0" y="0" width="${region.width}" height="${region.height}" rx="${rx}" ry="${rx}" fill="${plateColor}" fill-opacity="0.94"/></svg>`;
    layers.push({ input: Buffer.from(svg), left: region.left, top: region.top });
  }
  layers.push({ input: logoBuf, left: x, top: y });

  const buffer = await sharp(base).composite(layers).png().toBuffer();
  return { buffer, plate, luminance, x, y, width: lw, height: lh };
}

export async function compositeLogo(base: Buffer, spec: FormatSpec, opts: LogoCompositeOptions): Promise<Buffer> {
  const logoRaw = await fetchBuffer(opts.logoUrl);
  const plateColor = pickPlateColor(opts.plateCandidates);
  const out = await compositeLogoBuffer(base, spec, logoRaw, opts.placement, plateColor);
  console.log(JSON.stringify({ event: 'logo_composited', position: opts.placement.position, widthRatio: opts.placement.widthRatio, plate: out.plate, plateColor: out.plate ? plateColor : null, luminance: Number(out.luminance.toFixed(2)) }));
  return out.buffer;
}
