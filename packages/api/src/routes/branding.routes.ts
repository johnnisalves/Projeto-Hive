import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';

// White-label (#10): nome do app + logo + cor por conta (owner).
// Membros de equipe herdam o branding do owner. Guardado no Setting (key/value).
const router = Router();
router.use(authMiddleware);

const KEYS = ['wl_appName', 'wl_logoUrl', 'wl_primaryColor'];

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const rows = await prisma.setting.findMany({ where: { userId: ownerId, key: { in: KEYS } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    res.json({
      success: true,
      data: {
        appName: map.get('wl_appName') || null,
        logoUrl: map.get('wl_logoUrl') || null,
        primaryColor: map.get('wl_primaryColor') || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar branding' });
  }
});

const putSchema = z.object({
  appName: z.string().max(40).optional().nullable(),
  logoUrl: z.string().max(1000).optional().nullable(),
  primaryColor: z.string().max(20).optional().nullable(),
});

router.put('/', validate(putSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const entries: Array<[string, any]> = [
      ['wl_appName', req.body.appName],
      ['wl_logoUrl', req.body.logoUrl],
      ['wl_primaryColor', req.body.primaryColor],
    ];
    for (const [key, value] of entries) {
      if (value === undefined) continue; // campo nao enviado -> nao mexe
      if (value === null || value === '') {
        await prisma.setting.deleteMany({ where: { userId: ownerId, key } });
      } else {
        await prisma.setting.upsert({
          where: { userId_key: { userId: ownerId, key } },
          update: { value: String(value) },
          create: { userId: ownerId, key, value: String(value) },
        });
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao salvar branding' });
  }
});

export default router;
