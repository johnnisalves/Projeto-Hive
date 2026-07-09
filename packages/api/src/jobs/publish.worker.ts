import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { publishToInstagram } from '../services/instagram.service';
import { publishToPlatforms } from '../services/social-publisher';
import { deleteObject } from '../services/storage.service';

// Erro-sentinela: publicacao parcial que ainda tem tentativas de retry restantes.
// O catch NAO sobrescreve o status quando recebe isto (preserva PARTIAL entre tentativas).
class RetryPartialError extends Error {}

export const publishWorker = new Worker(
  'publish-queue',
  async (job) => {
    const { postId, accountId } = job.data;

    const post = await prisma.post.update({
      where: { id: postId },
      data: { status: 'PUBLISHING' },
    });

    try {
      const platforms = post.platforms as string[];
      let publishedResults: Record<string, { id?: string; error?: string }> | null = null;

      if (platforms && platforms.length > 0 && !(platforms.length === 1 && platforms[0] === 'INSTAGRAM' && !post.publishedResults)) {
        publishedResults = await publishToPlatforms(postId, platforms as any[], accountId);
      } else {
        const result = await publishToInstagram(postId, accountId);
        publishedResults = { INSTAGRAM: { id: result.id } };
      }

      const allSucceeded = Object.values(publishedResults).every((r) => r.id);
      const someSucceeded = Object.values(publishedResults).some((r) => r.id);
      const errors = Object.entries(publishedResults)
        .filter(([, r]) => r.error)
        .map(([platform, r]) => `${platform}: ${r.error}`)
        .join('; ');

      const firstIgId = publishedResults.INSTAGRAM?.id || publishedResults.FACEBOOK?.id || null;

      // Status honesto: tudo ok = PUBLISHED; parte ok = PARTIAL; nada = FAILED
      const status = allSucceeded ? 'PUBLISHED' : someSucceeded ? 'PARTIAL' : 'FAILED';

      await prisma.post.update({
        where: { id: postId },
        data: {
          status: status as any,
          publishedAt: someSucceeded ? new Date() : null,
          instagramId: firstIgId,
          publishedResults: publishedResults as any,
          lastError: errors || null,
        },
      });

      // Se nao publicou em tudo e ainda ha tentativas de retry, re-tenta as que falharam
      // (a idempotencia em publishToPlatforms pula as que ja deram certo — sem duplicar post)
      const maxAttempts = job.opts?.attempts || 1;
      if (!allSucceeded && job.attemptsMade < maxAttempts - 1) {
        throw new RetryPartialError(errors || 'Publicacao incompleta');
      }

      // Auto-cleanup video from MinIO after successful publish (unless keepMedia=true)
      const updatedPost = await prisma.post.findUnique({
        where: { id: postId },
        select: { mediaType: true, videoMinioKey: true, keepMedia: true },
      });
      if (updatedPost?.mediaType === 'VIDEO' && updatedPost.videoMinioKey && !updatedPost.keepMedia) {
        try {
          await deleteObject(updatedPost.videoMinioKey);
          await prisma.post.update({
            where: { id: postId },
            data: { videoUrl: null, videoMinioKey: null },
          });
          console.log(`[publish.worker] Deleted video from MinIO: ${updatedPost.videoMinioKey}`);
        } catch (cleanupErr) {
          console.error(`[publish.worker] Failed to cleanup video for post ${postId}:`, cleanupErr);
        }
      }
    } catch (error: any) {
      // Retry planejado de publicacao parcial: status ja escrito (PARTIAL) — nao sobrescrever,
      // so re-lanca pro BullMQ retentar as plataformas que faltaram.
      if (error instanceof RetryPartialError) {
        console.warn(`[publish.worker] Post ${postId} parcial, re-tentando (tentativa ${job.attemptsMade + 1}/${job.opts?.attempts || 1})`);
        throw error;
      }
      const errorMsg = error?.message || String(error);
      console.error(`[publish.worker] Post ${postId} failed:`, errorMsg);
      await prisma.post.update({
        where: { id: postId },
        data: {
          status: 'FAILED',
          lastError: errorMsg.slice(0, 2000),
        },
      });
      throw error;
    }
  },
  {
    connection: redis,
    limiter: { max: 10, duration: 60000 },
  },
);
