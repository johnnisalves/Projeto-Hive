import { prisma } from '../config/database';
import { env } from '../config/env';
import sharp from 'sharp';
import { isCloudinaryConfigured, uploadBufferToCloudinary } from '../config/cloudinary';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function uploadBufferToImgur(buffer: Buffer): Promise<string> {
  const clientId = process.env.IMGUR_CLIENT_ID || '546c25a59c58ad7';
  const blob = new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
  const form = new FormData();
  form.append('image', blob, 'upload.jpg');

  const res = await fetch('https://api.imgur.com/3/upload', {
    method: 'POST',
    headers: { Authorization: `Client-ID ${clientId}` },
    body: form,
  });

  const data = (await res.json()) as any;
  if (!data.success) throw new Error(`Imgur upload failed: ${data.data?.error || JSON.stringify(data)}`);
  return data.data.link;
}

/**
 * Mirror an image to a Meta-compatible CDN (Cloudinary or Imgur fallback).
 *
 * Why we need this: Meta's Graph API maintains an opaque hostname
 * allowlist for image_url. Self-hosted hosts (sslip.io, R2, custom
 * domains with valid LE certs, S3 default URLs) are silently rejected
 * with error_subcode 2207052 even when the URL is publicly reachable
 * and the image is valid. Hosts on Meta's allowlist (Cloudinary,
 * Wikipedia, Imgur, Unsplash, etc.) work consistently.
 *
 * Pipeline: download original → flatten alpha + convert to sRGB JPEG
 * (Meta-friendly) → upload to Cloudinary (or Imgur fallback) → return URL.
 */
export async function ensureMetaCompatibleUrl(imageUrl: string): Promise<string> {
  console.log(`[Instagram] Mirroring to CDN for Meta compatibility: ${imageUrl}`);
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status} ${imageUrl}`);
  const inputBuffer = Buffer.from(await res.arrayBuffer());

  // Convert to JPEG, sRGB, no alpha — Meta-friendly format
  const jpegBuffer = await sharp(inputBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColorspace('srgb')
    .jpeg({ quality: 92, progressive: false, mozjpeg: false })
    .toBuffer();

  // Try Cloudinary first, fall back to Imgur
  if (await isCloudinaryConfigured()) {
    try {
      const cdnUrl = await uploadBufferToCloudinary(jpegBuffer, 'openhive/instagram');
      console.log(`[Instagram] Cloudinary URL: ${cdnUrl} (${(jpegBuffer.length / 1024).toFixed(0)}KB)`);
      return cdnUrl;
    } catch (err: any) {
      console.warn(`[Instagram] Cloudinary upload failed (${err?.message}), falling back to Imgur`);
    }
  }

  // Imgur fallback — always works, no config needed
  const imgurUrl = await uploadBufferToImgur(jpegBuffer);
  console.log(`[Instagram] Imgur URL: ${imgurUrl} (${(jpegBuffer.length / 1024).toFixed(0)}KB)`);
  return imgurUrl;
}

/**
 * Detect which Instagram API endpoint to use based on token format.
 * - Tokens starting with "EAA" are Facebook Business tokens -> use graph.facebook.com
 * - Other tokens (typically starting with "IGAA") are Instagram Login tokens -> use graph.instagram.com
 *
 * Both APIs expose the same /media, /media_publish, and /{container-id} endpoints,
 * but they only accept their own token format.
 */
function getGraphBase(token: string): string {
  if (token.startsWith('EAA')) {
    return 'https://graph.facebook.com/v21.0';
  }
  return 'https://graph.instagram.com/v21.0';
}

/**
 * For IGAA tokens (Instagram Login API), the safest user identifier is the
 * literal string "me" - the API resolves it from the token itself, so we
 * don't need to worry about whether the stored igUserId is the correct one
 * (Facebook Page ID, IG Business Account ID, or IG App-scoped ID).
 *
 * For EAA tokens (Facebook Business), we must use the actual IG Business
 * Account ID linked to the Facebook Page.
 */
function resolveUserIdForToken(token: string, storedUserId: string): string {
  if (token.startsWith('EAA')) {
    return storedUserId; // Business token requires real IG Business Account ID
  }
  return 'me'; // Instagram Login token: use 'me' alias
}

/**
 * Recursos extras de publicacao aceitos pela API do Instagram.
 *
 * Cada parametro so vale em alguns tipos de midia: a API rejeita o container
 * inteiro se receber um parametro fora do tipo dele, entao aplicamos por tipo
 * em vez de mandar tudo em todo lugar. Referencia:
 * developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 */
export interface IgFeatures {
  userTags?: Array<{ username: string; x: number; y: number; imageIndex?: number }>;
  collaborators?: string[];
  locationId?: string | null;
  altText?: string | null;
  shareToFeed?: boolean;
  audioName?: string | null;
  coverUrl?: string | null;
  thumbOffsetMs?: number | null;
  isAiGenerated?: boolean;
  isPaidPartnership?: boolean;
  sponsorIds?: string[];
  /** Reels de teste: sai so para nao-seguidores antes de virar publico. */
  isTrialReel?: boolean;
}

/** Marcacoes de uma foto especifica do carrossel (ou do post simples). */
export function tagsForImage(features: IgFeatures, imageIndex?: number) {
  const tags = features.userTags || [];
  if (imageIndex === undefined) {
    // Post simples: aceita as marcacoes sem indice (ou com indice 0).
    return tags.filter((t) => t.imageIndex === undefined || t.imageIndex === 0);
  }
  return tags.filter((t) => t.imageIndex === imageIndex);
}

/**
 * Marcacao de pessoas. A API espera JSON e coordenadas de 0.0 a 1.0 medidas a
 * partir do canto superior esquerdo. imageIndex e nosso, nao vai para o Meta.
 */
export function appendUserTags(params: URLSearchParams, tags: IgFeatures['userTags']) {
  if (!tags || tags.length === 0) return;
  const payload = tags.map((t) => ({
    username: t.username.replace(/^@/, ''),
    x: Math.min(Math.max(t.x, 0), 1),
    y: Math.min(Math.max(t.y, 0), 1),
  }));
  params.append('user_tags', JSON.stringify(payload));
}

/** Parametros que valem em qualquer tipo de midia. */
export function appendUniversal(params: URLSearchParams, features: IgFeatures) {
  if (features.isAiGenerated) params.append('is_ai_generated', 'true');
}

/**
 * Publi / parceria paga. Exige a permissao instagram_branded_content_creator
 * (App Review) e token de Login do Facebook; com token IGAA o Meta rejeita.
 * Nao vale em Stories.
 *
 * Quando a conta e IGAA nos NAO mandamos os parametros: o Meta rejeita o
 * container inteiro, o que derrubaria a publicacao por causa de um selo
 * opcional. Melhor publicar sem o selo e avisar no log.
 */
export function appendBrandedContent(params: URLSearchParams, features: IgFeatures, token: string) {
  const wants = (features.sponsorIds || []).length > 0 || features.isPaidPartnership;
  if (wants && !token.startsWith('EAA')) {
    console.warn('[Instagram] Parceria paga ignorada: a conta usa Login do Instagram (IGAA). O selo exige conexao via Login do Facebook.');
    return;
  }
  const sponsors = (features.sponsorIds || []).filter(Boolean);
  if (sponsors.length > 0) {
    params.append('branded_content_sponsor_ids', JSON.stringify(sponsors.slice(0, 2)));
    // O Meta ja liga is_paid_partnership sozinho quando vem patrocinador,
    // mas mandamos explicito para o caso de a conta so querer o selo.
    params.append('is_paid_partnership', 'true');
  } else if (features.isPaidPartnership) {
    params.append('is_paid_partnership', 'true');
  }
}

/** Local: a API exige o ID de uma Pagina com local verificado, nao texto livre. */
export function appendLocation(params: URLSearchParams, features: IgFeatures) {
  if (features.locationId) params.append('location_id', features.locationId);
}

/**
 * Monta a legenda e decide o que vai para o primeiro comentario.
 *
 * Hashtag na legenda polui o texto que aparece no feed. Jogar as tags no
 * primeiro comentario mantem o alcance e deixa a legenda limpa — pratica
 * consagrada entre perfis grandes.
 *
 * Funcao pura para poder ser testada: errar aqui significa publicar sem as
 * hashtags OU com elas duplicadas nos dois lugares.
 */
export function montarTextos(
  caption: string | null | undefined,
  hashtags: string[],
  noPrimeiroComentario: boolean,
): { legenda: string; primeiroComentario: string | null } {
  const tags = (hashtags || []).filter(Boolean).map((h) => `#${String(h).replace(/^#/, '')}`);
  const texto = (caption || '').trim();

  if (!noPrimeiroComentario) {
    return {
      legenda: [texto, tags.join(' ')].filter(Boolean).join('\n\n'),
      primeiroComentario: null,
    };
  }

  return {
    legenda: texto,
    // Sem hashtag nao ha comentario a fazer: publicar um comentario vazio
    // seria pior que nao publicar nada.
    primeiroComentario: tags.length ? tags.join(' ') : null,
  };
}

/**
 * Publica o primeiro comentario com as hashtags.
 *
 * Nunca lanca: o post JA foi publicado com sucesso neste ponto. Falhar aqui
 * e perder as hashtags, nao o post — transformar isso em erro faria o
 * usuario achar que a publicacao inteira falhou.
 */
async function publicarPrimeiroComentario(mediaId: string, texto: string, token: string) {
  try {
    const base = getGraphBase(token);
    const res = await fetch(`${base}/${mediaId}/comments`, {
      method: 'POST',
      body: new URLSearchParams({ message: texto, access_token: token }),
    });
    const data = (await res.json()) as any;
    if (data?.error) throw new Error(data.error.message);
    console.log(`[Instagram] Hashtags no primeiro comentario: ${data.id}`);
  } catch (err) {
    console.warn('[Instagram] Nao consegui comentar as hashtags:', (err as Error).message);
  }
}

/** Colaboradores: ate 3 perfis, o post aparece no feed de todos. */
export function appendCollaborators(params: URLSearchParams, features: IgFeatures) {
  const list = (features.collaborators || []).filter(Boolean).slice(0, 3);
  if (list.length > 0) {
    params.append('collaborators', JSON.stringify(list.map((u) => u.replace(/^@/, ''))));
  }
}

/**
 * Retry a function on transient Instagram API errors (code 2, is_transient: true).
 * Uses exponential backoff: 5s, 15s, 30s
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  const delays = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isTransient = err.message?.includes('"is_transient":true') || err.message?.includes('"code":2');
      if (isTransient && attempt < maxRetries) {
        const delay = delays[attempt] || 30000;
        console.log(`[Instagram] ${label} transient error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label} failed after ${maxRetries} retries`);
}

// Note: there used to be a getPublicImageUrl helper that mirrored localhost
// URLs to catbox.moe. That's no longer needed — ensureMetaCompatibleUrl
// always mirrors to Cloudinary (whitelisted by Meta), regardless of whether
// the source URL is localhost, MinIO, or a public domain.

async function pollContainerStatus(containerId: string, token: string, maxAttempts = 20, intervalMs = 3000) {
  const base = getGraphBase(token);
  console.log(`[Instagram] Polling container ${containerId} via ${base}...`);
  let status = 'IN_PROGRESS';
  let attempts = 0;
  while (status !== 'FINISHED' && attempts < maxAttempts) {
    await sleep(intervalMs);
    // Request all useful fields - status_code is the simple state, status has detailed message
    const check = await fetch(
      `${base}/${containerId}?fields=status_code,status&access_token=${token}`,
    );
    const checkData = (await check.json()) as any;
    status = checkData.status_code;
    console.log(`[Instagram] Poll #${attempts + 1}: ${status} | full:`, JSON.stringify(checkData));
    if (status === 'ERROR') {
      const detail = checkData.status || JSON.stringify(checkData);
      throw new Error(`Media processing failed (Instagram error): ${detail}`);
    }
    if (status === 'EXPIRED') {
      throw new Error(`Media container expired before publish: ${JSON.stringify(checkData)}`);
    }
    attempts++;
  }
  if (status !== 'FINISHED') throw new Error(`Media processing timeout after ${(maxAttempts * intervalMs) / 1000}s`);
}

/**
 * Verify that a URL is publicly accessible (HEAD request, expects 200).
 * This catches problems early before sending to Instagram, which gives
 * cryptic ERROR responses when it can't fetch a media URL.
 */
export async function verifyPublicUrl(url: string, label: string): Promise<void> {
  console.log(`[Instagram] Verifying ${label} URL is public: ${url}`);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    console.log(`[Instagram] ${label} URL HEAD response: ${res.status} ${res.statusText}, content-type: ${res.headers.get('content-type')}, content-length: ${res.headers.get('content-length')}`);
    if (!res.ok) {
      throw new Error(`${label} URL not publicly accessible (HTTP ${res.status} ${res.statusText}). Instagram needs to download from this URL.`);
    }
  } catch (err: any) {
    if (err.message?.includes('not publicly accessible')) throw err;
    throw new Error(`${label} URL fetch failed: ${err.message}. Check that MinIO_PUBLIC_URL is reachable from the internet.`);
  }
}

async function publishContainer(containerId: string, token: string, igUserId: string) {
  const base = getGraphBase(token);
  const userPath = resolveUserIdForToken(token, igUserId);
  console.log(`[Instagram] Publishing media via ${base}/${userPath}...`);
  const publishRes = await fetch(`${base}/${userPath}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: token,
    }),
  });
  const result = (await publishRes.json()) as any;

  console.log('[Instagram] Publish response:', JSON.stringify(result));

  if (!result.id) {
    throw new Error(`Failed to publish post: ${JSON.stringify(result)}`);
  }

  return { id: result.id };
}

async function createChildContainer(
  publicUrl: string,
  token: string,
  igUserId: string,
  childOptions: { userTags?: IgFeatures['userTags']; altText?: string | null } = {},
): Promise<string> {
  const base = getGraphBase(token);
  const userPath = resolveUserIdForToken(token, igUserId);

  // Use query params in URL (official Meta docs approach) to avoid URLSearchParams encoding issues
  const qs = new URLSearchParams({
    image_url: publicUrl,
    is_carousel_item: 'true',
    media_type: 'IMAGE',
    access_token: token,
  });
  // Num carrossel, marcacao e texto alternativo pertencem a cada foto;
  // o container pai nao aceita esses dois.
  appendUserTags(qs, childOptions.userTags);
  if (childOptions.altText) qs.append('alt_text', childOptions.altText.slice(0, 1000));
  const url = `${base}/${userPath}/media?${qs.toString()}`;

  console.log(`[Instagram] Child container request URL (without token): ${url.replace(token, 'TOKEN_HIDDEN')}`);

  const res = await fetch(url, { method: 'POST' });
  const data = (await res.json()) as any;

  console.log(`[Instagram] Child container response:`, JSON.stringify(data));

  if (!data.id) {
    throw new Error(`Failed to create child container: ${JSON.stringify(data)}`);
  }

  return data.id;
}

async function publishSingleImage(
  imageUrl: string,
  caption: string,
  token: string,
  igUserId: string,
  features: IgFeatures = {},
) {
  const publicImageUrl = await ensureMetaCompatibleUrl(imageUrl);
  const base = getGraphBase(token);
  const userPath = resolveUserIdForToken(token, igUserId);

  console.log('[Instagram] Creating single image container...');
  console.log('[Instagram] Endpoint:', `${base}/${userPath}`);
  console.log('[Instagram] Stored User ID:', igUserId, '(using:', userPath, ')');
  console.log('[Instagram] Image URL:', publicImageUrl);

  // Verify that the image URL is publicly accessible BEFORE asking Instagram to download it
  await verifyPublicUrl(publicImageUrl, 'Image');

  const createData = await withRetry(async () => {
    const params = new URLSearchParams({
      image_url: publicImageUrl,
      caption,
      access_token: token,
    });
    // Imagem simples aceita o conjunto completo: marcacao, colaborador,
    // local, texto alternativo e publi.
    appendUserTags(params, tagsForImage(features));
    appendCollaborators(params, features);
    appendLocation(params, features);
    appendBrandedContent(params, features, token);
    appendUniversal(params, features);
    if (features.altText) params.append('alt_text', features.altText.slice(0, 1000));

    console.log('[Instagram] Extra params:', Array.from(params.keys()).filter((k) => k !== 'access_token').join(', '));

    const createRes = await fetch(`${base}/${userPath}/media`, {
      method: 'POST',
      body: params,
    });
    const data = (await createRes.json()) as any;
    console.log('[Instagram] Create container response:', JSON.stringify(data));
    if (!data.id) {
      throw new Error(`Failed to create media container: ${JSON.stringify(data)}`);
    }
    return data;
  }, 'Create single container');

  await pollContainerStatus(createData.id, token);
  return await publishContainer(createData.id, token, igUserId);
}

async function publishImageStory(
  imageUrl: string,
  token: string,
  igUserId: string,
  features: IgFeatures = {},
) {
  const publicImageUrl = await ensureMetaCompatibleUrl(imageUrl);
  const base = getGraphBase(token);
  const userPath = resolveUserIdForToken(token, igUserId);

  console.log('[Instagram] Creating IMAGE STORY container...');
  console.log('[Instagram] Image URL:', publicImageUrl);

  await verifyPublicUrl(publicImageUrl, 'Story image');

  const createData = await withRetry(async () => {
    const params = new URLSearchParams({
      image_url: publicImageUrl,
      media_type: 'STORIES',
      access_token: token,
    });
    // Stories aceitam marcacao de pessoa (x/y sao opcionais aqui), mas nao
    // local, colaborador nem publi, e nenhum sticker interativo pela API.
    appendUserTags(params, tagsForImage(features));
    appendUniversal(params, features);

    const createRes = await fetch(`${base}/${userPath}/media`, {
      method: 'POST',
      body: params,
    });
    const data = (await createRes.json()) as any;
    console.log('[Instagram] Create STORY container response:', JSON.stringify(data));
    if (!data.id) {
      throw new Error(`Failed to create story container: ${JSON.stringify(data)}`);
    }
    return data;
  }, 'Create story container');

  await pollContainerStatus(createData.id, token);
  return await publishContainer(createData.id, token, igUserId);
}

async function publishCarousel(
  images: Array<{ imageUrl: string }>,
  caption: string,
  token: string,
  igUserId: string,
  features: IgFeatures = {},
) {
  console.log(`[Instagram] Creating carousel with ${images.length} images...`);

  // Step 1: Mirror each image to Cloudinary (Meta-whitelisted host)
  const publicUrls: string[] = [];
  for (const img of images) {
    const cdnUrl = await ensureMetaCompatibleUrl(img.imageUrl);
    publicUrls.push(cdnUrl);
  }

  // Verify each carousel image URL is publicly accessible
  for (let i = 0; i < publicUrls.length; i++) {
    await verifyPublicUrl(publicUrls[i], `Carousel image ${i + 1}`);
  }

  // Step 2: Create individual container for each image with retry
  const childContainerIds: string[] = [];

  for (let i = 0; i < publicUrls.length; i++) {
    const publicUrl = publicUrls[i];
    console.log(`[Instagram] Creating child container ${i + 1}/${publicUrls.length}: ${publicUrl}`);

    const childId = await withRetry(
      () => createChildContainer(publicUrl, token, igUserId, {
        userTags: tagsForImage(features, i),
        // O texto alternativo informado vale para a primeira foto do carrossel.
        altText: i === 0 ? features.altText : null,
      }),
      `Child container ${i + 1}`,
    );

    childContainerIds.push(childId);
    // Delay between child creations to avoid rate limiting (2s for carousels with many images)
    if (i < publicUrls.length - 1) {
      await sleep(2000);
    }
  }

  // Step 3: Poll all child containers until FINISHED
  for (const childId of childContainerIds) {
    await pollContainerStatus(childId, token);
  }

  // Step 4: Create carousel container (children must be comma-separated)
  const base = getGraphBase(token);
  const userPath = resolveUserIdForToken(token, igUserId);
  console.log('[Instagram] Creating carousel container...');
  console.log('[Instagram] Endpoint:', `${base}/${userPath}`);
  console.log('[Instagram] Children IDs:', childContainerIds);

  const carouselData = await withRetry(async () => {
    const params = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childContainerIds.join(','),
      caption,
      access_token: token,
    });
    // No pai vao os atributos do post inteiro; marcacao/alt_text ficaram nos filhos.
    appendCollaborators(params, features);
    appendLocation(params, features);
    appendBrandedContent(params, features, token);
    appendUniversal(params, features);

    const carouselRes = await fetch(`${base}/${userPath}/media`, {
      method: 'POST',
      body: params,
    });
    const data = (await carouselRes.json()) as any;
    console.log('[Instagram] Carousel container response:', JSON.stringify(data));
    if (!data.id) {
      throw new Error(`Failed to create carousel container: ${JSON.stringify(data)}`);
    }
    return data;
  }, 'Carousel container');

  // Step 5: Poll carousel container
  await pollContainerStatus(carouselData.id, token);

  // Step 6: Publish
  return await publishContainer(carouselData.id, token, igUserId);
}

type VideoPublishMode = 'REELS' | 'STORIES' | 'FEED';

async function publishVideoMedia(
  videoUrl: string,
  caption: string,
  token: string,
  igUserId: string,
  mode: VideoPublishMode = 'REELS',
  features: IgFeatures = {},
) {
  const base = getGraphBase(token);
  const userPath = resolveUserIdForToken(token, igUserId);
  console.log(`[Instagram] Publishing video as ${mode}...`);
  console.log('[Instagram] Endpoint:', `${base}/${userPath}`);
  console.log('[Instagram] Token type:', token.startsWith('EAA') ? 'EAA (Facebook Business)' : 'IGAA (Instagram Login)');
  console.log('[Instagram] Stored User ID:', igUserId, '(using:', userPath, ')');
  console.log('[Instagram] Video URL:', videoUrl);

  // Verify that the video URL is publicly accessible BEFORE asking Instagram to download it
  await verifyPublicUrl(videoUrl, 'Video');

  // Step 1: Create media container - params differ per mode
  const createData = await withRetry(async () => {
    const params = new URLSearchParams();
    params.append('access_token', token);
    params.append('video_url', videoUrl);

    if (mode === 'REELS') {
      params.append('media_type', 'REELS');
      if (caption) params.append('caption', caption);
      // share_to_feed=false deixa o Reels so na aba Reels, fora do Feed.
      if (features.shareToFeed === false) params.append('share_to_feed', 'false');
      // O nome do audio original so pode ser definido UMA vez, aqui ou depois
      // pela pagina do audio; nao da para renomear numa segunda tentativa.
      if (features.audioName) params.append('audio_name', features.audioName.slice(0, 100));
      // Reels de teste: o Instagram mostra so para quem NAO segue voce.
      // Se performar, vira publico. graduation_strategy=MANUAL deixa a
      // decisao com voce — SS_PERFORMANCE promove sozinho.
      if (features.isTrialReel) {
        params.append('trial_params', JSON.stringify({ graduation_strategy: 'MANUAL' }));
      }
      appendCollaborators(params, features);
      appendLocation(params, features);
      appendBrandedContent(params, features, token);
    } else if (mode === 'STORIES') {
      params.append('media_type', 'STORIES');
      // Stories don't accept caption text via the API
    } else {
      // FEED video (deprecated by Instagram in favor of REELS, but still works)
      params.append('media_type', 'VIDEO');
      if (caption) params.append('caption', caption);
      appendLocation(params, features);
      appendBrandedContent(params, features, token);
    }

    // Capa: cover_url tem prioridade e faz o Meta ignorar thumb_offset.
    if (mode !== 'STORIES') {
      if (features.coverUrl) params.append('cover_url', features.coverUrl);
      else if (features.thumbOffsetMs != null) params.append('thumb_offset', String(features.thumbOffsetMs));
    }
    appendUserTags(params, tagsForImage(features));
    appendUniversal(params, features);

    console.log('[Instagram] Create container params:', Array.from(params.keys()).join(', '));

    const createRes = await fetch(`${base}/${userPath}/media`, {
      method: 'POST',
      body: params,
    });
    const data = (await createRes.json()) as any;
    console.log(`[Instagram] Create ${mode} container response:`, JSON.stringify(data));
    if (!data.id) {
      throw new Error(`Failed to create ${mode} container: ${JSON.stringify(data)}`);
    }
    return data;
  }, `Create ${mode} container`);

  // Step 2: Poll for processing (videos take longer than images, ~30-90s)
  // 60 attempts x 5s = 300s (5min) max
  await pollContainerStatus(createData.id, token, 60, 5000);

  // Step 3: Publish
  return await publishContainer(createData.id, token, igUserId);
}

// Backwards-compat wrapper
async function publishReel(videoUrl: string, caption: string, token: string, igUserId: string) {
  return publishVideoMedia(videoUrl, caption, token, igUserId, 'REELS');
}

/**
 * Quanto ainda cabe publicar nas proximas 24h.
 *
 * O Instagram corta em 50 posts por janela de 24 horas. Sem consultar isso,
 * uma campanha grande falha no meio e o usuario so descobre olhando os
 * posts que nao sairam. O endpoint devolve o gasto e o teto reais.
 *
 * Nunca lanca: se a consulta falhar, seguimos sem o aviso em vez de
 * bloquear o planejamento.
 */
export async function getPublishingLimit(userId: string): Promise<{
  usados: number; total: number; restantes: number; disponivel: boolean; motivo?: string;
}> {
  const indisponivel = (motivo: string) => ({ usados: 0, total: 50, restantes: 50, disponivel: false, motivo });

  try {
    const account = await prisma.instagramToken.findFirst({
      where: { userId },
      orderBy: { isDefault: 'desc' },
    });
    if (!account) return indisponivel('Nenhuma conta do Instagram conectada.');

    const token = account.accessToken;
    const base = getGraphBase(token);
    const userPath = resolveUserIdForToken(token, account.instagramUserId);

    const res = await fetch(
      `${base}/${userPath}/content_publishing_limit?fields=config,quota_usage&access_token=${token}`,
    );
    const data = (await res.json()) as any;
    if (data?.error) return indisponivel(data.error.message);

    const linha = data?.data?.[0];
    const usados = linha?.quota_usage ?? 0;
    const total = linha?.config?.quota_total ?? 50;
    return { usados, total, restantes: Math.max(0, total - usados), disponivel: true };
  } catch (err) {
    return indisponivel((err as Error).message);
  }
}

/**
 * Horarios em que os seguidores estao online.
 *
 * A metrica online_followers devolve, por hora do dia, quantos seguidores
 * estao ativos. E o dado que transforma a recomendacao de horario da
 * campanha de "boa pratica generica" em "o seu publico".
 *
 * LIMITES DO META: exige instagram_manage_insights, conta Business (Creator
 * nao serve) e um minimo de 100 seguidores. Fora disso volta vazio — e nao
 * e erro, e so ausencia de dado.
 */
export async function getBestHours(userId: string): Promise<{
  horas: number[]; disponivel: boolean; motivo?: string;
}> {
  const semDado = (motivo: string) => ({ horas: [], disponivel: false, motivo });

  try {
    const account = await prisma.instagramToken.findFirst({
      where: { userId },
      orderBy: { isDefault: 'desc' },
    });
    if (!account) return semDado('Nenhuma conta do Instagram conectada.');

    const token = account.accessToken;
    const base = getGraphBase(token);
    const userPath = resolveUserIdForToken(token, account.instagramUserId);

    const res = await fetch(
      `${base}/${userPath}/insights?metric=online_followers&period=lifetime&access_token=${token}`,
    );
    const data = (await res.json()) as any;
    if (data?.error) return semDado(data.error.message);

    // A resposta traz varios dias; somamos a mesma hora entre eles para
    // achar o padrao, em vez de depender de um dia solto.
    const soma = new Map<number, number>();
    for (const valor of data?.data?.[0]?.values || []) {
      for (const [hora, qtd] of Object.entries(valor?.value || {})) {
        const h = Number(hora);
        if (Number.isInteger(h)) soma.set(h, (soma.get(h) || 0) + Number(qtd || 0));
      }
    }
    if (soma.size === 0) {
      return semDado('Sem dados de seguidores online. Exige conta Business com 100+ seguidores.');
    }

    // Descarta madrugada: publicar as 3h nao ajuda mesmo que o numero suba.
    const horas = [...soma.entries()]
      .filter(([h]) => h >= 7 && h <= 22)
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => h);

    return { horas, disponivel: horas.length > 0 };
  } catch (err) {
    return semDado((err as Error).message);
  }
}

/**
 * Posts em alta de uma hashtag — para pesquisa de conteudo.
 *
 * Sao duas chamadas: ig_hashtag_search traduz o nome no ID, e top_media
 * devolve as midias. So funciona com token do Login do Facebook.
 *
 * LIMITE DO META: 30 hashtags distintas por semana, por conta. Buscar a
 * mesma varias vezes nao conta de novo, entao vale evitar exploracao solta.
 */
export async function searchHashtag(userId: string, nome: string): Promise<{
  items: Array<{ id: string; caption?: string; permalink?: string; mediaUrl?: string; likes?: number; comments?: number }>;
  disponivel: boolean;
  motivo?: string;
}> {
  const semDado = (motivo: string) => ({ items: [], disponivel: false, motivo });
  const termo = nome.trim().replace(/^#/, '');
  if (termo.length < 2) return semDado('Informe a hashtag.');

  try {
    const account = await prisma.instagramToken.findFirst({
      where: { userId },
      orderBy: { isDefault: 'desc' },
    });
    if (!account) return semDado('Nenhuma conta do Instagram conectada.');
    if (!account.accessToken.startsWith('EAA')) {
      return semDado('A busca por hashtag exige conta conectada via Login do Facebook.');
    }

    const token = account.accessToken;
    const uid = account.instagramUserId;
    const base = 'https://graph.facebook.com/v21.0';

    const idRes = await fetch(`${base}/ig_hashtag_search?user_id=${uid}&q=${encodeURIComponent(termo)}&access_token=${token}`);
    const idJson = (await idRes.json()) as any;
    if (idJson?.error) return semDado(idJson.error.message);

    const hashtagId = idJson?.data?.[0]?.id;
    if (!hashtagId) return semDado(`Hashtag #${termo} nao encontrada.`);

    const campos = 'id,caption,permalink,media_url,like_count,comments_count';
    const mRes = await fetch(`${base}/${hashtagId}/top_media?user_id=${uid}&fields=${campos}&limit=25&access_token=${token}`);
    const mJson = (await mRes.json()) as any;
    if (mJson?.error) return semDado(mJson.error.message);

    const items = (mJson?.data || []).map((m: any) => ({
      id: m.id,
      caption: m.caption,
      permalink: m.permalink,
      mediaUrl: m.media_url,
      likes: m.like_count,
      comments: m.comments_count,
    }));
    return { items, disponivel: true };
  } catch (err) {
    return semDado((err as Error).message);
  }
}

export async function publishToInstagram(postId: string, accountId?: string) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { images: { orderBy: { order: 'asc' } } },
  });

  let token: string | undefined;
  let igUserId: string | undefined;
  const userId = post.userId;

  if (accountId) {
    const account = await prisma.instagramToken.findUnique({ where: { id: accountId } });
    if (account) { token = account.accessToken; igUserId = account.instagramUserId; }
  }

  if (!token && post.brandId) {
    const brandAccount = await prisma.socialAccount.findFirst({
      where: { userId, platform: 'INSTAGRAM', brandId: post.brandId },
    });
    if (brandAccount?.pageId) {
      const matched = await prisma.instagramToken.findFirst({
        where: { userId, pageId: brandAccount.pageId },
      });
      if (matched) { token = matched.accessToken; igUserId = matched.instagramUserId; }
    }
  }

  if (!token) {
    const defaultAccount = await prisma.instagramToken.findFirst({
      where: { userId, isDefault: true },
    });
    if (defaultAccount) { token = defaultAccount.accessToken; igUserId = defaultAccount.instagramUserId; }
  }

  if (!token) {
    const anyAccount = await prisma.instagramToken.findFirst({ where: { userId } });
    if (anyAccount) { token = anyAccount.accessToken; igUserId = anyAccount.instagramUserId; }
  }

  if (!token) {
    // Fallback to env vars
    token = env.INSTAGRAM_ACCESS_TOKEN;
    igUserId = env.INSTAGRAM_USER_ID;
  }

  if (!token || !igUserId) {
    throw new Error('Instagram credentials not configured. Add an account in Settings.');
  }

  const { legenda: caption, primeiroComentario } = montarTextos(
    post.caption, post.hashtags, post.hashtagsFirstComment,
  );

  /** Publica e, se for o caso, comenta as hashtags logo depois. */
  const finalizar = async (r: { id: string }) => {
    if (primeiroComentario) await publicarPrimeiroComentario(r.id, primeiroComentario, token!);
    return r;
  };

  const features: IgFeatures = {
    userTags: Array.isArray(post.userTags) ? (post.userTags as IgFeatures['userTags']) : undefined,
    collaborators: post.collaborators,
    locationId: post.locationId,
    altText: post.altText,
    shareToFeed: post.shareToFeed,
    audioName: post.audioName,
    coverUrl: post.coverUrl,
    thumbOffsetMs: post.thumbOffsetMs,
    isAiGenerated: post.isAiGenerated,
    isPaidPartnership: post.isPaidPartnership,
    sponsorIds: post.sponsorIds,
    isTrialReel: post.isTrialReel,
  };

  // Video (Reels / Stories / Feed).
  // mixedVideoUrl tambem aparece quando o post era uma FOTO com trilha: a
  // imagem virou video para poder sair com musica. Nesse caso publicamos
  // como video mesmo o mediaType sendo IMAGE.
  if (post.mediaType === 'VIDEO' || post.mixedVideoUrl) {
    // mixedVideoUrl e o video ja com a trilha mixada (ver audio-mixer.service).
    const videoUrl = post.mixedVideoUrl || post.videoUrl;
    if (!videoUrl) throw new Error('Video post has no videoUrl');
    // publishMode field defines where to post (defaults to REELS for videos)
    const mode = (post.publishMode === 'FEED' ? 'FEED' : post.publishMode === 'STORIES' ? 'STORIES' : 'REELS') as VideoPublishMode;
    return await finalizar(await publishVideoMedia(videoUrl, caption, token, igUserId, mode, features));
  }

  // Image Story (Stories nao aceitam carrossel nem caption — usa a imagem de capa)
  if (post.publishMode === 'STORIES') {
    const storyUrl = post.imageUrl || (post.images && post.images[0]?.imageUrl);
    if (!storyUrl) throw new Error('Post has no image for Story');
    return await publishImageStory(storyUrl, token, igUserId, features);
  }

  // Carousel or single image (Feed)
  if (post.isCarousel && post.images && post.images.length >= 2) {
    return await finalizar(await publishCarousel(post.images, caption, token, igUserId, features));
  } else {
    if (!post.imageUrl) throw new Error('Post has no image');
    return await finalizar(await publishSingleImage(post.imageUrl, caption, token, igUserId, features));
  }
}
