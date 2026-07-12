import { prisma } from '../config/database';
import { env } from '../config/env';

// Analytics REAIS do Instagram (#1).
// Estrategia em camadas de permissao:
//  - instagram_basic (sempre que a conta esta conectada): seguidores, media_count,
//    likes e comentarios por post, engajamento, top posts, frequencia. 100% real.
//  - instagram_manage_insights (+ conta Business/Creator): alcance/impressoes por post.
//    Se faltar, degrada com um aviso claro do que habilitar — nao quebra o resto.

function graphBase(token: string): string {
  return token.startsWith('EAA')
    ? 'https://graph.facebook.com/v21.0'
    : 'https://graph.instagram.com/v21.0';
}

async function resolveIgAccount(userId: string) {
  let acc = await prisma.instagramToken.findFirst({ where: { userId, isDefault: true } });
  if (!acc) acc = await prisma.instagramToken.findFirst({ where: { userId } });
  if (acc) return { token: acc.accessToken, igUserId: acc.instagramUserId, username: acc.username };
  if (env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID) {
    return { token: env.INSTAGRAM_ACCESS_TOKEN, igUserId: env.INSTAGRAM_USER_ID, username: null as string | null };
  }
  return null;
}

export async function getInstagramAnalytics(userId: string, period: string = '30d') {
  const warnings: string[] = [];
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

  // Estatisticas do proprio sistema (sempre disponiveis)
  const [publishedCount, scheduledCount, totalCount] = await Promise.all([
    prisma.post.count({ where: { userId, status: 'PUBLISHED' as any } }),
    prisma.post.count({ where: { userId, status: 'SCHEDULED' as any } }),
    prisma.post.count({ where: { userId } }),
  ]);

  const result: any = {
    connected: false,
    username: null,
    period,
    db: { published: publishedCount, scheduled: scheduledCount, total: totalCount },
    profile: null,
    totals: null,
    topPosts: [],
    recentMedia: [],
    warnings,
  };

  const account = await resolveIgAccount(userId);
  if (!account) {
    warnings.push('Nenhuma conta do Instagram conectada. Conecte em Configuracoes para ver metricas reais.');
    return result;
  }
  result.connected = true;
  result.username = account.username;

  const base = graphBase(account.token);
  const tok = account.token;
  const uid = account.igUserId;

  // Perfil: seguidores + media_count (instagram_basic)
  try {
    const pr = await fetch(`${base}/${uid}?fields=username,followers_count,media_count,name,profile_picture_url&access_token=${tok}`);
    const pj: any = await pr.json();
    if (pj.error) warnings.push(`Perfil: ${pj.error.message}`);
    else {
      result.profile = pj;
      if (pj.username) result.username = pj.username;
    }
  } catch (e: any) {
    warnings.push(`Perfil: ${e?.message || 'falha ao consultar'}`);
  }

  // Midia recente com likes/comentarios (instagram_basic)
  let media: any[] = [];
  try {
    const sinceSec = Math.floor((Date.now() - days * 86400000) / 1000);
    const mr = await fetch(`${base}/${uid}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url&limit=50&access_token=${tok}`);
    const mj: any = await mr.json();
    if (mj.error) warnings.push(`Midia: ${mj.error.message}`);
    else {
      media = (mj.data || []).filter((m: any) => !m.timestamp || new Date(m.timestamp).getTime() / 1000 >= sinceSec);
    }
  } catch (e: any) {
    warnings.push(`Midia: ${e?.message || 'falha ao consultar'}`);
  }

  // Alcance por post (instagram_manage_insights) — degrada se faltar permissao
  let insightsOk = 0;
  let insightsFail = 0;
  for (const m of media.slice(0, 12)) {
    m.engagement = (m.like_count || 0) + (m.comments_count || 0);
    try {
      const ir = await fetch(`${base}/${m.id}/insights?metric=reach&access_token=${tok}`);
      const ij: any = await ir.json();
      if (ij.error) {
        insightsFail++;
      } else {
        const v = ij.data?.[0]?.values?.[0]?.value ?? ij.data?.[0]?.total_value?.value;
        if (v != null) { m.reach = v; insightsOk++; }
      }
    } catch {
      insightsFail++;
    }
  }
  if (insightsFail > 0 && insightsOk === 0) {
    warnings.push('Alcance/impressoes indisponiveis: e preciso a permissao "instagram_manage_insights" e a conta ser Business/Creator. Seguidores, likes e comentarios ja sao reais.');
  }

  // Totais e engajamento
  const totalLikes = media.reduce((s, m) => s + (m.like_count || 0), 0);
  const totalComments = media.reduce((s, m) => s + (m.comments_count || 0), 0);
  const followers = result.profile?.followers_count || 0;
  const postCount = media.length;
  const avgEng = postCount ? (totalLikes + totalComments) / postCount : 0;

  result.totals = {
    followers,
    mediaCount: result.profile?.media_count ?? postCount,
    postsInPeriod: postCount,
    totalLikes,
    totalComments,
    avgEngagementPerPost: Math.round(avgEng * 10) / 10,
    engagementRate: followers ? Math.round((avgEng / followers) * 10000) / 100 : null, // %
    reachTracked: insightsOk > 0,
  };

  result.topPosts = [...media]
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      caption: (m.caption || '').slice(0, 120),
      permalink: m.permalink,
      thumb: m.thumbnail_url || m.media_url || null,
      likes: m.like_count || 0,
      comments: m.comments_count || 0,
      reach: m.reach ?? null,
      mediaType: m.media_type,
      timestamp: m.timestamp,
    }));

  result.recentMedia = media.slice(0, 12).map((m) => ({
    id: m.id,
    thumb: m.thumbnail_url || m.media_url || null,
    likes: m.like_count || 0,
    comments: m.comments_count || 0,
    reach: m.reach ?? null,
    permalink: m.permalink,
    timestamp: m.timestamp,
    mediaType: m.media_type,
  }));

  return result;
}
