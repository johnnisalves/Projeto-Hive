import { randomUUID } from 'crypto';
import { minioClient } from '../config/minio';
import { env } from '../config/env';

interface GenerateImageParams {
  prompt: string;
  style?: string;
  aspectRatio?: '1:1' | '9:16' | '4:5';
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

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const usage = checkUsage();
  if (!usage.allowed) {
    throw new Error(`Daily limit reached (${DAILY_LIMIT} images). Resets in ${usage.resetsIn}.`);
  }

  const enrichedPrompt = params.style
    ? `Professional social media, high quality, vibrant colors, ${params.style} style, ${params.prompt}`
    : `Professional social media, high quality, vibrant colors, ${params.prompt}`;

  let imageBuffer: Buffer;
  let contentType = 'image/jpeg';

  // Try HuggingFace first (free, fast), fallback to Gemini (paid quota)
  try {
    imageBuffer = await generateViaHuggingFace(enrichedPrompt, params.aspectRatio);
  } catch (hfError: any) {
    console.log(`[NanoBana] HF failed: ${hfError.message}. Trying Gemini fallback...`);
    try {
      const geminiResult = await generateViaGemini(enrichedPrompt, params.aspectRatio);
      imageBuffer = geminiResult.buffer;
      contentType = geminiResult.contentType;
    } catch (geminiError: any) {
      throw new Error(`Image generation failed. HF: ${hfError.message} | Gemini: ${geminiError.message}`);
    }
  }

  const result = await uploadToMinio(imageBuffer, contentType);
  usageCount++;
  console.log(`[NanoBana] Done (${usageCount}/${DAILY_LIMIT}). Remaining: ${checkUsage().remaining}. Resets in ${checkUsage().resetsIn}`);
  return result;
}
