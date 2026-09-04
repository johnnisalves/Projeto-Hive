import { randomUUID } from 'crypto';
import { minioClient } from '../config/minio';
import { env } from '../config/env';
import { getFormatSpec, geminiAspectRatio, huggingFaceDimensions, openRouterAspectRatio, type FormatSpec } from './creative/format-spec';
import { normalizeToSpec } from './creative/image-normalize';

interface GenerateImageParams {
  prompt: string;
  style?: string;
  /** Named format ('ig-feed') or bare ratio ('4:5'). Both resolve via format-spec. */
  aspectRatio?: string;
  format?: string;
  /** Negative prompt (what to avoid). Appended to the prompt for chat-based image models. */
  negativePrompt?: string;
  /** When true, `prompt` is used as-is (already art-directed) instead of the default wrapper. */
  preEnriched?: boolean;
  /** Reference images (e.g. the official logo) for multimodal models to reproduce faithfully. */
  referenceImages?: string[];
  /** Runs on the normalised canvas right before upload (e.g. stamping the real logo). */
  postProcess?: (buffer: Buffer, spec: FormatSpec) => Promise<Buffer>;
}

interface GenerateImageResult {
  imageUrl: string;
  minioKey: string;
  /** Actual stored dimensions after normalisation, for callers that care. */
  width: number;
  height: number;
}

// ── Usage Counter (in-memory, resets at midnight) ──
// HF Inference free tier: rate-limited but no hard daily cap. Being conservative.
const DAILY_LIMIT = 30;
let usageCount = 0;
let usageResetAt = new Date();
usageResetAt.setHours(24, 0, 0, 0);

function checkUsage(): { allowed: boolean; remaining: number; resetsIn: string } {
  const now = new Date();
  if (now >= usageResetAt) {
    usageCount = 0;
    usageResetAt = new Date(now);
    usageResetAt.setHours(24, 0, 0, 0);
  }
  const remaining = Math.max(0, DAILY_LIMIT - usageCount);
  const diffMs = usageResetAt.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return { allowed: usageCount < DAILY_LIMIT, remaining, resetsIn: `${hours}h ${mins}m` };
}

export function getUsageStats() {
  const info = checkUsage();
  return { used: usageCount, limit: DAILY_LIMIT, remaining: info.remaining, resetsIn: info.resetsIn };
}

const HF_MODELS = [
  'black-forest-labs/FLUX.1-schnell',
  'stabilityai/stable-diffusion-xl-base-1.0',
];

async function uploadToMinio(imageBuffer: Buffer, contentType: string): Promise<{ imageUrl: string; minioKey: string }> {
  const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
  const key = `posts/${Date.now()}-${randomUUID()}.${ext}`;

  const bucketExists = await minioClient.bucketExists(env.MINIO_BUCKET);
  if (!bucketExists) {
    await minioClient.makeBucket(env.MINIO_BUCKET);
    const policy = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${env.MINIO_BUCKET}/*`] }],
    };
    await minioClient.setBucketPolicy(env.MINIO_BUCKET, JSON.stringify(policy));
  }

  await minioClient.putObject(env.MINIO_BUCKET, key, imageBuffer, imageBuffer.length, {
    'Content-Type': contentType,
  });

  const imageUrl = `${env.MINIO_PUBLIC_URL}/${env.MINIO_BUCKET}/${key}`;
  return { imageUrl, minioKey: key };
}

async function generateViaHuggingFace(prompt: string, spec: FormatSpec): Promise<Buffer> {
  const { getSetting } = await import('../helpers/getSetting');
  const hfToken = await getSetting('HF_API_TOKEN');
  if (!hfToken) {
    throw new Error('HF_API_TOKEN not configured');
  }

  const dims = huggingFaceDimensions(spec);

  for (const model of HF_MODELS) {
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;
    const body = JSON.stringify({
      inputs: prompt,
      parameters: { width: dims.width, height: dims.height },
    });

    let response: globalThis.Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok || response.status !== 503) break;
      console.log(`[HF/${model}] 503 on attempt ${attempt + 1}, retrying in ${(attempt + 1) * 3}s...`);
      await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
    }

    if (!response!.ok) {
      const errorText = await response!.text();
      console.log(`[HF/${model}] Failed ${response!.status}: ${errorText.slice(0, 100)}`);
      continue;
    }

    const buffer = Buffer.from(await response!.arrayBuffer());
    if (buffer.length < 1000) {
      console.log(`[HF/${model}] Response too small (${buffer.length} bytes)`);
      continue;
    }

    console.log(`[HF] Image generated via ${model} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return buffer;
  }

  throw new Error('All HuggingFace models failed');
}

/** Fetches a reference image and returns it as a base64 inlineData part. */
async function toInlineDataPart(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const contentType = r.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await r.arrayBuffer());
    return { inlineData: { mimeType: contentType.split(';')[0], data: buf.toString('base64') } };
  } catch {
    return null;
  }
}

async function generateViaGemini(prompt: string, spec: FormatSpec, referenceImages?: string[]): Promise<{ buffer: Buffer; contentType: string }> {
  const { getSetting } = await import('../helpers/getSetting');
  const apiKey = await getSetting('NANO_BANANA_API_KEY');
  if (!apiKey) {
    throw new Error('NANO_BANANA_API_KEY not configured');
  }

  const configured = await getSetting('NANO_BANANA_MODEL');
  const model = configured || 'gemini-2.5-flash-image';
  const ratio = geminiAspectRatio(spec);

  // Reference images (logo) go first so the model treats them as assets to reproduce.
  const parts: any[] = [];
  for (const ref of referenceImages || []) {
    const part = await toInlineDataPart(ref);
    if (part) parts.push(part);
  }
  parts.push({ text: `Generate an image: ${prompt}` });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: ratio },
    },
  });

  let response: globalThis.Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(180_000) });
    if (response.ok || (response.status !== 503 && response.status !== 429)) break;
    await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
  }

  if (!response!.ok) {
    const errorText = await response!.text();
    throw new Error(`Gemini error ${response!.status}: ${errorText.slice(0, 150)}`);
  }

  const data = (await response!.json()) as any;
  const responseParts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) throw new Error('No image from Gemini');

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    contentType: imagePart.inlineData.mimeType,
  };
}

async function generateViaOpenRouter(prompt: string, spec: FormatSpec, referenceImages?: string[]): Promise<{ buffer: Buffer; contentType: string }> {
  const { getSetting } = await import('../helpers/getSetting');
  const apiKey = await getSetting('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const configured = await getSetting('OPENROUTER_IMAGE_MODEL');
  const model = configured || 'google/gemini-3-pro-image';
  const ratio = openRouterAspectRatio(spec);

  const textPart = { type: 'text', text: `Generate an image with aspect ratio ${ratio}. ${prompt}` };
  // Reference images (logo) precede the instruction so the model reproduces them.
  const refs = (referenceImages || []).map((u) => ({ type: 'image_url', image_url: { url: u } }));
  const content: unknown = refs.length ? [...refs, textPart] : `Generate an image with aspect ratio ${ratio}. ${prompt}`;

  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content }],
    // OpenRouter unified image API: image output comes back in message.images[]
    modalities: ['image', 'text'],
  });

  let response: globalThis.Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.FRONTEND_URL,
        'X-Title': 'DisparaAI',
      },
      body,
      // Never let a stuck upstream hold the request open forever.
      signal: AbortSignal.timeout(180_000),
    });
    if (response.ok || (response.status !== 503 && response.status !== 429)) break;
    await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
  }

  if (!response!.ok) {
    const errorText = await response!.text();
    throw new Error(`OpenRouter error ${response!.status}: ${errorText.slice(0, 150)}`);
  }

  const data = (await response!.json()) as any;
  const message = data.choices?.[0]?.message;
  const images = message?.images || [];
  const first = images[0];
  const dataUrl: string | undefined = first?.image_url?.url || (typeof first === 'string' ? first : undefined);
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    throw new Error('No image returned from OpenRouter');
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Malformed image data URL from OpenRouter');
  }
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');

  console.log(`[OpenRouter] Image generated via ${model} (${(buffer.length / 1024).toFixed(0)}KB)`);
  return { buffer, contentType };
}

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const usage = checkUsage();
  if (!usage.allowed) {
    throw new Error(`Daily limit reached (${DAILY_LIMIT} images). Resets in ${usage.resetsIn}.`);
  }

  const { getSetting } = await import('../helpers/getSetting');
  const provider = ((await getSetting('NANO_BANANA_PROVIDER')) || env.NANO_BANANA_PROVIDER || 'google').toLowerCase();

  // Single source of truth for the canvas. Accepts a named format or a bare ratio.
  const spec = getFormatSpec(params.format || params.aspectRatio);

  const base = params.preEnriched
    ? params.prompt
    : params.style
    ? `Professional social media, high quality, vibrant colors, ${params.style} style, ${params.prompt}`
    : `Professional social media, high quality, vibrant colors, ${params.prompt}`;
  const enrichedPrompt = params.negativePrompt
    ? `${base}\n\nAvoid in the image: ${params.negativePrompt}.`
    : base;

  // Ordered cascade of generators. When provider=openrouter, OpenRouter (Nano Banana Pro
  // etc) goes first for best quality; HuggingFace (free) and native Gemini stay as
  // graceful fallbacks so image generation never hard-fails when one provider is down.
  const refs = params.referenceImages;
  const attempts: Array<{ name: string; run: () => Promise<{ buffer: Buffer; contentType: string }> }> = [];
  if (provider === 'openrouter') {
    attempts.push({ name: 'OpenRouter', run: () => generateViaOpenRouter(enrichedPrompt, spec, refs) });
  }
  attempts.push({
    // HuggingFace diffusion models can't take a logo reference; they stay a pure fallback.
    name: 'HuggingFace',
    run: async () => ({ buffer: await generateViaHuggingFace(enrichedPrompt, spec), contentType: 'image/jpeg' }),
  });
  attempts.push({ name: 'Gemini', run: () => generateViaGemini(enrichedPrompt, spec, refs) });

  let imageBuffer: Buffer | null = null;
  let contentType = 'image/jpeg';
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const r = await attempt.run();
      imageBuffer = r.buffer;
      contentType = r.contentType;
      break;
    } catch (e: any) {
      errors.push(`${attempt.name}: ${e.message}`);
      console.log(`[NanoBana] ${attempt.name} failed: ${e.message}`);
    }
  }

  if (!imageBuffer) {
    throw new Error(`Image generation failed. ${errors.join(' | ')}`);
  }

  // Guarantee the exact canvas the caller asked for. No provider returns it
  // natively (DALL-E, HF buckets, Gemini all round to their own sizes).
  let finalBuffer = imageBuffer;
  let finalType = contentType;
  let outWidth = spec.width;
  let outHeight = spec.height;
  try {
    const normalized = await normalizeToSpec(imageBuffer, spec);
    finalBuffer = normalized.buffer;
    finalType = normalized.contentType;
    outWidth = normalized.width;
    outHeight = normalized.height;
    if (normalized.cropped) {
      console.log(`[NanoBana] normalized ${normalized.sourceWidth}x${normalized.sourceHeight} -> ${outWidth}x${outHeight}`);
    }
  } catch (e: any) {
    console.log(`[NanoBana] normalize failed, storing provider image as-is: ${e.message}`);
  }

  if (params.postProcess) {
    try {
      finalBuffer = await params.postProcess(finalBuffer, spec);
      finalType = 'image/png';
    } catch (e: any) {
      console.log(`[NanoBana] postProcess failed, storing image without it: ${e.message}`);
    }
  }

  const result = await uploadToMinio(finalBuffer, finalType);
  usageCount++;
  console.log(`[NanoBana] Done (${usageCount}/${DAILY_LIMIT}). Remaining: ${checkUsage().remaining}. Resets in ${checkUsage().resetsIn}`);
  return { ...result, width: outWidth, height: outHeight };
}
