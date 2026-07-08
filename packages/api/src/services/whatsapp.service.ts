import { prisma } from '../config/database';

/**
 * Publicacao no STATUS do WhatsApp via UAZ API (uazapi).
 * Uma conexao guarda: host (ex: https://digitalcrm.uazapi.com) + token da instancia.
 * O envio para o status usa o destino especial "status@broadcast".
 */

function normalizeHost(host: string): string {
  let h = (host || '').trim();
  if (!h) throw new Error('Host da conexao WhatsApp vazio');
  if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
  return h.replace(/\/+$/, '');
}

export interface WhatsappConn {
  id: string;
  name: string;
  host: string;
  token: string;
  phone?: string | null;
}

async function resolveConnection(userId: string, connectionId?: string): Promise<WhatsappConn> {
  const anyPrisma = prisma as any;
  let conn: WhatsappConn | null = null;
  if (connectionId) {
    conn = await anyPrisma.whatsappConnection.findFirst({ where: { id: connectionId, userId } });
  }
  if (!conn) {
    conn = await anyPrisma.whatsappConnection.findFirst({ where: { userId, isDefault: true } });
  }
  if (!conn) {
    conn = await anyPrisma.whatsappConnection.findFirst({ where: { userId } });
  }
  if (!conn) throw new Error('Nenhuma conexao WhatsApp configurada. Adicione em Configuracoes.');
  return conn;
}

/** Testa a conexao consultando o status da instancia na UAZ. */
export async function testWhatsappConnection(host: string, token: string): Promise<{ ok: boolean; detail?: string }> {
  const base = normalizeHost(host);
  try {
    const res = await fetch(`${base}/instance/status`, {
      method: 'GET',
      headers: { token, 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    }
    return { ok: true, detail: JSON.stringify(data).slice(0, 200) };
  } catch (err: any) {
    return { ok: false, detail: err?.message || 'Falha de rede' };
  }
}

/** Publica a imagem do post no Status do WhatsApp. */
export async function publishToWhatsappStatus(postId: string, connectionId?: string): Promise<{ id: string }> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { images: { orderBy: { order: 'asc' } } },
  });

  const imageUrl = post.imageUrl || (post.images && post.images[0]?.imageUrl);
  if (!imageUrl) throw new Error('Post nao tem imagem para o Status');

  const conn = await resolveConnection(post.userId, connectionId);
  const base = normalizeHost(conn.host);
  const caption = [post.caption, post.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');

  const body = {
    number: 'status@broadcast',
    type: 'image',
    file: imageUrl,
    text: caption || undefined,
  };

  console.log(`[WhatsApp] Publicando no Status via ${base}/send/media (conn=${conn.name})`);
  const res = await fetch(`${base}/send/media`, {
    method: 'POST',
    headers: { token: conn.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  console.log('[WhatsApp] Resposta UAZ:', JSON.stringify(data).slice(0, 400));

  if (!res.ok) {
    throw new Error(`UAZ retornou HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  // UAZ costuma retornar id/messageid; aceita variacoes
  const id = data?.id || data?.messageid || data?.messageId || data?.key?.id || 'status-ok';
  return { id: String(id) };
}
