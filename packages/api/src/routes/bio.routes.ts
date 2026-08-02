import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { gerarSlug, slugValido, normalizarUrl } from '../services/bio.service';

/**
 * Link-in-bio por marca.
 *
 * A pagina publica fecha o ciclo post -> clique -> venda: o Instagram so
 * deixa um link na bio, e aqui ele vira varios.
 */

const router = Router();

// ---------------------------------------------------------------------------
// Publico
// ---------------------------------------------------------------------------

/** GET /api/bio/:slug — o que o visitante ve. */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const brand = await prisma.brand.findUnique({
      where: { bioSlug: String(req.params.slug) },
      select: {
        id: true, name: true, primaryColor: true, logoUrl: true, description: true,
        bioLinks: { where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, label: true, url: true } },
      },
    });
    if (!brand) { res.status(404).json({ success: false, error: 'Página não encontrada' }); return; }

    // Nao devolvemos contagem de cliques nem id da marca: e pagina publica,
    // e numero de negocio nao e da conta do visitante.
    res.json({
      success: true,
      data: {
        name: brand.name,
        description: brand.description,
        primaryColor: brand.primaryColor,
        logoUrl: brand.logoUrl,
        links: brand.bioLinks,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao abrir' });
  }
});

/** POST /api/bio/:slug/click/:linkId — conta o clique e devolve o destino. */
router.post('/:slug/click/:linkId', async (req: Request, res: Response) => {
  try {
    const brand = await prisma.brand.findUnique({
      where: { bioSlug: String(req.params.slug) }, select: { id: true },
    });
    if (!brand) { res.status(404).json({ success: false, error: 'Não encontrado' }); return; }

    // O link PRECISA pertencer a esta marca: sem a checagem, trocar o id na
    // URL contaria clique no botao de outro cliente.
    const link = await prisma.bioLink.findFirst({
      where: { id: String(req.params.linkId), brandId: brand.id },
      select: { id: true, url: true },
    });
    if (!link) { res.status(404).json({ success: false, error: 'Link não encontrado' }); return; }

    // Contar nao pode atrasar o redirecionamento nem derrubar o clique.
    void prisma.bioLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }).catch(() => {});

    res.json({ success: true, data: { url: link.url } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao registrar' });
  }
});

// ---------------------------------------------------------------------------
// Autenticado: o dono configura
// ---------------------------------------------------------------------------

const admin = Router();
admin.use(authMiddleware);

/** GET /api/bio-admin/:brandId — slug, links e cliques. */
admin.get('/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({
      where: { id: String(req.params.brandId), userId },
      include: { bioLinks: { orderBy: { order: 'asc' } } },
    });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }
    res.json({ success: true, data: { slug: brand.bioSlug, links: brand.bioLinks } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

/** POST /api/bio-admin/:brandId/slug — define o endereco publico. */
const slugSchema = z.object({ slug: z.string().max(40).optional() });

admin.post('/:brandId/slug', validate(slugSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }

    // Sem slug informado, derivamos do nome da marca.
    const slug = gerarSlug(req.body.slug || brand.name);
    if (!slugValido(slug)) {
      res.status(400).json({ success: false, error: 'Endereço inválido ou reservado. Use letras, números e hífen.' });
      return;
    }

    const ocupado = await prisma.brand.findFirst({ where: { bioSlug: slug, NOT: { id: brand.id } } });
    if (ocupado) { res.status(400).json({ success: false, error: 'Esse endereço já está em uso.' }); return; }

    await prisma.brand.update({ where: { id: brand.id }, data: { bioSlug: slug } });
    res.json({ success: true, data: { slug } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

/** POST /api/bio-admin/:brandId/links — acrescenta um botao. */
const linkSchema = z.object({ label: z.string().min(1).max(60), url: z.string().min(3).max(500) });

admin.post('/:brandId/links', validate(linkSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }

    const url = normalizarUrl(req.body.url);
    if (!url) {
      res.status(400).json({ success: false, error: 'Endereço de link inválido. Use um endereço http ou https.' });
      return;
    }

    const total = await prisma.bioLink.count({ where: { brandId: brand.id } });
    const link = await prisma.bioLink.create({
      data: { brandId: brand.id, label: req.body.label.trim(), url, order: total },
    });
    res.status(201).json({ success: true, data: link });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

/** DELETE /api/bio-admin/:brandId/links/:id */
admin.delete('/:brandId/links/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }
    await prisma.bioLink.deleteMany({ where: { id: String(req.params.id), brandId: brand.id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

export { admin as bioAdminRouter };
export default router;
