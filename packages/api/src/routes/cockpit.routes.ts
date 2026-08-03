import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { montarCockpit, resumoDaCarteira, DadosDaMarca } from '../services/cockpit.service';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/cockpit — a carteira inteira numa tela, pior primeiro.
 *
 * Todas as contagens saem de UMA consulta por tipo, agrupada por marca, em
 * vez de um loop por marca. Com 40 marcas o loop dispararia 200 consultas
 * e a tela levaria segundos para abrir — justo a tela que precisa ser a
 * primeira coisa que a agencia olha de manha.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const agora = new Date();
    const em7dias = new Date(agora.getTime() + 7 * 86_400_000);
    const ha24h = new Date(agora.getTime() - 86_400_000);
    const ha48h = new Date(agora.getTime() - 2 * 86_400_000);

    const [marcas, agendados, falhas, paradas, publicados, contas] = await Promise.all([
      prisma.brand.findMany({ where: { userId: ownerId }, select: { id: true, name: true } }),

      prisma.post.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, status: 'SCHEDULED', scheduledAt: { gte: agora, lte: em7dias } },
        _count: { _all: true },
      }),

      prisma.post.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, status: 'FAILED', updatedAt: { gte: ha24h } },
        _count: { _all: true },
      }),

      prisma.post.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, approvalState: 'pending', updatedAt: { lte: ha48h } },
        _count: { _all: true },
      }),

      prisma.post.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, status: 'PUBLISHED' },
        _max: { publishedAt: true },
      }),

      prisma.instagramToken.findMany({
        where: { userId: ownerId },
        select: { expiresAt: true, isDefault: true },
        orderBy: { isDefault: 'desc' },
      }),
    ]);

    const porMarca = <T extends { brandId: string | null }>(linhas: T[]) =>
      new Map(linhas.filter((l) => l.brandId).map((l) => [l.brandId as string, l]));

    const mAgendados = porMarca(agendados);
    const mFalhas = porMarca(falhas);
    const mParadas = porMarca(paradas);
    const mPublicados = porMarca(publicados);

    // O token e da CONTA, nao da marca: hoje uma conta do Instagram serve
    // todas as marcas do mesmo dono. Usamos a que vence primeiro, porque e
    // ela que vai parar de publicar antes.
    const vencimento = contas.length
      ? contas.reduce((menor, c) => (c.expiresAt < menor ? c.expiresAt : menor), contas[0].expiresAt)
      : null;
    const diasAteTokenVencer = vencimento
      ? Math.floor((new Date(vencimento).getTime() - agora.getTime()) / 86_400_000)
      : null;

    const dados: DadosDaMarca[] = marcas.map((m) => ({
      id: m.id,
      nome: m.name,
      agendados7d: mAgendados.get(m.id)?._count._all ?? 0,
      falhas24h: mFalhas.get(m.id)?._count._all ?? 0,
      aprovacoesParadas: mParadas.get(m.id)?._count._all ?? 0,
      diasAteTokenVencer,
      ultimaPublicacao: mPublicados.get(m.id)?._max.publishedAt ?? null,
    }));

    const linhas = montarCockpit(dados, agora);
    res.json({ success: true, data: { linhas, resumo: resumoDaCarteira(linhas) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao montar o cockpit' });
  }
});

export default router;
