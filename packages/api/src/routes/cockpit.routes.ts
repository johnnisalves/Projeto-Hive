import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { montarCockpit, resumoDaCarteira, DadosDaMarca } from '../services/cockpit.service';
import { calcular, feeSugerido, ranquear, LinhaRentabilidade } from '../services/profitability.service';

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

/**
 * GET /api/cockpit/rentabilidade?dias=30 — qual cliente da lucro.
 *
 * O custo/hora da equipe fica num Setting do dono, nao por marca: e a mesma
 * equipe atendendo todo mundo, e pedir o valor marca a marca faria o
 * usuario desistir de configurar.
 */
router.get('/rentabilidade', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const dias = Math.min(180, Math.max(7, Number(req.query.dias) || 30));
    const desde = new Date(Date.now() - dias * 86_400_000);

    const config = await prisma.setting.findUnique({
      where: { userId_key: { userId: ownerId, key: 'CUSTO_HORA_CENTAVOS' } },
    }).catch(() => null);
    const custoHoraCentavos = config?.value ? Number(config.value) : null;

    const [marcas, posts, artes, respostas] = await Promise.all([
      prisma.brand.findMany({ where: { userId: ownerId }, select: { id: true, name: true, feeCentavos: true } }),
      prisma.post.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, createdAt: { gte: desde } },
        _count: { _all: true },
      }),
      prisma.post.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, createdAt: { gte: desde }, imageUrl: { not: null } },
        _count: { _all: true },
      }),
      prisma.agentLog.groupBy({
        by: ['brandId'],
        where: { userId: ownerId, ator: 'inbox', createdAt: { gte: desde } },
        _count: { _all: true },
      }),
    ]);

    const mapa = <T extends { brandId: string | null; _count: { _all: number } }>(l: T[]) =>
      new Map(l.filter((x) => x.brandId).map((x) => [x.brandId as string, x._count._all]));

    const mPosts = mapa(posts);
    const mArtes = mapa(artes);
    const mRespostas = mapa(respostas);

    const linhas: LinhaRentabilidade[] = marcas.map((m) => {
      const esforco = {
        posts: mPosts.get(m.id) ?? 0,
        artes: mArtes.get(m.id) ?? 0,
        respostas: mRespostas.get(m.id) ?? 0,
        tarefas: 0,
      };
      const r = calcular(esforco, m.feeCentavos, custoHoraCentavos);
      return {
        id: m.id,
        nome: m.name,
        esforco,
        temConta: r !== null,
        ...(r || {}),
        feeSugeridoCentavos: r ? feeSugerido(r.custoCentavos) : undefined,
      };
    });

    res.json({
      success: true,
      data: {
        dias,
        custoHoraCentavos,
        linhas: ranquear(linhas),
        // Sem custo/hora nao ha conta nenhuma para fazer; a tela precisa
        // saber disso para pedir a configuracao em vez de mostrar vazio.
        precisaConfigurar: !custoHoraCentavos,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao calcular rentabilidade' });
  }
});

/** PUT /api/cockpit/custo-hora — quanto custa uma hora da equipe. */
router.put('/custo-hora', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const valor = Math.max(0, Math.round(Number(req.body?.custoHoraCentavos) || 0));
    await prisma.setting.upsert({
      where: { userId_key: { userId: ownerId, key: 'CUSTO_HORA_CENTAVOS' } },
      create: { userId: ownerId, key: 'CUSTO_HORA_CENTAVOS', value: String(valor) },
      update: { value: String(valor) },
    });
    res.json({ success: true, data: { custoHoraCentavos: valor } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao salvar' });
  }
});

export default router;
