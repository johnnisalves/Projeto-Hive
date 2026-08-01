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
} from '../services/ig-contacts.service';

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

    if (total === 0) {
      // O autocomplete chama esta rota a CADA tecla. Sem trava, uma agenda
      // vazia disparava a importacao inteira a cada letra digitada — nos
      // logs deram 4 sincronizacoes em 4 segundos, cada uma com dezenas de
      // chamadas ao Meta. Isso queima o rate limit e trava o campo.
      // Uma tentativa por hora e suficiente: o botao manual continua para
      // quem quiser forcar agora.
      const KEY = 'IG_CONTACTS_LAST_SYNC';
      const last = await prisma.setting.findUnique({
        where: { userId_key: { userId: ownerId, key: KEY } },
      }).catch(() => null);

      const lastAt = last?.value ? Number(last.value) : 0;
      const umaHora = 60 * 60 * 1000;

      if (Date.now() - lastAt > umaHora) {
        await prisma.setting.upsert({
          where: { userId_key: { userId: ownerId, key: KEY } },
          create: { userId: ownerId, key: KEY, value: String(Date.now()) },
          update: { value: String(Date.now()) },
        }).catch(() => {});

        await seedContactsFromHistory(ownerId);
        const sync = await syncContactsFromInstagram(ownerId)
          .catch((e) => ({ added: 0, sources: [], reason: e?.message }));
        reason = sync.reason;
      } else {
        reason = 'Sua conta do Instagram nao tem @ nas legendas, comentarios nem marcacoes. Digite o @ inteiro uma vez — ele fica salvo.';
      }
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
