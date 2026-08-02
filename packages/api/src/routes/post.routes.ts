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
    if (brandId) {
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      ramo = [brand?.description, brand?.products?.join(' ')].filter(Boolean).join(' ') || undefined;
    }

    const pautas = planejarMes({ ano, mes, postsPorSemana, ramo });
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
