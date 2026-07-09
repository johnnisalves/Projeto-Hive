import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';

const tokenQueue = new Queue('token-refresh-queue', { connection: redis });

const DAY = 24 * 60 * 60 * 1000;

/**
 * Agenda o refresh de token: roda AGORA (no boot) e depois DIARIAMENTE.
 * (Antes rodava so a cada 50 dias e sem execucao imediata — risco de expirar calado.)
 */
export async function initTokenRefreshJob() {
  // Remove repeatables antigos (ex: o de 50 dias) pra aplicar a nova cadencia diaria
  const existing = await tokenQueue.getRepeatableJobs();
  for (const j of existing) {
    try { await tokenQueue.removeRepeatableByKey(j.key); } catch { /* ignore */ }
  }
  await tokenQueue.add('refresh', {}, { repeat: { every: DAY } });
  // Execucao imediata no boot (checa se algum token esta perto de expirar)
  await tokenQueue.add('refresh-now', {}, { removeOnComplete: true, removeOnFail: true });
}

export const tokenRefreshWorker = new Worker(
  'token-refresh-queue',
  async () => {
    const now = Date.now();
    const tokens = await prisma.instagramToken.findMany();

    for (const token of tokens) {
      // O endpoint ig_refresh_token so vale para tokens do Instagram Login (IGAA).
      // Tokens EAA (Facebook Business) usam outro fluxo — pulados aqui.
      if (!token.accessToken.startsWith('IGAA')) {
        continue;
      }

      const msToExpiry = new Date(token.expiresAt).getTime() - now;
      const ageMs = now - new Date(token.refreshedAt).getTime();

      // Renova quando falta < 15 dias pra expirar; regra do IG exige token com >= 24h de idade
      const closeToExpiry = msToExpiry < 15 * DAY;
      const oldEnough = ageMs >= DAY;
      if (!closeToExpiry || !oldEnough) continue;

      try {
        console.log(`[token-refresh] Renovando token ${token.id} (expira em ${Math.round(msToExpiry / DAY)} dias)`);
        const res = await fetch(
          `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token.accessToken}`,
        );
        const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: any };

        if (data.access_token) {
          await prisma.instagramToken.update({
            where: { id: token.id },
            data: {
              accessToken: data.access_token,
              expiresAt: new Date(now + (data.expires_in || 5184000) * 1000),
              refreshedAt: new Date(),
            },
          });
          console.log(`[token-refresh] Token ${token.id} renovado (+${Math.round((data.expires_in || 5184000) / 86400)} dias)`);
        } else {
          console.warn(`[token-refresh] Falha ao renovar ${token.id}:`, JSON.stringify(data).slice(0, 200));
        }
      } catch (err) {
        console.error(`[token-refresh] Erro ao renovar token ${token.id}:`, err);
      }
    }
  },
  { connection: redis },
);
