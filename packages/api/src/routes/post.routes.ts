import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  createPost,
  listPosts,
  getPost,
  updatePost,
  deletePost,
  publishPost,
  schedulePostController,
  addImageToPost,
  removeImageFromPost,
} from '../controllers/post.controller';
import { createPostSchema, scheduleSchema, addImageSchema, campaignSchema, PLATFORMS } from './post.schemas';
import { schedulePost } from '../services/scheduler.service';
import { getPublishingLimit, getBestHours } from '../services/instagram.service';
import { planejarMes, resumoDoPlano } from '../services/autopilot.service';
import { coletarDados, montarHtml, gerarPdf } from '../services/report.service';
import { coletarEngajamento, ranquear, pontuacao, reescreverLegenda } from '../services/recycle.service';
import { analisarEquilibrio } from '../services/pillars.service';
import { rememberContacts, usernamesFromPost } from '../services/ig-contacts.service';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createPostSchema), createPost);
router.get('/', listPosts);
router.get('/:id', getPost);
router.put('/:id', updatePost);
router.delete('/:id', deletePost);
router.post('/:id/publish', publishPost);
router.post('/:id/schedule', validate(scheduleSchema), schedulePostController);
router.post('/:id/images', validate(addImageSchema), addImageToPost);
router.delete('/:id/images/:imageId', removeImageFromPost);

/**
 * GET /api/posts/publishing-limit
 * Quanto ainda cabe publicar nas proximas 24h no Instagram (teto de 50).
 * O planejador de campanha usa isso para avisar antes, em vez de deixar a
 * campanha falhar no meio.
 */
router.get('/publishing-limit', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const limite = await getPublishingLimit(userId);
    res.json({ success: true, data: limite });
  } catch (err: any) {
    res.json({ success: true, data: { usados: 0, total: 50, restantes: 50, disponivel: false, motivo: err?.message } });
  }
});

/**
 * GET /api/posts/best-hours
 * Horarios em que os seguidores estao online, do maior para o menor.
 * A campanha usa isso no lugar dos horarios padrao quando ha dado.
 */
router.get('/best-hours', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await getBestHours(userId) });
  } catch (err: any) {
    res.json({ success: true, data: { horas: [], disponivel: false, motivo: err?.message } });
  }
});

/**
 * GET /api/posts/pillars/:brandId — equilibrio dos pilares nos ultimos 90
 * dias, comparado com o mix definido na marca.
 */
router.get('/pillars/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca nao encontrada' }); return; }

    const desde = new Date(Date.now() - 90 * 86_400_000);
    const posts = await prisma.post.findMany({
      where: {
        userId,
        brandId: brand.id,
        status: { in: ['PUBLISHED', 'SCHEDULED'] },
        OR: [{ publishedAt: { gte: desde } }, { scheduledAt: { gte: desde } }],
      },
      select: { pilar: true, caption: true },
      take: 200,
    });

    const mix = { vender: brand.mixVender, educar: brand.mixEducar, engajar: brand.mixEngajar };
    res.json({ success: true, data: { ...analisarEquilibrio(posts, mix), mix } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao analisar' });
  }
});

/**
 * GET /api/posts/recycle/suggestions — melhores posts para reciclar.
 * Traz o engajamento real do Instagram e ordena pela nota.
 */
router.get('/recycle/suggestions', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const brandId = req.query.brandId ? String(req.query.brandId) : undefined;
    const avaliados = await coletarEngajamento(userId, brandId);
    const melhores = ranquear(avaliados);

    res.json({
      success: true,
      data: {
        items: melhores.map((p) => ({
          id: p.id,
          caption: p.caption,
          imageUrl: p.imageUrl,
          publishedAt: p.publishedAt,
          likes: p.likes,
          comments: p.comments,
          nota: pontuacao(p.likes, p.comments),
        })),
        // Diferenciar "nenhum candidato" de "nada publicado ainda" evita a
        // tela dizer que o usuario nao tem conteudo bom quando na verdade
        // os posts sao recentes demais.
        totalPublicados: avaliados.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao buscar sugestoes' });
  }
});

/**
 * POST /api/posts/recycle/:id — cria o post reciclado.
 * Mesma arte, legenda reescrita pela IA, agendado para a data informada.
 */
const reciclarSchema = z.object({ scheduledAt: z.string().datetime().optional() });

router.post('/recycle/:id', validate(reciclarSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const original = await prisma.post.findFirst({ where: { id: String(req.params.id), userId } });
    if (!original) { res.status(404).json({ success: false, error: 'Post nao encontrado' }); return; }
    if (!original.imageUrl) { res.status(400).json({ success: false, error: 'Post sem arte para republicar' }); return; }

    let marca = '';
    if (original.brandId) {
      const b = await prisma.brand.findUnique({ where: { id: original.brandId } });
      if (b) marca = [b.name, b.description, b.voiceTone].filter(Boolean).join(' · ');
    }

    const nova = original.caption ? await reescreverLegenda(original.caption, marca) : null;

    // Sem legenda nova, nao reciclamos: republicar identico e exatamente o
    // que esta feature existe para evitar.
    if (original.caption && !nova) {
      res.status(503).json({ success: false, error: 'A IA nao conseguiu reescrever a legenda agora. Tente de novo.' });
      return;
    }

    const quando = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    const novo = await prisma.post.create({
      data: {
        userId,
        brandId: original.brandId,
        imageUrl: original.imageUrl,
        imageSource: original.imageSource,
        aspectRatio: original.aspectRatio,
        platforms: original.platforms,
        caption: nova,
        hashtags: original.hashtags,
        recycledFromId: original.id,
        status: quando ? 'SCHEDULED' : 'DRAFT',
        scheduledAt: quando,
        source: 'WEB',
      },
    });

    if (quando) await schedulePost(novo.id, quando);
    // Marca o ORIGINAL: e ele que precisa esperar antes de voltar.
    await prisma.post.update({ where: { id: original.id }, data: { recycledAt: new Date() } });

    res.status(201).json({ success: true, data: { id: novo.id, caption: nova } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao reciclar' });
  }
});

/**
 * GET /api/posts/report/:brandId?ano=2026&mes=3
 * Relatorio mensal da marca em PDF, pronto para mandar ao cliente.
 */
router.get('/report/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const agora = new Date();
    const ano = Number(req.query.ano) || agora.getFullYear();
    const mes = Number(req.query.mes) || agora.getMonth() + 1;

    if (mes < 1 || mes > 12) {
      res.status(400).json({ success: false, error: 'Mes invalido' });
      return;
    }

    const dados = await coletarDados(userId, String(req.params.brandId), ano, mes);
    const pdf = await gerarPdf(montarHtml(dados));

    // Nome de arquivo sem acento nem espaco: cliente de e-mail e Windows
    // costumam truncar ou trocar caractere fora do ASCII.
    const nome = dados.marca.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${nome}-${ano}-${String(mes).padStart(2, '0')}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar o relatorio' });
  }
});

/**
 * POST /api/posts/autopilot/plan — o mes inteiro, sem criar nada ainda.
 *
 * Devolve as pautas (data, tema, pilar) para o usuario revisar antes de
 * gastar geracao de imagem. Criar 30 posts direto seria caro e assustador.
 */
const autopilotSchema = z.object({
  ano: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  postsPorSemana: z.number().int().min(1).max(14),
  brandId: z.string().uuid().optional(),
});

router.post('/autopilot/plan', validate(autopilotSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const { ano, mes, postsPorSemana, brandId } = req.body;

    // O ramo sai do cadastro da marca e filtra as datas comemorativas:
    // "Dia da Pizza" nao faz sentido para um escritorio de advocacia.
    let ramo: string | undefined;
    // O mix de pilares vem da marca: e ela que define se o perfil vende
    // mais ou ensina mais. Sem marca, cai no padrao equilibrado.
    let mix: { vender: number; educar: number; engajar: number } | undefined;
    if (brandId) {
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      ramo = [brand?.description, brand?.products?.join(' ')].filter(Boolean).join(' ') || undefined;
      if (brand) mix = { vender: brand.mixVender, educar: brand.mixEducar, engajar: brand.mixEngajar };
    }

    const pautas = planejarMes({ ano, mes, postsPorSemana, ramo, mix });
    res.json({
      success: true,
      data: {
        pautas: pautas.map((p) => ({
          data: p.data.toISOString(),
          tema: p.tema,
          pilar: p.pilar,
          dataComemorativa: p.dataComemorativa,
          prioridade: p.prioridade,
        })),
        resumo: resumoDoPlano(pautas),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao planejar o mes' });
  }
});

/**
 * POST /api/posts/autopilot/create — transforma as pautas em rascunhos.
 *
 * Cria os posts como DRAFT com o tema no nanoPrompt e a data no
 * scheduledAt. NAO gera arte aqui: 30 imagens numa requisicao levaria
 * minutos, estouraria timeout e gastaria credito de IA antes de o usuario
 * ver o que vai sair. A arte e gerada depois, post a post, no editor.
 */
const autopilotCreateSchema = z.object({
  pautas: z.array(z.object({
    data: z.string().datetime(),
    tema: z.string().min(3).max(500),
    pilar: z.enum(['vender', 'educar', 'engajar']),
    dataComemorativa: z.string().optional(),
  })).min(1).max(60),
  brandId: z.string().uuid().optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
});

router.post('/autopilot/create', validate(autopilotCreateSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const { pautas, brandId, platforms } = req.body;

    const criados: string[] = [];
    const falhas: Array<{ tema: string; erro: string }> = [];

    for (const pauta of pautas) {
      try {
        const post = await prisma.post.create({
          data: {
            userId,
            brandId: brandId || null,
            platforms: platforms || undefined,
            // O tema vira o prompt: quando o usuario abrir o post, a IA ja
            // sabe sobre o que escrever e desenhar.
            nanoPrompt: pauta.dataComemorativa
              ? `[${pauta.dataComemorativa}] ${pauta.tema}`
              : pauta.tema,
            // Guardar o pilar aqui evita ter que inferir da legenda depois,
            // e a analise de equilibrio fica exata em vez de estimada.
            pilar: pauta.pilar,
            caption: null,
            hashtags: [],
            scheduledAt: new Date(pauta.data),
            status: 'DRAFT',
            source: 'WEB',
            aspectRatio: '4:5',
          },
        });
        criados.push(post.id);
      } catch (err: any) {
        falhas.push({ tema: pauta.tema, erro: err?.message || 'Falha ao criar rascunho' });
      }
    }

    res.status(criados.length ? 201 : 500).json({
      success: criados.length > 0,
      data: { criados: criados.length, falhas: falhas.length, ids: criados, erros: falhas },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao criar os rascunhos' });
  }
});

/**
 * POST /api/posts/campaign — plano de divulgacao.
 *
 * Recebe N imagens ja com legenda e horario e cria N posts agendados.
 * A tela calcula as datas (ver campaign.ts) e gera as legendas com IA;
 * aqui so persistimos e enfileiramos.
 *
 * Cada post e criado e agendado individualmente: se um item falhar, os
 * outros seguem, e a resposta diz quais deram certo. Abortar a campanha
 * inteira por causa de uma imagem seria pior para quem esta publicando.
 */
router.post('/campaign', validate(campaignSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const { items, ...shared } = req.body;

    const created: Array<{ id: string; scheduledAt: string }> = [];
    const failed: Array<{ imageUrl: string; error: string }> = [];

    for (const item of items) {
      try {
        const when = new Date(item.scheduledAt);
        const post = await prisma.post.create({
          data: {
            ...shared,
            userId,
            imageUrl: item.imageUrl,
            caption: item.caption || null,
            hashtags: item.hashtags || [],
            imageSource: 'UPLOAD',
            source: 'WEB',
            scheduledAt: when,
            status: 'SCHEDULED',
          },
        });
        await schedulePost(post.id, when);
        created.push({ id: post.id, scheduledAt: when.toISOString() });
      } catch (err: any) {
        failed.push({ imageUrl: item.imageUrl, error: err?.message || 'Falha ao criar post' });
      }
    }

    // Alimenta a agenda de @ com quem foi marcado na campanha inteira.
    void rememberContacts(userId, usernamesFromPost(shared)).catch(() => {});

    res.status(created.length ? 201 : 500).json({
      success: created.length > 0,
      data: { created: created.length, failed: failed.length, posts: created, errors: failed },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao criar a campanha' });
  }
});

// #2 Fila de aprovacao: define o estado de aprovacao do post (workflow de equipe)
const approvalSchema = z.object({ approvalState: z.enum(['none', 'pending', 'approved', 'rejected']) });
router.put('/:id/approval', validate(approvalSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: ownerId } });
    if (!post) { res.status(404).json({ success: false, error: 'Post nao encontrado' }); return; }
    const updated = await prisma.post.update({ where: { id: post.id }, data: { approvalState: req.body.approvalState } as any });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar aprovacao' });
  }
});

// #9 Evergreen: marca/desmarca o post para republicacao recorrente
const evergreenSchema = z.object({
  isEvergreen: z.boolean(),
  evergreenIntervalDays: z.number().int().min(1).max(365).optional(),
});
router.put('/:id/evergreen', validate(evergreenSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: ownerId } });
    if (!post) { res.status(404).json({ success: false, error: 'Post nao encontrado' }); return; }
    const data: any = { isEvergreen: req.body.isEvergreen };
    if (req.body.evergreenIntervalDays) data.evergreenIntervalDays = req.body.evergreenIntervalDays;
    const updated = await prisma.post.update({ where: { id: post.id }, data });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar evergreen' });
  }
});

export default router;
