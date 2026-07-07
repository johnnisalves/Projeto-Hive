import { randomUUID } from 'crypto';
import { minioClient } from '../config/minio';
import { env } from '../config/env';

interface GenerateImageParams {
  prompt: string;
  style?: string;
  aspectRatio?: '1:1' | '9:16' | '4:5';
  /** Negative prompt (what to avoid). Appended to the prompt for chat-based image models. */
  negativePrompt?: string;
  /** When true, `prompt` is used as-is (already art-directed) instead of the default wrapper. */
  preEnriched?: boolean;
}

interface GenerateImageResult {
  imageUrl: string;
  minioKey: string;
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

const ASPECT_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 864, height: 1080 },
  '9:16': { width: 576, height: 1024 },
};

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

async function generateViaHuggingFace(prompt: string, aspectRatio?: string): Promise<Buffer> {
  const { getSetting } = await import('../helpers/getSetting');
  const hfToken = await getSetting('HF_API_TOKEN');
  if (!hfToken) {
    throw new Error('HF_API_TOKEN not configured');
  }

  const dims = ASPECT_MAP[aspectRatio || '4:5'] || ASPECT_MAP['4:5'];

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

async function generateViaGemini(prompt: string, aspectRatio?: string): Promise<{ buffer: Buffer; contentType: string }> {
  const { getSetting } = await import('../helpers/getSetting');
  const apiKey = await getSetting('NANO_BANANA_API_KEY');
  if (!apiKey) {
    throw new Error('NANO_BANANA_API_KEY not configured');
  }

  const configured = await getSetting('NANO_BANANA_MODEL');
  const model = configured || 'gemini-2.5-flash-image';
  const ratio = aspectRatio === '4:5' ? '3:4' : (aspectRatio || '1:1');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: ratio },
    },
  });

  let response: globalThis.Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (response.ok || (response.status !== 503 && response.status !== 429)) break;
    await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
  }

  if (!response!.ok) {
    const errorText = await response!.text();
    throw new Error(`Gemini error ${response!.status}: ${errorText.slice(0, 150)}`);
  }

  const data = (await response!.json()) as any;
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) throw new Error('No image from Gemini');

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    contentType: imagePart.inlineData.mimeType,
  };
}

async function generateViaOpenRouter(prompt: string, aspectRatio?: string): Promise<{ buffer: Buffer; contentType: string }> {
  const { getSetting } = await import('../helpers/getSetting');
  const apiKey = await getSetting('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const configured = await getSetting('OPENROUTER_IMAGE_MODEL');
  const model = configured || 'google/gemini-3-pro-image';
  const ratio = aspectRatio || '1:1';

  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'user', content: `Generate an image with aspect ratio ${ratio}. ${prompt}` },
    ],
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
        'X-Title': 'OpenHive',
      },
      body,
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
  const attempts: Array<{ name: string; run: () => Promise<{ buffer: Buffer; contentType: string }> }> = [];
  if (provider === 'openrouter') {
    attempts.push({ name: 'OpenRouter', run: () => generateViaOpenRouter(enrichedPrompt, params.aspectRatio) });
  }
  attempts.push({
    name: 'HuggingFace',
    run: async () => ({ buffer: await generateViaHuggingFace(enrichedPrompt, params.aspectRatio), contentType: 'image/jpeg' }),
  });
  attempts.push({ name: 'Gemini', run: () => generateViaGemini(enrichedPrompt, params.aspectRatio) });

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

  const result = await uploadToMinio(imageBuffer, contentType);
  usageCount++;
  console.log(`[NanoBana] Done (${usageCount}/${DAILY_LIMIT}). Remaining: ${checkUsage().remaining}. Resets in ${checkUsage().resetsIn}`);
  return result;
}
