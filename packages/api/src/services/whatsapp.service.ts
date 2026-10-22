import { prisma } from '../config/database';
import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run, download } from './audio-mixer.service';

// build: force-recreate 2026-07-10 (regenera roteamento/rede apos outage)
/**
 * Publicacao no STATUS do WhatsApp via WuzAPI (github.com/asternic/wuzapi — whatsmeow).
 * Uma conexao guarda: host (ex: https://wapi.digitalcrm.com.br) + token da instancia.
 * O envio para o status usa o destino especial "status@broadcast".
 *
 * Endpoints WuzAPI usados:
 *   GET  /session/status        -> checa se a instancia esta logada
 *   POST /chat/send/image       -> body { Phone, Image (base64 data URI), Caption }
 *   POST /chat/send/video       -> body { Phone, Video (base64 data URI), Caption }
 * ATENCAO: WuzAPI exige a midia em base64 (data:...;base64,...), NAO aceita URL.
 */

// O Status aceita video de ate 60 s. Acima de ~10 MB o WhatsApp Web ja recusa;
// mirar abaixo disso evita depender do limite exato do servidor do WhatsApp.
const STATUS_VIDEO_MAX_BYTES = Math.round(9.5 * 1024 * 1024);
const STATUS_VIDEO_MAX_S = 59;

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

/**
 * Texto do Status de um video: so o 1o paragrafo da legenda, sem hashtags.
 * A legenda do Reels inteira (com hashtags) fica pesada por cima do video.
 */
export function legendaCurtaStatus(caption?: string | null): string {
  const primeiro = (caption || '').trim().split(/\n\s*\n/)[0] || '';
  const semTags = primeiro.split(/\s+/).filter((p) => !p.startsWith('#')).join(' ').trim();
  return semTags.slice(0, 700);
}

/** Bitrate de video (kbps) para caber o arquivo inteiro abaixo do limite do Status. */
export function bitrateStatusKbps(duracaoS: number): number {
  const alvoS = Math.min(Math.max(duracaoS, 1), STATUS_VIDEO_MAX_S);
  const totalKbps = (9 * 8 * 1024) / alvoS; // ~9 MB no total
  return Math.max(500, Math.min(2500, Math.floor(totalKbps - 128)));
}

/**
 * Baixa o video e, se passar de 59 s ou do limite de tamanho, recomprime
 * em 720p. O ffmpeg ja esta no container (ver audio-mixer.service).
 */
async function prepararVideoStatus(url: string): Promise<Buffer> {
  const workDir = path.join(os.tmpdir(), 'disparaai-wa-status', crypto.randomUUID());
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const src = path.join(workDir, 'origem.mp4');
    await download(url, src, 'video do Status');
    const duracao = Number((await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src,
    ], 30_000)).trim()) || 0;
    if (fs.statSync(src).size <= STATUS_VIDEO_MAX_BYTES && duracao > 0 && duracao <= STATUS_VIDEO_MAX_S + 0.5) {
      return fs.readFileSync(src);
    }
    const kbps = bitrateStatusKbps(duracao || STATUS_VIDEO_MAX_S);
    const out = path.join(workDir, 'status.mp4');
    await run('ffmpeg', [
      '-y', '-i', src, '-t', String(STATUS_VIDEO_MAX_S),
      '-vf', 'scale=min(720\\,iw):-2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.3)}k`,
      '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', out,
    ]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Publica a midia do post (video ou imagem) no Status do WhatsApp. */
export async function publishToWhatsappStatus(postId: string, connectionId?: string): Promise<{ id: string }> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { images: { orderBy: { order: 'asc' } } },
  });

  const conn = await resolveConnection(post.userId, connectionId);
  const base = normalizeHost(conn.host);

  let endpoint: string;
  let body: Record<string, string>;
  let tamanho: number;

  if (post.mediaType === 'VIDEO') {
    // Com trilha mixada, o arquivo certo e o mixado (o mesmo que foi para as redes).
    const videoUrl = post.mixedVideoUrl || post.videoUrl;
    if (!videoUrl) throw new Error('Post de video sem arquivo para o Status');
    const buf = await prepararVideoStatus(videoUrl);
    tamanho = buf.length;
    endpoint = '/chat/send/video';
    body = {
      Phone: 'status@broadcast',
      Video: `data:video/mp4;base64,${buf.toString('base64')}`,
      Caption: legendaCurtaStatus(post.caption),
    };
  } else {
    const imageUrl = post.imageUrl || (post.images && post.images[0]?.imageUrl);
    if (!imageUrl) throw new Error('Post nao tem imagem para o Status');
    const caption = [post.caption, post.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');

    // WuzAPI exige a imagem em base64 data URI (nao aceita URL). Baixa e converte.
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Falha ao baixar imagem para o Status (HTTP ${imgRes.status})`);
    let contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!/^image\/(jpe?g|png)$/i.test(contentType)) contentType = 'image/jpeg'; // WuzAPI aceita jpeg/png
    const buf = Buffer.from(await imgRes.arrayBuffer());
    tamanho = buf.length;
    endpoint = '/chat/send/image';
    body = {
      Phone: 'status@broadcast',
      Image: `data:${contentType};base64,${buf.toString('base64')}`,
      Caption: caption || '',
    };
  }

  console.log(`[WhatsApp] Publicando no Status via ${base}${endpoint} (conn=${conn.name}, ${Math.round(tamanho / 1024)}KB)`);
  const res = await fetch(`${base}${endpoint}`, {
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

// ============================================================
// Auto-provisionamento (cria a instancia no WuzAPI sozinho)
// O host + admin token do WuzAPI sao config da PLATAFORMA (do dono do SaaS),
// compartilhados por todos os tenants. Ficam em Setting sob o owner-plataforma.
// ============================================================

const WUZAPI_HOST_KEY = 'WUZAPI_HOST';
const WUZAPI_ADMIN_TOKEN_KEY = 'WUZAPI_ADMIN_TOKEN';
const DEFAULT_WUZAPI_HOST = 'https://wapi.digitalcrm.com.br';

/** Id do dono da plataforma (primeiro OWNER) — onde ficam as configs globais. */
async function getPlatformOwnerId(): Promise<string> {
  const first = await prisma.user.findFirst({
    where: { role: 'OWNER', ownerId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!first) throw new Error('Nenhum usuario dono da plataforma encontrado');
  return first.id;
}

async function getPlatformSetting(key: string): Promise<string | null> {
  const ownerId = await getPlatformOwnerId();
  const s = await prisma.setting.findUnique({ where: { userId_key: { userId: ownerId, key } } });
  return s?.value ?? null;
}

export async function setWuzapiAdminConfig(opts: { host?: string; adminToken?: string }): Promise<void> {
  const ownerId = await getPlatformOwnerId();
  const upsert = async (key: string, value: string) => {
    await prisma.setting.upsert({
      where: { userId_key: { userId: ownerId, key } },
      update: { value },
      create: { userId: ownerId, key, value },
    });
  };
  if (opts.host !== undefined && opts.host !== '') await upsert(WUZAPI_HOST_KEY, normalizeHost(opts.host));
  if (opts.adminToken !== undefined && opts.adminToken !== '') await upsert(WUZAPI_ADMIN_TOKEN_KEY, opts.adminToken);
}

/** Config publica (NUNCA retorna o admin token). */
export async function getWuzapiAdminConfigPublic(): Promise<{ host: string; hasAdminToken: boolean }> {
  const host = (await getPlatformSetting(WUZAPI_HOST_KEY)) || DEFAULT_WUZAPI_HOST;
  const adminToken = await getPlatformSetting(WUZAPI_ADMIN_TOKEN_KEY);
  return { host, hasAdminToken: !!adminToken };
}

/**
 * Cria uma instancia nova no WuzAPI via admin token e devolve host+token dela.
 * Usado pelo fluxo "clicar -> conectar" (sem colar token).
 */
export async function provisionWhatsappInstance(name: string): Promise<{ host: string; token: string }> {
  const host = (await getPlatformSetting(WUZAPI_HOST_KEY)) || DEFAULT_WUZAPI_HOST;
  const adminToken = await getPlatformSetting(WUZAPI_ADMIN_TOKEN_KEY);
  if (!adminToken) {
    throw new Error('WuzAPI admin token nao configurado na plataforma. Configure em Configuracoes (admin).');
  }
  const base = normalizeHost(host);
  const instanceToken = crypto.randomBytes(16).toString('hex');
  const safeName = (name || 'DisparaAI').slice(0, 60);

  const res = await fetch(`${base}/admin/users`, {
    method: 'POST',
    headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: safeName, token: instanceToken, events: 'Message', expiration: 0 }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(`WuzAPI /admin/users HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  // WuzAPI pode ecoar o token; garantimos o que enviamos
  const token = data?.data?.token || instanceToken;
  return { host: base, token };
}
