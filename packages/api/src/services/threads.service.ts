import { prisma } from '../config/database';

/**
 * Threads (Meta) — API oficial, gratuita.
 *
 * Mesmo modelo de container do Instagram, em outro host:
 *   1. POST /me/threads          -> cria o container, devolve creation_id
 *   2. POST /me/threads_publish  -> publica
 *
 * Diferencas que importam:
 *  - host proprio (graph.threads.net), token proprio, escopos proprios
 *  - texto sozinho e valido (no Instagram, midia e obrigatoria)
 *  - teto de 250 publicacoes por 24h
 *  - crossreshare_to_ig republica no Instagram automaticamente
 */

const THREADS_API = 'https://graph.threads.net/v1.0';
const THREADS_AUTH = 'https://threads.net/oauth/authorize';
const THREADS_SCOPES = 'threads_basic,threads_content_publish';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAccount(userId: string, accountId?: string) {
  if (accountId) {
    const a = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (a && a.platform === 'THREADS') return a;
  }
  const padrao = await prisma.socialAccount.findFirst({
    where: { userId, platform: 'THREADS', isDefault: true },
  });
  if (padrao) return padrao;
  return prisma.socialAccount.findFirst({ where: { userId, platform: 'THREADS' } });
}

export function getThreadsAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: THREADS_SCOPES,
    response_type: 'code',
    state,
  });
  return `${THREADS_AUTH}?${params.toString()}`;
}

export interface ThreadsTokens {
  access_token: string;
  user_id?: string;
  expires_in?: number;
}

/** Troca o code por token curto e ja converte no de 60 dias. */
export async function exchangeThreadsCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<ThreadsTokens> {
  const res = await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.error) {
    throw new Error(`Threads token: ${data.error_message || data.error?.message || `HTTP ${res.status}`}`);
  }

  // O token curto vale 1 hora. Trocamos pelo longo (60 dias) na hora, senao
  // a conta para de publicar sozinha depois do primeiro uso.
  try {
    const longo = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token`
      + `&client_secret=${encodeURIComponent(clientSecret)}`
      + `&access_token=${encodeURIComponent(data.access_token)}`,
    );
    const lj = (await longo.json()) as any;
    if (lj?.access_token) {
      return { access_token: lj.access_token, user_id: String(data.user_id || ''), expires_in: lj.expires_in };
    }
  } catch { /* fica com o curto; melhor publicar hoje do que falhar agora */ }

  return { access_token: data.access_token, user_id: String(data.user_id || '') };
}

export async function getThreadsUserInfo(accessToken: string): Promise<{ id?: string; username?: string }> {
  const res = await fetch(`${THREADS_API}/me?fields=id,username&access_token=${accessToken}`);
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(data.error.message);
  return { id: data.id, username: data.username };
}

/** O container de video leva alguns segundos para ficar pronto. */
async function aguardarContainer(containerId: string, token: string, tentativas = 20) {
  for (let i = 0; i < tentativas; i++) {
    await sleep(3000);
    const res = await fetch(`${THREADS_API}/${containerId}?fields=status,error_message&access_token=${token}`);
    const data = (await res.json()) as any;
    if (data?.status === 'FINISHED') return;
    if (data?.status === 'ERROR' || data?.status === 'EXPIRED') {
      throw new Error(`Threads: container ${data.status} — ${data.error_message || 'sem detalhe'}`);
    }
  }
  throw new Error('Threads: o container nao ficou pronto a tempo');
}

/**
 * Publica no Threads.
 *
 * Aceita texto puro, imagem ou video. Carrossel existe na API mas exige
 * containers filhos; ficou de fora por enquanto — o DisparaAI manda a
 * primeira imagem e a legenda, que cobre o caso comum.
 */
export async function publishToThreads(postId: string, accountId?: string): Promise<{ id: string }> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { images: { orderBy: { order: 'asc' } } },
  });

  const account = await getAccount(post.userId, accountId);
  if (!account) throw new Error('Nenhuma conta do Threads conectada. Conecte em Configuracoes.');

  const token = account.accessToken;
  const texto = [post.caption, post.hashtags.map((h) => `#${h}`).join(' ')]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 500); // o Threads corta em 500 caracteres

  const videoUrl = post.mixedVideoUrl || post.videoUrl;
  const imagemUrl = post.imageUrl || post.images?.[0]?.imageUrl;

  const params = new URLSearchParams({ access_token: token });
  if (texto) params.append('text', texto);

  let precisaEsperar = false;
  if (post.mediaType === 'VIDEO' && videoUrl) {
    params.append('media_type', 'VIDEO');
    params.append('video_url', videoUrl);
    precisaEsperar = true;
  } else if (imagemUrl) {
    params.append('media_type', 'IMAGE');
    params.append('image_url', imagemUrl);
  } else if (texto) {
    // Texto sozinho e valido aqui — diferente do Instagram.
    params.append('media_type', 'TEXT');
  } else {
    throw new Error('Post sem texto nem midia para o Threads');
  }

  console.log(`[Threads] Criando container para o post ${postId}...`);
  const criar = await fetch(`${THREADS_API}/me/threads`, { method: 'POST', body: params });
  const criado = (await criar.json()) as any;
  if (!criado?.id) throw new Error(`Threads: falha ao criar container — ${JSON.stringify(criado).slice(0, 200)}`);

  if (precisaEsperar) await aguardarContainer(criado.id, token);

  const publicar = await fetch(`${THREADS_API}/me/threads_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: criado.id, access_token: token }),
  });
  const resultado = (await publicar.json()) as any;
  if (!resultado?.id) throw new Error(`Threads: falha ao publicar — ${JSON.stringify(resultado).slice(0, 200)}`);

  console.log(`[Threads] Publicado: ${resultado.id}`);
  return { id: resultado.id };
}
