/**
 * Final-format normalisation with sharp (already an api dependency).
 *
 * No provider returns exactly 1080x1350. This is the last step before MinIO:
 * whatever the provider gives back, the stored file has the exact canvas the
 * user chose. Cover-crop only — never distorts.
 */

import sharp from 'sharp';
import type { FormatSpec } from './format-spec';

export type NormalizeResult = {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  cropped: boolean;
};

/**
 * Cover-fit to the exact spec, cropped from the centre. The vertical crop is
 * biased 40% from the top rather than 50%, because subjects and headlines sit
 * in the upper two-thirds far more often than the lower third.
 */
export async function normalizeToSpec(input: Buffer, spec: FormatSpec): Promise<NormalizeResult> {
  const meta = await sharp(input).metadata();
  const sourceWidth = meta.width ?? spec.width;
  const sourceHeight = meta.height ?? spec.height;

  if (sourceWidth === spec.width && sourceHeight === spec.height) {
    return { buffer: input, contentType: 'image/png', width: spec.width, height: spec.height, sourceWidth, sourceHeight, cropped: false };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = spec.width / spec.height;
  const cropped = Math.abs(sourceAspect - targetAspect) / targetAspect > 0.01;

  const buffer = await sharp(input)
    .resize(spec.width, spec.height, {
      fit: 'cover',
      position: sharp.gravity.north, // bias toward the top; protects faces + headline
    })
    .png()
    .toBuffer();

  return { buffer, contentType: 'image/png', width: spec.width, height: spec.height, sourceWidth, sourceHeight, cropped };
}

/** Downloads a remote image or decodes a data: URL into a Buffer. */
export async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1];
    if (!base64) throw new Error('Malformed data URL');
    return Buffer.from(base64, 'base64');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated image (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
