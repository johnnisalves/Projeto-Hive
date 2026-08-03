import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { getInstagramAnalytics } from '../services/analytics.service';

const router = Router();

router.use(authMiddleware);

// GET /api/analytics?period=7d|30d|90d — metricas reais do Instagram
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const period = String(req.query.period || '30d');
    // A marca decide QUAL conta de Instagram consultar. Sem ela, numa
    // agencia com varios clientes, todo mundo veria os numeros do mesmo.
    const data = await getInstagramAnalytics(ownerId, period, req.query.brandId ? String(req.query.brandId) : null);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar analytics' });
  }
});

export default router;
