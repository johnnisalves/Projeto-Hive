import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { schedulePost } from '../services/scheduler.service';

// Evergreen (#9): republica automaticamente os melhores posts.
// Estrategia SEGURA: nao muta o post original. A cada varredura, CLONA o post
// marcado como evergreen (com a midia compartilhada, keepMedia=true pra nao apagar
// a midia do original) e agenda a publicacao do clone. Assim o original vira um
// "modelo" e cada rodada gera uma publicacao nova, preservando o historico.

const evergreenQueue = new Queue('evergreen-queue', { connection: redis });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function initEvergreenJob() {
  // Remove repeatables antigos pra aplicar a cadencia atual (varredura horaria)
  const existing = await evergreenQueue.getRepeatableJobs();
  for (const j of existing) {
    try { await evergreenQueue.removeRepeatableByKey(j.key); } catch { /* ignore */ }
  }
  await evergreenQueue.add('sweep', {}, { repeat: { every: HOUR } });
  // Varredura imediata no boot
  await evergreenQueue.add('sweep-now', {}, { removeOnComplete: true, removeOnFail: true });
}

export const evergreenWorker = new Worker(
  'evergreen-queue',
  async () => {
    const now = Date.now();
    const posts = await prisma.post.findMany({
      where: { isEvergreen: true, status: { in: ['PUBLISHED', 'PARTIAL'] as any } },
      include: { images: { orderBy: { order: 'asc' } } },
    });

    for (const post of posts as any[]) {
      const intervalMs = (post.evergreenIntervalDays || 7) * DAY;
      const last = post.evergreenLastRunAt || post.publishedAt || post.updatedAt;
      // Ainda dentro do intervalo -> pula
      if (last && now - new Date(last).getTime() < intervalMs) continue;

      const hasContent = !!(post.caption || post.imageUrl || post.videoUrl || (post.images && post.images.length));
      const platforms = (post.platforms as string[]) || [];

      // Sem conteudo ou sem plataforma: nao ha o que republicar; so marca a rodada
      if (!hasContent || platforms.length === 0) {
        await prisma.post.update({ where: { id: post.id }, data: { evergreenLastRunAt: new Date() } as any });
        continue;
      }

      try {
        const clone = await prisma.post.create({
          data: {
            caption: post.caption,
            imageUrl: post.imageUrl,
            imageSource: post.imageSource,
            nanoPrompt: post.nanoPrompt,
            hashtags: post.hashtags,
            aspectRatio: post.aspectRatio,
            isCarousel: post.isCarousel,
            mediaType: post.mediaType,
            publishMode: post.publishMode,
            videoUrl: post.videoUrl,
            videoMinioKey: post.videoMinioKey,
            keepMedia: true, // nao apaga a midia compartilhada com o original ao publicar
            platforms: post.platforms as any,
            brandId: post.brandId,
            userId: post.userId,
            source: post.source,
            status: 'SCHEDULED' as any,
            editorState: post.editorState as any,
            images: post.images && post.images.length
              ? {
                  create: post.images.map((im: any) => ({
                    imageUrl: im.imageUrl,
                    minioKey: im.minioKey,
                    order: im.order,
                    source: im.source,
                    prompt: im.prompt,
                  })),
                }
              : undefined,
          },
        });

        const runAt = new Date(now + 90 * 1000); // publica em ~90s
        await prisma.post.update({ where: { id: clone.id }, data: { scheduledAt: runAt } });
        await schedulePost(clone.id, runAt);
        await prisma.post.update({ where: { id: post.id }, data: { evergreenLastRunAt: new Date() } as any });

        console.log(`[evergreen] Republicando post ${post.id} -> clone ${clone.id} (a cada ${post.evergreenIntervalDays}d)`);
      } catch (err) {
        console.error(`[evergreen] Falha ao clonar post ${post.id}:`, (err as Error).message);
      }
    }
  },
  { connection: redis },
);
