import { Queue } from 'bullmq';
import { redis } from '../config/redis';

const publishQueue = new Queue('publish-queue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 }, // 30s, 60s, 120s
    removeOnComplete: 100,
    removeOnFail: 300,
  },
});

export async function schedulePost(postId: string, scheduledAt: Date) {
  const delay = scheduledAt.getTime() - Date.now();
  if (delay < 0) throw new Error('Scheduled time must be in the future');

  await publishQueue.add('publish', { postId }, { delay, jobId: `publish-${postId}` });
}

export async function cancelScheduledPost(postId: string) {
  const job = await publishQueue.getJob(`publish-${postId}`);
  if (job) await job.remove();
}

export async function reschedulePost(postId: string, newScheduledAt: Date) {
  await cancelScheduledPost(postId);
  await schedulePost(postId, newScheduledAt);
}

export { publishQueue };
