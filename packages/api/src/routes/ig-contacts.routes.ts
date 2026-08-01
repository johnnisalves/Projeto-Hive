import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { prisma } from '../config/database';
import {
  searchContacts,
  verifyContact,
  rememberContacts,
  normalizeUsername,
} from '../services/ig-contacts.service';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/ig-contacts?q=jus
 * Sugestoes para o autocomplete de @ (marcacao, colaborador, patrocinador).
 * Sem `q`, devolve os mais usados — util para mostrar a lista ao focar o campo.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const items = await searchContacts(ownerId, String(req.query.q || ''));
    res.json({ success: true, data: { items } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao buscar contatos' });
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
