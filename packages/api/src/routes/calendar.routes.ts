import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { prisma } from '../config/database';
import { parseICS } from '../services/calendar-import.service';
import type { SocialPlatform } from '@prisma/client';

const router = Router();

const importSchema = z.object({
  icsContent: z.string().min(1),
  brandId: z.string().uuid().optional(),
  platforms: z.array(z.enum(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X'])).optional(),
});

router.use(authMiddleware);

router.post('/import', async (req, res) => {
  try {
    const { icsContent, brandId, platforms } = importSchema.parse(req.body);
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const events = parseICS(icsContent);
    if (events.length === 0) {
      res.json({ success: true, data: { imported: 0, postIds: [] } });
      return;
    }

    const postPlatforms: SocialPlatform[] = (platforms?.length ? platforms : ['INSTAGRAM']) as SocialPlatform[];

    const postIds: string[] = [];
    for (const event of events) {
      const caption = event.description
        ? `${event.title}\n\n${event.description}`
        : event.title;

      const post = await prisma.post.create({
        data: {
          caption,
          status: 'SCHEDULED',
          scheduledAt: event.startDateTime,
          platforms: postPlatforms,
          brandId: brandId || null,
          imageSource: 'NANOBANA',
          source: 'WEB',
          userId,
        },
      });
      postIds.push(post.id);
    }

    res.json({ success: true, data: { imported: postIds.length, postIds } });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors.map((e) => e.message).join(', ') });
      return;
    }
    console.error('[CalendarImport] Error:', err);
    res.status(500).json({ error: 'Failed to import calendar' });
  }
});

export default router;
