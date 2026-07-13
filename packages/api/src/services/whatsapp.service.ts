import { prisma } from '../config/database';

// build: force-recreate 2026-07-10 (regenera roteamento/rede apos outage)
/**
 * Publicacao no STATUS do WhatsApp via WuzAPI (github.com/asternic/wuzapi — whatsmeow).
 * Uma conexao guarda: host (ex: https://wapi.digitalcrm.com.br) + token da instancia.
 * O envio para o status usa o destino especial "status@broadcast".
 *
 * Endpoints WuzAPI usados:
 *   GET  /session/status        -> checa se a instancia esta logada
 *   POST /chat/send/image       -> body { Phone, Image (base64 data URI), Caption }
 * ATENCAO: WuzAPI exige a imagem em base64 (data:image/...;base64,...), NAO aceita URL.
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

/** Testa a conexao consultando o status da sessao no WuzAPI. */
export async function testWhatsappConnection(host: string, token: string): Promise<{ ok: boolean; detail?: string }> {
  const base = normalizeHost(host);
  try {
    const res = await fetch(`${base}/session/status`, {
      method: 'GET',
      headers: { token, 'Content-Type': 'application/json' },
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    }
    const d = data?.data || data;
    const connected = d?.Connected ?? d?.connected;
    const loggedIn = d?.LoggedIn ?? d?.loggedIn;
    // Token valido (HTTP 200). Idealmente logado (LoggedIn=true).
    const ok = loggedIn !== false;
    return { ok, detail: `Connected=${connected} LoggedIn=${loggedIn}` };
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

  // WuzAPI exige a imagem em base64 data URI (nao aceita URL). Baixa e converte.
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Falha ao baixar imagem para o Status (HTTP ${imgRes.status})`);
  let contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!/^image\/(jpe?g|png)$/i.test(contentType)) contentType = 'image/jpeg'; // WuzAPI aceita jpeg/png
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const dataUri = `data:${contentType};base64,${buf.toString('base64')}`;

  const body = {
    Phone: 'status@broadcast',
    Image: dataUri,
    Caption: caption || '',
  };

  console.log(`[WhatsApp] Publicando no Status via ${base}/chat/send/image (conn=${conn.name}, ${Math.round(buf.length / 1024)}KB)`);
  const res = await fetch(`${base}/chat/send/image`, {
    method: 'POST',
    headers: { token: conn.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  console.log('[WhatsApp] Resposta WuzAPI:', JSON.stringify(data).slice(0, 400));

  if (!res.ok) {
    throw new Error(`WuzAPI retornou HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  // WuzAPI retorna { code, success, data: { Id, ... } }
  const d = data?.data || data;
  const id = d?.Id || d?.id || d?.messageid || d?.messageId || 'status-ok';
  return { id: String(id) };
}

// ============================================================
// Conexao por QR (dentro do proprio DisparaAI)
// ============================================================

/** Abre/garante o socket da instancia no WuzAPI (necessario antes de gerar o QR). */
export async function connectWhatsappSession(host: string, token: string): Promise<void> {
  const base = normalizeHost(host);
  try {
    await fetch(`${base}/session/connect`, {
      method: 'POST',
      headers: { token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Subscribe: ['Message'], Immediate: true }),
    });
  } catch {
    /* se ja estiver conectado o WuzAPI responde erro — ignoramos, o status dira a verdade */
  }
}

/** Status da sessao: loggedIn = numero vinculado; connected = socket aberto. */
export async function getWhatsappSessionStatus(
  host: string,
  token: string,
): Promise<{ loggedIn: boolean; connected: boolean; jid?: string | null }> {
  const base = normalizeHost(host);
  const res = await fetch(`${base}/session/status`, {
    method: 'GET',
    headers: { token, 'Content-Type': 'application/json' },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  const d = data?.data || data || {};
  return {
    loggedIn: (d.LoggedIn ?? d.loggedIn) === true,
    connected: (d.Connected ?? d.connected) === true,
    jid: d.jid ?? d.Jid ?? null,
  };
}

/** Retorna o QR atual (data URI base64) para escanear. null se ja logado / sem QR. */
export async function getWhatsappQr(host: string, token: string): Promise<{ qr: string | null }> {
  const base = normalizeHost(host);
  const res = await fetch(`${base}/session/qr`, {
    method: 'GET',
    headers: { token, 'Content-Type': 'application/json' },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  const d = data?.data || data || {};
  const qr = d.QRCode || d.qrcode || d.qr || null;
  return { qr: typeof qr === 'string' && qr.startsWith('data:') ? qr : null };
}

/** Desloga a instancia (libera o vinculo do numero). */
export async function logoutWhatsappSession(host: string, token: string): Promise<void> {
  const base = normalizeHost(host);
  try {
    await fetch(`${base}/session/logout`, { method: 'POST', headers: { token } });
  } catch {
    /* ignore */
  }
}
