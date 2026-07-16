import { prisma } from '../config/database';

/**
 * TikTok Content Posting API (v2).
 * Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
 *
 * ATENCAO (regra do TikTok, nao nossa):
 *  - App NAO auditado pelo TikTok so consegue postar como privado (SELF_ONLY).
 *  - Para postar publico (PUBLIC_TO_EVERYONE) o app precisa passar pela auditoria deles.
 *  - PULL_FROM_URL exige o dominio verificado no portal do TikTok.
 */

const TIKTOK_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

// Escopos: basic (perfil) + publish (post direto) + upload (rascunho/inbox)
const TIKTOK_SCOPES = 'user.info.basic,video.publish,video.upload';

async function getAccount(userId: string, accountId?: string) {
  if (accountId) {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (account && account.platform === 'TIKTOK') return account;
  }
  const defaultAccount = await prisma.socialAccount.findFirst({
    where: { userId, platform: 'TIKTOK', isDefault: true },
  });
  if (defaultAccount) return defaultAccount;
  return prisma.socialAccount.findFirst({ where: { userId, platform: 'TIKTOK' } });
}

export function getTikTokAuthUrl(clientKey: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `${TIKTOK_AUTH}?${params.toString()}`;
}

export interface TikTokTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
}

export async function exchangeTikTokCode(
  code: string,
  clientKey: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.error) {
    throw new Error(`TikTok token: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data as TikTokTokens;
}

export async function refreshTikTokToken(
  refreshToken: string,
  clientKey: string,
  clientSecret: string,
): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.error) {
    throw new Error(`TikTok refresh: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data as TikTokTokens;
}

/** Nome de exibicao do criador (usado no callback pra mostrar a conta conectada). */
export async function getTikTokUserInfo(accessToken: string): Promise<{ open_id?: string; display_name?: string }> {
  try {
    const res = await fetch(`${TIKTOK_API}/user/info/?fields=open_id,display_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as any;
    return data?.data?.user || {};
  } catch {
    return {};
  }
}

/** Garante um access token valido (o do TikTok expira em ~24h). */
async function ensureFreshToken(account: any, ownerId: string): Promise<string> {
  const notExpired = account.expiresAt && new Date(account.expiresAt).getTime() > Date.now() + 60_000;
  if (notExpired) return account.accessToken;
  if (!account.refreshToken) return account.accessToken; // sem refresh, tenta o que tem

  const keySetting = await prisma.setting.findUnique({ where: { userId_key: { userId: ownerId, key: 'TIKTOK_CLIENT_KEY' } } });
  const secretSetting = await prisma.setting.findUnique({ where: { userId_key: { userId: ownerId, key: 'TIKTOK_CLIENT_SECRET' } } });
  const clientKey = keySetting?.value || process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = secretSetting?.value || process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return account.accessToken;

  try {
    const t = await refreshTikTokToken(account.refreshToken, clientKey, clientSecret);
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token || account.refreshToken,
        expiresAt: new Date(Date.now() + (t.expires_in || 86400) * 1000),
        refreshedAt: new Date(),
      },
    });
    return t.access_token;
  } catch (e) {
    console.error('[TikTok] Falha ao renovar token:', (e as any)?.message);
    return account.accessToken;
  }
}

/**
 * Publica no TikTok.
 * - Post de VIDEO  -> /post/publish/video/init/   (PULL_FROM_URL)
 * - Post de IMAGEM -> /post/publish/content/init/ (photo mode)
 */
export async function publishToTikTok(postId: string, accountId?: string): Promise<{ id: string }> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { images: { orderBy: { order: 'asc' } } },
  });

  const account = await getAccount(post.userId, accountId);
  if (!account) throw new Error('Nenhuma conta TikTok conectada. Conecte em Configuracoes.');

  const accessToken = await ensureFreshToken(account, post.userId);

  // Privacidade: app NAO auditado pelo TikTok so aceita SELF_ONLY.
  const privSetting = await prisma.setting.findUnique({
    where: { userId_key: { userId: post.userId, key: 'TIKTOK_PRIVACY_LEVEL' } },
  });
  const privacyLevel = privSetting?.value || 'SELF_ONLY';

  const title = [post.caption, post.hashtags.map((h) => `#${h}`).join(' ')]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2200);

  const isVideo = post.mediaType === 'VIDEO' && !!post.videoUrl;
  const endpoint = isVideo ? `${TIKTOK_API}/post/publish/video/init/` : `${TIKTOK_API}/post/publish/content/init/`;

  let body: any;
  if (isVideo) {
    body = {
      post_info: {
        title,
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: { source: 'PULL_FROM_URL', video_url: post.videoUrl },
    };
  } else {
    const photos = (post.images?.length ? post.images.map((i) => i.imageUrl) : [post.imageUrl]).filter(Boolean) as string[];
    if (!photos.length) throw new Error('Post sem midia para o TikTok');
    body = {
      post_info: { title: title.slice(0, 90), description: title, privacy_level: privacyLevel },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: photos.slice(0, 35) },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    };
  }

  console.log(`[TikTok] Publicando ${isVideo ? 'VIDEO' : 'FOTO'} (privacy=${privacyLevel}) post=${postId}`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;

  const errCode = data?.error?.code;
  if (!res.ok || (errCode && errCode !== 'ok')) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    // erro classico de app sem auditoria
    if (String(msg).includes('privacy') || errCode === 'unaudited_client_can_only_post_to_private_account') {
      throw new Error(`TikTok: app ainda nao auditado — so permite post privado (SELF_ONLY). Detalhe: ${msg}`);
    }
    throw new Error(`TikTok: ${msg}`);
  }

  const publishId = data?.data?.publish_id;
  if (!publishId) throw new Error(`TikTok nao retornou publish_id: ${JSON.stringify(data).slice(0, 200)}`);
  return { id: String(publishId) };
}

/** Consulta o status de uma publicacao (o TikTok processa de forma assincrona). */
export async function getTikTokPublishStatus(accessToken: string, publishId: string): Promise<any> {
  const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }),
  });
  return (await res.json().catch(() => ({}))) as any;
}
