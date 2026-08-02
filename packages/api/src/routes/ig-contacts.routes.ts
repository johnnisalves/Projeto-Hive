import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { prisma } from '../config/database';
import {
  searchContacts,
  verifyContact,
  rememberContacts,
  normalizeUsername,
  seedContactsFromHistory,
  syncContactsFromInstagram,
  addContactsFromText,
} from '../services/ig-contacts.service';
import { searchHashtag } from '../services/instagram.service';
import { consultarTendencias } from '../services/trends.service';
import { z } from 'zod';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/ig-contacts?q=jus
 * Sugestoes para o autocomplete de @ (marcacao, colaborador, patrocinador).
 * Sem `q`, devolve os mais usados — util para mostrar a lista ao focar o campo.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const ownerId = await resolveOwnerId(req.userId!).catch(() => null);
  if (!ownerId) {
    res.status(500).json({ success: false, error: 'Nao consegui identificar o usuario' });
    return;
  }

  try {
    // Primeira vez: a agenda esta vazia e o autocomplete nao teria o que
    // sugerir. Populamos com os @ das legendas dos posts antigos e com os
    // contatos da conta do Instagram.
    const total = await prisma.igContact.count({ where: { userId: ownerId } });
    let reason: string | undefined;

    // A agenda se mantem sozinha: sincroniza com o Instagram sempre que
    // estiver velha, mesmo ja tendo contatos. Assim quem comecou a falar
    // com voce hoje aparece amanha, sem ninguem apertar nada.
    //
    // A trava de tempo e obrigatoria: o autocomplete chama esta rota a CADA
    // tecla, e sem ela os logs mostraram 4 sincronizacoes em 4 segundos —
    // cada uma com dezenas de chamadas ao Meta, queimando o rate limit.
    // Agenda vazia tenta de hora em hora (pode ser conta nova); agenda
    // cheia, a cada 6 horas.
    const KEY = 'IG_CONTACTS_LAST_SYNC';
    const last = await prisma.setting.findUnique({
      where: { userId_key: { userId: ownerId, key: KEY } },
    }).catch(() => null);

    const lastAt = last?.value ? Number(last.value) : 0;
    // Agenda vazia: tenta de novo em 5 minutos. A trava de 1 hora que havia
    // aqui tinha um efeito ruim — quando uma fonte nova entrava no codigo
    // (as conversas do Direct, por exemplo), ela ficava barrada pelo
    // carimbo da sincronizacao anterior e nunca chegava a rodar.
    // Agenda cheia: 6 horas basta, so para pegar gente nova.
    const intervalo = total === 0 ? 5 * 60 * 1000 : 6 * 60 * 60 * 1000;

    if (Date.now() - lastAt > intervalo) {
      await prisma.setting.upsert({
        where: { userId_key: { userId: ownerId, key: KEY } },
        create: { userId: ownerId, key: KEY, value: String(Date.now()) },
        update: { value: String(Date.now()) },
      }).catch(() => {});

      await seedContactsFromHistory(ownerId);
      const sync = await syncContactsFromInstagram(ownerId)
        .catch((e) => ({ added: 0, sources: [], reason: e?.message }));
      if (total === 0) reason = sync.reason;
    } else if (total === 0) {
      reason = 'Nao encontrei @ nas legendas, comentarios, marcacoes nem conversas da sua conta. Digite o @ inteiro uma vez — ele fica salvo.';
    }

    const items = await searchContacts(ownerId, String(req.query.q || ''));
    // `reason` explica por que a agenda esta vazia (conta nao conectada,
    // nenhum @ encontrado). Sem isso a tela so consegue dizer "nao achei".
    res.json({ success: true, data: { items, reason } });
  } catch (err: any) {
    // O autocomplete dispara a cada tecla: devolver 500 aqui entupiria o
    // console e, do lado do usuario, o campo so ficaria mudo. Respondemos
    // 200 com lista vazia e o motivo, para a interface poder mostrar.
    const message = err?.message || 'Falha ao buscar contatos';
    console.error('[IgContacts] Busca falhou:', message);
    res.json({ success: true, data: { items: [], warning: message } });
  }
});

/** POST /api/ig-contacts — salva um @ na agenda manualmente. */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const username = normalizeUsername(String(req.body?.username || ''));
    if (!username) { res.status(400).json({ success: false, error: 'Informe o @' }); return; }
    await rememberContacts(ownerId, [username]);
    res.json({ success: true, data: { username } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao salvar contato' });
  }
});

/**
 * GET /api/ig-contacts/verify?username=fulano
 * Confirma o perfil pelo business_discovery. So funciona para conta
 * Business/Creator publica e com token do Login do Facebook — por isso o
 * status "unavailable" e um resultado normal, nao um erro.
 */
router.get('/verify', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const result = await verifyContact(ownerId, String(req.query.username || ''));
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao confirmar perfil' });
  }
});

/**
 * POST /api/ig-contacts/sync — reimporta os contatos da conta do Instagram.
 * Usado pelo botao "Buscar meus contatos" quando a agenda esta magra.
 */
router.post('/sync', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const fromHistory = await seedContactsFromHistory(ownerId);
    const fromInstagram = await syncContactsFromInstagram(ownerId);
    const total = await prisma.igContact.count({ where: { userId: ownerId } });
    res.json({
      success: true,
      data: {
        total,
        fromHistory,
        fromInstagram: fromInstagram.added,
        sources: fromInstagram.sources,
        reason: total === 0 ? fromInstagram.reason : undefined,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao sincronizar contatos' });
  }
});

/**
 * POST /api/ig-contacts/bulk — cola uma lista de @ de uma vez.
 * Aceita qualquer separador: virgula, espaco, quebra de linha.
 */
router.post('/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const r = await addContactsFromText(ownerId, String(req.body?.text || ''));
    const total = await prisma.igContact.count({ where: { userId: ownerId } });
    res.json({ success: true, data: { ...r, total } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao adicionar contatos' });
  }
});

/**
 * GET /api/ig-contacts/places?q=pizzaria
 * Busca local pelo NOME e devolve os IDs que o Instagram aceita.
 *
 * O parametro location_id do Meta exige o ID de uma Pagina com local
 * verificado — digitar "Petrolina" nunca funcionaria. Esta rota traduz
 * nome em ID usando /pages/search (o antigo /search?type=place foi
 * descontinuado na v8.0).
 *
 * Exige token do Login do Facebook: com token do Login do Instagram o
 * endpoint nao existe.
 */
router.get('/places', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const q = String(req.query.q || '').trim();
    if (q.length < 2) { res.json({ success: true, data: { items: [] } }); return; }

    const account = await prisma.instagramToken.findFirst({
      where: { userId: ownerId },
      orderBy: { isDefault: 'desc' },
    });
    if (!account) {
      res.json({ success: true, data: { items: [], reason: 'Conecte uma conta do Instagram para buscar locais.' } });
      return;
    }
    if (!account.accessToken.startsWith('EAA')) {
      res.json({
        success: true,
        data: { items: [], reason: 'A busca de locais exige conta conectada via Login do Facebook.' },
      });
      return;
    }

    const url = `https://graph.facebook.com/v21.0/pages/search?q=${encodeURIComponent(q)}`
      + `&fields=id,name,location&limit=10&access_token=${account.accessToken}`;
    const r = await fetch(url);
    const data = (await r.json()) as any;
    if (data?.error) {
      res.json({ success: true, data: { items: [], reason: data.error.message } });
      return;
    }

    const items = (data?.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      // Monta "Cidade, UF" a partir do que vier — nem todo local tem tudo.
      where: [p.location?.city, p.location?.state, p.location?.country].filter(Boolean).join(', '),
    }));
    res.json({ success: true, data: { items } });
  } catch (err: any) {
    res.json({ success: true, data: { items: [], reason: err?.message || 'Falha ao buscar locais' } });
  }
});

/**
 * GET /api/ig-contacts/hashtag?q=marketing
 * Posts em alta de uma hashtag, para pesquisa de conteudo.
 * Limite do Meta: 30 hashtags distintas por semana.
 */
router.get('/hashtag', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await searchHashtag(ownerId, String(req.query.q || '')) });
  } catch (err: any) {
    res.json({ success: true, data: { items: [], disponivel: false, motivo: err?.message } });
  }
});

/**
 * POST /api/ig-contacts/trends — radar de tendencias por hashtag.
 *
 * A cota do Meta (30 hashtags distintas por 7 dias) e verificada ANTES de
 * qualquer chamada: estourar bloqueia a consulta de hashtag da conta
 * inteira ate a janela girar.
 */
const trendsSchema = z.object({ tags: z.array(z.string().max(60)).min(1).max(10) });

router.post('/trends', validate(trendsSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await consultarTendencias(ownerId, req.body.tags) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao consultar tendencias' });
  }
});

/** DELETE /api/ig-contacts/:username — tira um @ da agenda. */
router.delete('/:username', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const username = normalizeUsername(String(req.params.username));
    await prisma.igContact.deleteMany({ where: { userId: ownerId, username } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao remover contato' });
  }
});

export default router;
