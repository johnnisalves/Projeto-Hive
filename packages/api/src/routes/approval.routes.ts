import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';

/**
 * Portal de aprovacao do cliente.
 *
 * O cliente da agencia abre um link, ve os posts agendados da marca dele,
 * aprova, rejeita ou comenta — sem conta e sem senha. Hoje isso acontece
 * por WhatsApp com print, e se perde.
 *
 * SEGURANCA: as rotas /public sao abertas. Quem tem o link ve os posts
 * daquela marca. Por isso:
 *  - o token e sorteado com 32 bytes (nao adivinhavel);
 *  - a busca e sempre POR TOKEN, nunca por id de marca vindo da URL;
 *  - devolvemos so o necessario para revisar — nada de token de rede
 *    social, e-mail do dono ou dados de outras marcas;
 *  - o dono revoga quando quiser, e o link morre na hora.
 */

const router = Router();

// ---------------------------------------------------------------------------
// Publico (sem login)
// ---------------------------------------------------------------------------

/** Campos seguros de expor. Tudo que nao esta aqui NAO sai do servidor. */
function postParaCliente(p: any) {
  return {
    id: p.id,
    caption: p.caption,
    hashtags: p.hashtags,
    imageUrl: p.imageUrl,
    images: (p.images || []).map((i: any) => ({ imageUrl: i.imageUrl, order: i.order })),
    videoUrl: p.videoUrl,
    mediaType: p.mediaType,
    publishMode: p.publishMode,
    scheduledAt: p.scheduledAt,
    approvalState: p.approvalState,
    feedbacks: (p.feedbacks || []).map((f: any) => ({
      message: f.message, author: f.author, fromOwner: f.fromOwner, createdAt: f.createdAt,
    })),
  };
}

/** GET /api/approval/:token — o que o cliente ve. */
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '');
    if (token.length < 20) { res.status(404).json({ success: false, error: 'Link invalido' }); return; }

    const brand = await prisma.brand.findUnique({
      where: { approvalToken: token },
      select: { id: true, name: true, primaryColor: true, logoUrl: true },
    });
    if (!brand) { res.status(404).json({ success: false, error: 'Link invalido ou revogado' }); return; }

    // So o que faz sentido revisar: publicado ja foi, nao ha o que aprovar.
    const posts = await prisma.post.findMany({
      where: { brandId: brand.id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      include: {
        images: { orderBy: { order: 'asc' } },
        feedbacks: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });

    res.json({
      success: true,
      data: {
        brand: { name: brand.name, primaryColor: brand.primaryColor, logoUrl: brand.logoUrl },
        posts: posts.map(postParaCliente),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao abrir o portal' });
  }
});

/** POST /api/approval/:token/:postId — aprovar, rejeitar ou comentar. */
const decisaoSchema = z.object({
  state: z.enum(['approved', 'rejected', 'pending']).optional(),
  message: z.string().max(1000).optional(),
  author: z.string().max(80).optional(),
});

router.post('/:token/:postId', validate(decisaoSchema), async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '');
    const postId = String(req.params.postId || '');
    const { state, message, author } = req.body;

    if (!state && !message) {
      res.status(400).json({ success: false, error: 'Informe uma decisao ou um comentario' });
      return;
    }

    const brand = await prisma.brand.findUnique({ where: { approvalToken: token }, select: { id: true } });
    if (!brand) { res.status(404).json({ success: false, error: 'Link invalido ou revogado' }); return; }

    // O post PRECISA pertencer a marca do token. Sem esta checagem, quem
    // tivesse um link valido conseguiria alterar o post de outro cliente
    // so trocando o id na URL.
    const post = await prisma.post.findFirst({
      where: { id: postId, brandId: brand.id },
      select: { id: true },
    });
    if (!post) { res.status(404).json({ success: false, error: 'Post nao encontrado nesta marca' }); return; }

    if (state) {
      await prisma.post.update({ where: { id: post.id }, data: { approvalState: state } });
    }
    if (message?.trim()) {
      await prisma.postFeedback.create({
        data: { postId: post.id, message: message.trim(), author: author?.trim() || null, fromOwner: false },
      });
    }

    res.json({ success: true, data: { ok: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao registrar' });
  }
});

// ---------------------------------------------------------------------------
// Autenticado: o dono gera e revoga o link
// ---------------------------------------------------------------------------

const autenticado = Router();
autenticado.use(authMiddleware);

/** POST /api/approval-links/:brandId — cria ou renova o link da marca. */
autenticado.post('/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }

    // Renovar sorteia um token novo, o que invalida o link antigo — e o
    // caminho para tirar o acesso de quem nao deveria mais ter.
    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.brand.update({ where: { id: brand.id }, data: { approvalToken: token } });

    res.json({ success: true, data: { token } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar o link' });
  }
});

/** DELETE /api/approval-links/:brandId — desliga o portal. */
autenticado.delete('/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }

    await prisma.brand.update({ where: { id: brand.id }, data: { approvalToken: null } });
    res.json({ success: true, data: { revoked: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao revogar' });
  }
});

export { autenticado as approvalLinksRouter };
export default router;
