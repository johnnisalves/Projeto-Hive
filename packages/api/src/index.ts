import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { prisma } from './config/database';
import { initMinio } from './config/minio';
import { apiLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth.routes';
import postRoutes from './routes/post.routes';
import igContactsRoutes from './routes/ig-contacts.routes';
import webhooksRoutes from './routes/webhooks.routes';
import approvalRoutes, { approvalLinksRouter } from './routes/approval.routes';
import competitorsRoutes from './routes/competitors.routes';
import bioRoutes, { bioAdminRouter } from './routes/bio.routes';
import generateRoutes from './routes/generate.routes';
import uploadRoutes from './routes/upload.routes';
import taskRoutes from './routes/task.routes';
import projectRoutes from './routes/project.routes';
import teamRoutes from './routes/team.routes';
import funnelRoutes from './routes/funnel.routes';
import videoRoutes from './routes/video.routes';
import settingsRoutes from './routes/settings.routes';
import instagramRoutes from './routes/instagram.routes';
import socialAccountRoutes from './routes/social-account.routes';
import brandRoutes from './routes/brand.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import calendarRoutes from './routes/calendar.routes';
import designSystemsRoutes from './routes/designSystems.routes';
import analyticsRoutes from './routes/analytics.routes';
import inboxRoutes from './routes/inbox.routes';
import brandingRoutes from './routes/branding.routes';
import billingRoutes from './routes/billing.routes';
import { publishWorker } from './jobs/publish.worker';
import { tokenRefreshWorker, initTokenRefreshJob } from './jobs/token-refresh.worker';
import { taskReminderWorker } from './jobs/task-reminder.worker';
import { evergreenWorker, initEvergreenJob } from './jobs/evergreen.worker';

const app = express();

// A api roda atras do Traefik. Sem isso, req.ip vira o IP do PROXY para todo mundo
// e o rate limiter passa a contar TODOS os usuarios num balde unico (um usuario
// derrubava o login de todos). Com trust proxy, cada cliente tem seu proprio limite.
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
// rawBody guardado para validar a assinatura dos webhooks da Meta: o HMAC
// e calculado sobre os bytes exatos que chegaram, e depois do JSON.parse
// nao da mais para reconstruir (ordem de chaves e espacos mudam).
app.use(express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));
app.use(apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/ig-contacts', igContactsRoutes);
// Publico: a Meta chama sem autenticacao nossa (assinatura validada dentro)
app.use('/api/webhooks', webhooksRoutes);
// Publico: o cliente da agencia acessa por token, sem login
app.use('/api/approval', approvalRoutes);
app.use('/api/approval-links', approvalLinksRouter);
app.use('/api/competitors', competitorsRoutes);
// Publico: pagina de link-in-bio que o seguidor abre
app.use('/api/bio', bioRoutes);
app.use('/api/bio-admin', bioAdminRouter);
app.use('/api/generate', generateRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/funnels', funnelRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/social-accounts', socialAccountRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/design-systems', designSystemsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/billing', billingRoutes);

// Health check with env diagnostics
app.get('/api/health', (_req, res) => {
  const mask = (v?: string) => v ? `${v.slice(0, 6)}...${v.slice(-4)} (${v.length} chars)` : 'NOT SET';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      NANO_BANANA_API_KEY: mask(env.NANO_BANANA_API_KEY),
      MINIO_ENDPOINT: env.MINIO_ENDPOINT,
      MINIO_PORT: env.MINIO_PORT,
      MINIO_ACCESS_KEY: env.MINIO_ACCESS_KEY,
      MINIO_SECRET_KEY: env.MINIO_SECRET_KEY,
      MINIO_USE_SSL: env.MINIO_USE_SSL,
      MINIO_PUBLIC_URL: env.MINIO_PUBLIC_URL,
      DATABASE_URL: env.DATABASE_URL ? 'SET' : 'NOT SET',
      REDIS_URL: env.REDIS_URL ? 'SET' : 'NOT SET',
      INSTAGRAM_ACCESS_TOKEN: mask(env.INSTAGRAM_ACCESS_TOKEN),
      JWT_SECRET: env.JWT_SECRET ? 'SET' : 'NOT SET',
      INTERNAL_SERVICE_TOKEN: env.INTERNAL_SERVICE_TOKEN ? 'SET' : 'NOT SET',
    },
  });
});

// Diagnostic: test Gemini API key from this server
app.get('/api/diag/gemini', async (_req, res) => {
  const key = env.NANO_BANANA_API_KEY;
  if (!key) {
    res.json({ success: false, error: 'NANO_BANANA_API_KEY not set' });
    return;
  }
  try {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const r = await fetch(testUrl);
    const data = await r.json();
    if (!r.ok) {
      res.json({ success: false, status: r.status, error: data, keyPrefix: key.slice(0, 8) });
    } else {
      res.json({ success: true, modelsCount: (data as any).models?.length || 0, keyPrefix: key.slice(0, 8) });
    }
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// Instagram status
app.get('/api/instagram/status', (_req, res) => {
  const configured = !!(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID);
  res.json({ success: true, data: { connected: configured } });
});

// Instagram profile + recent media (tries Business API first, then Instagram API)
app.get('/api/instagram/profile', async (_req, res) => {
  const accountId = _req.query.accountId as string | undefined;

  let token = env.INSTAGRAM_ACCESS_TOKEN;
  let igUserId = env.INSTAGRAM_USER_ID;

  // If accountId provided, look up from database
  if (accountId && accountId !== 'env') {
    try {
      const account = await prisma.instagramToken.findUnique({ where: { id: accountId } });
      if (account) {
        token = account.accessToken;
        igUserId = account.instagramUserId;
      }
    } catch {}
  }

  if (!token) {
    res.json({ success: false, error: 'Instagram not configured' });
    return;
  }
  try {
    // Try Business API first (graph.facebook.com) - works with EAA tokens
    if (igUserId) {
      const fbBase = 'https://graph.facebook.com/v21.0';
      const profileRes = await fetch(`${fbBase}/${igUserId}?fields=id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,website&access_token=${token}`);
      const profile = await profileRes.json() as any;
      if (!profile.error) {
        const mediaRes = await fetch(`${fbBase}/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=12&access_token=${token}`);
        const media = await mediaRes.json() as any;
        // Fetch thumbnail for videos/reels — prioritize thumbnail_url for video types
        const normalizedMedia = await Promise.all((media.data || []).map(async (m: any) => {
          const isVideo = m.media_type === 'VIDEO' || m.media_type === 'REEL';
          let url = isVideo ? (m.thumbnail_url || m.media_url || null) : (m.media_url || m.thumbnail_url || null);
          if (!url && isVideo) {
            try {
              const videoRes = await fetch(`${fbBase}/${m.id}?fields=thumbnail_url,media_url&access_token=${token}`);
              const videoData = await videoRes.json() as any;
              url = videoData.thumbnail_url || videoData.media_url || null;
            } catch {}
          }
          return { ...m, like_count: m.like_count ?? 0, comments_count: m.comments_count ?? 0, media_url: url };
        }));
        res.json({ success: true, data: { profile, recentMedia: normalizedMedia } });
        return;
      }
      console.log('[Instagram] Business API failed, trying Instagram API:', profile.error.message);
    }

    // Fallback: Instagram API (graph.instagram.com) - works with IGAA tokens
    const igBase = 'https://graph.instagram.com/v21.0';
    const [profileRes, mediaRes] = await Promise.all([
      fetch(`${igBase}/me?fields=id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website&access_token=${token}`),
      fetch(`${igBase}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=12&access_token=${token}`),
    ]);
    const profile = await profileRes.json() as any;
    const media = await mediaRes.json() as any;
    if (profile.error) {
      console.error('[Instagram] Both APIs failed:', profile.error.message);
      res.json({ success: false, error: profile.error.message });
      return;
    }

    // Normalize media data + fetch thumbnails for videos — prioritize thumbnail_url for video types
    const igBase2 = 'https://graph.instagram.com/v21.0';
    const normalizedMedia = await Promise.all((media.data || []).map(async (m: any) => {
      const isVideo = m.media_type === 'VIDEO' || m.media_type === 'REEL';
      let url = isVideo ? (m.thumbnail_url || m.media_url || null) : (m.media_url || m.thumbnail_url || null);
      if (!url && (isVideo || m.media_type === 'CAROUSEL_ALBUM')) {
        try {
          const extraRes = await fetch(`${igBase2}/${m.id}?fields=thumbnail_url,media_url&access_token=${token}`);
          const extraData = await extraRes.json() as any;
          url = extraData.thumbnail_url || extraData.media_url || null;
        } catch {}
      }
      return { ...m, like_count: m.like_count ?? 0, comments_count: m.comments_count ?? 0, media_url: url };
    }));

    console.log('[Instagram] Profile:', JSON.stringify({ id: profile.id, username: profile.username, followers: profile.followers_count, media_count: profile.media_count }));
    console.log('[Instagram] Media count returned:', normalizedMedia.length);
    normalizedMedia.slice(0, 3).forEach((m: any) => {
      console.log(`[Instagram] Media ${m.id}: type=${m.media_type}, likes=${m.like_count}, comments=${m.comments_count}, has_url=${!!m.media_url}`);
    });

    res.json({ success: true, data: { profile, recentMedia: normalizedMedia } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch Instagram data' });
  }
});

function logConfig() {
  const mask = (v?: string) => v ? `${v.slice(0, 6)}...${v.slice(-4)}` : 'NOT SET';
  console.log('=== DisparaAI API Config ===');
  console.log('NANO_BANANA_API_KEY:', mask(env.NANO_BANANA_API_KEY));
  console.log('MINIO_ENDPOINT:', env.MINIO_ENDPOINT);
  console.log('MINIO_PUBLIC_URL:', env.MINIO_PUBLIC_URL);
  console.log('NANO_BANANA_PROVIDER:', env.NANO_BANANA_PROVIDER);
  console.log('============================');
}

async function ensureBrandColumns() {
  // Idempotently ensure new Brand columns exist (migrations are not auto-applied on this deploy).
  // Uses the query engine (always present) via raw SQL — safe on existing data.
  const stmts = [
    'ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "phone" TEXT',
    'ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "artDirection" TEXT',
    // SocialAccount.brandId (schema evoluiu; sem isso o publish quebra com prisma.socialAccount.findFirst)
    'ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "brandId" TEXT',
    'CREATE INDEX IF NOT EXISTS "SocialAccount_brandId_idx" ON "SocialAccount"("brandId")',
    // WhatsappConnection (Status do WhatsApp via UAZ)
    'CREATE TABLE IF NOT EXISTS "WhatsappConnection" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "host" TEXT NOT NULL, "token" TEXT NOT NULL, "phone" TEXT, "isDefault" BOOLEAN NOT NULL DEFAULT false, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE INDEX IF NOT EXISTS "WhatsappConnection_userId_idx" ON "WhatsappConnection"("userId")',
    // Status PARTIAL (publicacao parcial multi-plataforma)
    `ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'PARTIAL'`,
    // Fila de aprovacao (#2): none | pending | approved | rejected
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "approvalState" TEXT NOT NULL DEFAULT 'none'`,
    // Evergreen (#9): republicacao recorrente dos melhores posts
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isEvergreen" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "evergreenIntervalDays" INTEGER NOT NULL DEFAULT 7`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "evergreenLastRunAt" TIMESTAMP(3)`,
    // WhatsApp Status como alvo de publicacao (junto de IG/FB)
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "sendWhatsappStatus" BOOLEAN NOT NULL DEFAULT false`,
    // TikTok como plataforma de publicacao
    `ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'TIKTOK'`,
    // Recursos de publicacao do Instagram (marcacao, colaboradores, publi, audio)
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "userTags" JSONB`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "collaborators" TEXT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "locationId" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "altText" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "shareToFeed" BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "audioName" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "thumbOffsetMs" INTEGER`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isAiGenerated" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isPaidPartnership" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "sponsorIds" TEXT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "audioUrl" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "audioVolume" INTEGER`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "mixedVideoUrl" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isTrialReel" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "pilar" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "hashtagsFirstComment" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "mixVender" INTEGER NOT NULL DEFAULT 3`,
    `ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "mixEducar" INTEGER NOT NULL DEFAULT 4`,
    `ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "mixEngajar" INTEGER NOT NULL DEFAULT 3`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "recycledFromId" TEXT`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "recycledAt" TIMESTAMP(3)`,
    // Radar de tendencias: controle da cota de 30 hashtags por semana
    `CREATE TABLE IF NOT EXISTS "HashtagQuery" ("id" TEXT PRIMARY KEY, "tag" TEXT NOT NULL, "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "userId" TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "HashtagQuery_userId_queriedAt_idx" ON "HashtagQuery"("userId", "queriedAt")`,
    // Link-in-bio por marca
    `ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "bioSlug" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Brand_bioSlug_key" ON "Brand"("bioSlug")`,
    `CREATE TABLE IF NOT EXISTS "BioLink" ("id" TEXT PRIMARY KEY, "label" TEXT NOT NULL, "url" TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true, "clicks" INTEGER NOT NULL DEFAULT 0, "brandId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS "BioLink_brandId_idx" ON "BioLink"("brandId")`,
    // Radar de concorrentes
    `CREATE TABLE IF NOT EXISTS "Competitor" ("id" TEXT PRIMARY KEY, "username" TEXT NOT NULL, "displayName" TEXT, "followers" INTEGER, "mediaCount" INTEGER, "prevFollowers" INTEGER, "prevMediaCount" INTEGER, "postsLast30" INTEGER, "avgLikes" INTEGER, "lastCheckedAt" TIMESTAMP(3), "lastError" TEXT, "brandId" TEXT, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Competitor_userId_username_key" ON "Competitor"("userId", "username")`,
    `CREATE INDEX IF NOT EXISTS "Competitor_userId_idx" ON "Competitor"("userId")`,
    // Portal de aprovacao do cliente: token na marca + comentarios do post
    `ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "approvalToken" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Brand_approvalToken_key" ON "Brand"("approvalToken")`,
    `CREATE TABLE IF NOT EXISTS "PostFeedback" ("id" TEXT PRIMARY KEY, "message" TEXT NOT NULL, "author" TEXT, "fromOwner" BOOLEAN NOT NULL DEFAULT false, "postId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS "PostFeedback_postId_idx" ON "PostFeedback"("postId")`,
    // Threads como plataforma de publicacao
    `ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'THREADS'`,
    // Agenda de @ para o autocomplete de marcacao/colaborador/patrocinador
    `CREATE TABLE IF NOT EXISTS "IgContact" ("id" TEXT PRIMARY KEY, "username" TEXT NOT NULL, "displayName" TEXT, "verifiedAt" TIMESTAMP(3), "followers" INTEGER, "useCount" INTEGER NOT NULL DEFAULT 1, "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IgContact_userId_username_key" ON "IgContact"("userId", "username")`,
    `CREATE INDEX IF NOT EXISTS "IgContact_userId_idx" ON "IgContact"("userId")`,
  ];
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      console.warn('[boot] ensureBrandColumns:', sql, (err as Error).message);
    }
  }
  console.log('[boot] Brand columns ensured');
}

function start() {
  logConfig();

  // Sobe o servidor HTTP IMEDIATAMENTE. Nenhum init de background pode travar a API:
  // se ensureBrandColumns/initMinio/initTokenRefreshJob pendurar (ex: Redis/BullMQ
  // reconectando, ALTER esperando lock), este app.listen garante que /api responde.
  // Bind explicito em IPv4 0.0.0.0: sem isso, o Node bindava so em IPv6 (::) e o
  // container web (que resolve api:3001 por IPv4) recebia ECONNREFUSED -> 500 em /api.
  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`DisparaAI API running on 0.0.0.0:${env.PORT}`);
  });

  publishWorker.on('failed', (job, err) => {
    console.error(`Publish job ${job?.id} failed:`, err.message);
  });

  tokenRefreshWorker.on('failed', (job, err) => {
    console.error(`Token refresh job ${job?.id} failed:`, err.message);
  });

  taskReminderWorker.on('failed', (job, err) => {
    console.error(`Task reminder job ${job?.id} failed:`, err.message);
  });

  evergreenWorker.on('failed', (job, err) => {
    console.error(`Evergreen job ${job?.id} failed:`, err.message);
  });

  // Inits de background — NAO bloqueiam o listen; erros/hangs aqui nao derrubam a API.
  ensureBrandColumns()
    .catch((err) => console.warn('[boot] ensureBrandColumns failed (continuing):', (err as Error).message));

  initMinio()
    .then(() => console.log('MinIO initialized'))
    .catch((err) => console.warn('MinIO initialization failed (uploads will not work):', (err as Error).message));

  initTokenRefreshJob()
    .then(() => console.log('Token refresh job scheduled'))
    .catch((err) => console.warn('Token refresh job failed to start:', (err as Error).message));

  initEvergreenJob()
    .then(() => console.log('Evergreen job scheduled'))
    .catch((err) => console.warn('Evergreen job failed to start:', (err as Error).message));
}

start();
