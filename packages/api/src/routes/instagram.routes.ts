import { Router } from 'express';
import { z } from 'zod';
import { Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { env } from '../config/env';

const router = Router();
router.use(authMiddleware);

// GET /api/instagram/accounts - List all Instagram accounts
router.get('/accounts', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);

    // Auto-migrate: if env has credentials but DB doesn't, save to DB
    if (env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID) {
      const existing = await prisma.instagramToken.findFirst({
        where: { userId, instagramUserId: env.INSTAGRAM_USER_ID },
      });
      if (!existing) {
        let username: string | undefined;
        try {
          const profileRes = await fetch(`https://graph.instagram.com/me?fields=username&access_token=${env.INSTAGRAM_ACCESS_TOKEN}`);
          const profile = await profileRes.json() as any;
          if (profile.username) username = profile.username;
        } catch { /* ignore */ }

        const count = await prisma.instagramToken.count({ where: { userId } });
        await prisma.instagramToken.create({
          data: {
            accessToken: env.INSTAGRAM_ACCESS_TOKEN,
            instagramUserId: env.INSTAGRAM_USER_ID,
            username,
            isDefault: count === 0,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
            userId,
          },
        });
      }
    }

    const accounts = await prisma.instagramToken.findMany({
      where: { userId },
      select: {
        id: true,
        username: true,
        instagramUserId: true,
        isDefault: true,
        expiresAt: true,
        refreshedAt: true,
        brandId: true,
      },
      orderBy: { refreshedAt: 'desc' },
    });

    // As empresas vao junto: a tela precisa oferecer o vinculo, e sem ele
    // uma agencia com varias contas nao consegue separar os dados dos
    // clientes.
    const brands = await prisma.brand.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }).catch(() => []);

    res.json({ success: true, data: accounts, brands });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/instagram/accounts - Add a new Instagram account
const addAccountSchema = z.object({
  accessToken: z.string().min(10),
  instagramUserId: z.string().min(5),
  username: z.string().optional(),
});

router.post('/accounts', validate(addAccountSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    let { accessToken, instagramUserId, username } = req.body;

    // Try to exchange for long-lived token
    const appIdSetting = await prisma.setting.findUnique({ where: { userId_key: { userId, key: 'FACEBOOK_APP_ID' } } });
    const appSecretSetting = await prisma.setting.findUnique({ where: { userId_key: { userId, key: 'FACEBOOK_APP_SECRET' } } });
    const appId = appIdSetting?.value || env.FACEBOOK_APP_ID;
    const appSecret = appSecretSetting?.value || env.FACEBOOK_APP_SECRET;

    let expiresIn = 3600; // 1 hour default for short-lived

    if (appId && appSecret) {
      try {
        const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`;
        const exchangeRes = await fetch(exchangeUrl);
        const exchangeData = await exchangeRes.json() as any;
        if (exchangeData.access_token) {
          accessToken = exchangeData.access_token;
          expiresIn = exchangeData.expires_in || 5184000;
          console.log(`[Instagram] Token exchanged for long-lived (${Math.round(expiresIn / 86400)} days)`);
        }
      } catch (err: any) {
        console.warn('[Instagram] Token exchange failed:', err.message);
      }
    }

    // Fetch username from Instagram if not provided
    if (!username) {
      try {
        const profileRes = await fetch(`https://graph.instagram.com/me?fields=username&access_token=${accessToken}`);
        const profile = await profileRes.json() as any;
        if (profile.username) username = profile.username;
      } catch { /* ignore */ }
    }

    // Check if account already exists
    const existing = await prisma.instagramToken.findFirst({
      where: { userId, instagramUserId },
    });

    if (existing) {
      // Update existing
      await prisma.instagramToken.update({
        where: { id: existing.id },
        data: {
          accessToken,
          username,
          expiresAt: new Date(Date.now() + expiresIn * 1000),
          refreshedAt: new Date(),
        },
      });
      res.json({ success: true, data: { id: existing.id, username, updated: true } });
      return;
    }

    // Check if this is the first account (make default)
    const count = await prisma.instagramToken.count({ where: { userId } });

    const account = await prisma.instagramToken.create({
      data: {
        accessToken,
        instagramUserId,
        username,
        isDefault: count === 0,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        userId,
      },
    });

    res.json({ success: true, data: { id: account.id, username, isDefault: account.isDefault } });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('Unique constraint') && msg.includes('userId')) {
      res.status(400).json({
        success: false,
        error: 'Banco de dados nao suporta multiplas contas. Execute "npx prisma migrate deploy" no servidor para aplicar a migration necessaria.',
      });
      return;
    }
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/instagram/accounts/:id/brand — vincula a conta a uma empresa.
 *
 * E ISTO que torna o sistema multicliente. Sem o vinculo, todo servico
 * caia na "conta padrao do dono" e o relatorio de um cliente saia com os
 * numeros de outro.
 */
router.put('/accounts/:id/brand', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = String(req.params.id);
    const brandId = req.body?.brandId ? String(req.body.brandId) : null;

    const conta = await prisma.instagramToken.findFirst({ where: { id, userId } });
    if (!conta) { res.status(404).json({ success: false, error: 'Conta nao encontrada' }); return; }

    if (brandId) {
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) { res.status(404).json({ success: false, error: 'Empresa nao encontrada' }); return; }

      // Uma empresa so pode ter uma conta de Instagram. Duas contas
      // apontando para a mesma marca voltaria a ambiguidade que o
      // resolvedor existe para evitar — e o desempate seria arbitrario.
      const jaVinculada = await prisma.instagramToken.findFirst({
        where: { userId, brandId, NOT: { id } },
      });
      if (jaVinculada) {
        res.status(400).json({
          success: false,
          error: `A conta @${jaVinculada.username || jaVinculada.instagramUserId} ja esta vinculada a esta empresa. Desvincule ela primeiro.`,
        });
        return;
      }
    }

    await prisma.instagramToken.update({ where: { id }, data: { brandId } });
    res.json({ success: true, data: { id, brandId } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao vincular' });
  }
});

// PUT /api/instagram/accounts/:id/default - Set as default account
router.put('/accounts/:id/default', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = req.params.id as string;

    // Unset all defaults
    await prisma.instagramToken.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set this one as default
    await prisma.instagramToken.update({
      where: { id },
      data: { isDefault: true },
    });

    res.json({ success: true, data: { id, isDefault: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// DELETE /api/instagram/accounts/:id - Remove an Instagram account
router.delete('/accounts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = req.params.id as string;

    const account = await prisma.instagramToken.findFirst({ where: { id, userId } });
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }

    await prisma.instagramToken.delete({ where: { id } });

    // If deleted account was default, make another one default
    if (account.isDefault) {
      const next = await prisma.instagramToken.findFirst({ where: { userId } });
      if (next) {
        await prisma.instagramToken.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

export default router;
