import { prisma } from '../config/database';
import { env } from '../config/env';

// Inbox de comentarios do Instagram (#5).
// Le os comentarios das publicacoes recentes e permite responder pelo painel.
// Requer instagram_manage_comments (+ conta Business/Creator). Degrada com aviso claro.
// OBS: DMs (mensagens diretas) exigem instagram_manage_messages + webhooks (fora deste MVP).

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

async function getAccount(userId: string) {
  const account = await resolveIgAccount(userId);
  if (!account) throw new Error('Nenhuma conta do Instagram conectada. Conecte em Configuracoes.');
  return account;
}

export async function getInbox(userId: string) {
  const warnings: string[] = [];
  const account = await resolveIgAccount(userId);

  const result: any = { connected: !!account, username: account?.username || null, items: [], warnings };
  if (!account) {
    warnings.push('Nenhuma conta do Instagram conectada. Conecte em Configuracoes.');
    return result;
  }
  result.username = account.username;

  const base = graphBase(account.token);
  const tok = account.token;
  const uid = account.igUserId;

  // Publicacoes recentes com contagem de comentarios
  let media: any[] = [];
  try {
    const mr = await fetch(`${base}/${uid}/media?fields=id,caption,media_type,thumbnail_url,media_url,permalink,timestamp,comments_count&limit=25&access_token=${tok}`);
    const mj: any = await mr.json();
    if (mj.error) warnings.push(`Midia: ${mj.error.message}`);
    else media = (mj.data || []).filter((m: any) => (m.comments_count || 0) > 0);
  } catch (e: any) {
    warnings.push(`Midia: ${e?.message || 'falha ao consultar'}`);
  }

  const items: any[] = [];
  let commentFail = 0;
  let commentOk = 0;
  for (const m of media.slice(0, 15)) {
    try {
      const cr = await fetch(`${base}/${m.id}/comments?fields=id,text,username,timestamp,like_count,replies{id,text,username,timestamp}&limit=25&access_token=${tok}`);
      const cj: any = await cr.json();
      if (cj.error) { commentFail++; continue; }
      commentOk++;
      for (const c of cj.data || []) {
        items.push({
          id: c.id,
          text: c.text,
          username: c.username || null,
          timestamp: c.timestamp,
          likeCount: c.like_count || 0,
          repliesCount: c.replies?.data?.length || 0,
          media: {
            id: m.id,
            thumb: m.thumbnail_url || m.media_url || null,
            permalink: m.permalink,
            caption: (m.caption || '').slice(0, 80),
          },
        });
      }
    } catch {
      commentFail++;
    }
  }

  if (commentFail > 0 && commentOk === 0) {
    warnings.push('Comentarios indisponiveis: e preciso a permissao "instagram_manage_comments" e a conta ser Business/Creator.');
  }

  // Mais recentes primeiro
  items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  result.items = items;
  result.total = items.length;
  return result;
}

// DMs (mensagens diretas) — requer instagram_manage_messages + conta ligada a uma Pagina.
export async function getDMs(userId: string) {
  const warnings: string[] = [];
  const account = await resolveIgAccount(userId);
  const result: any = { connected: !!account, username: account?.username || null, items: [], warnings };
  if (!account) { warnings.push('Nenhuma conta do Instagram conectada.'); return result; }
  result.username = account.username;

  const base = graphBase(account.token);
  const tok = account.token;
  const uid = account.igUserId;

  try {
    const url = `${base}/${uid}/conversations?platform=instagram&fields=id,updated_time,participants,messages.limit(1){message,from,created_time}&limit=25&access_token=${tok}`;
    const r = await fetch(url);
    const j: any = await r.json();
    if (j.error) {
      warnings.push(`DMs indisponiveis: ${j.error.message}. E preciso a permissao "instagram_manage_messages" (aprovada no App Review da Meta) e a conta ligada a uma Pagina do Facebook.`);
      return result;
    }
    const items = (j.data || []).map((c: any) => {
      const other = (c.participants?.data || []).find((p: any) => String(p.id) !== String(uid)) || {};
      const last = c.messages?.data?.[0] || {};
      return {
        conversationId: c.id,
        userId: other.id || null,
        username: other.username || null,
        lastMessage: last.message || '',
        lastFromMe: last.from && String(last.from.id) === String(uid),
        updatedTime: c.updated_time,
      };
    });
    items.sort((a: any, b: any) => new Date(b.updatedTime || 0).getTime() - new Date(a.updatedTime || 0).getTime());
    result.items = items;
    result.total = items.length;
  } catch (e: any) {
    warnings.push(`DMs: ${e?.message || 'falha ao consultar'}`);
  }
  return result;
}

export async function replyDM(userId: string, recipientId: string, message: string) {
  const account = await getAccount(userId);
  const base = graphBase(account.token);
  const res = await fetch(`${base}/${account.igUserId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message }, access_token: account.token }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(json.error.message || 'Falha ao enviar DM');
  return json;
}

export async function replyToComment(userId: string, commentId: string, message: string) {
  const account = await getAccount(userId);
  const base = graphBase(account.token);
  const res = await fetch(`${base}/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: account.token }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(json.error.message || 'Falha ao responder comentario');
  return json;
}
