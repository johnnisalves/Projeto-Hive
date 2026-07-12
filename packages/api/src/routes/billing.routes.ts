import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { getBillingConfig, setBillingConfig, testConnection, createCharge, listCharges, getPlans, setPlans, createSubscription, listSubscriptions, cancelSubscription } from '../services/asaas.service';

const router = Router();

// Webhook publico (a Asaas chama) — definido ANTES do authMiddleware pra ficar sem auth.
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body?.event;
    const payment = req.body?.payment;
    console.log('[asaas-webhook]', event, payment?.id, payment?.status);
    // MVP: registra o evento. (Marcar assinatura ativa/inadimplente = evolucao futura.)
    res.json({ received: true });
  } catch {
    res.json({ received: true });
  }
});

router.use(authMiddleware);

router.get('/config', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await getBillingConfig(ownerId) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Falha' });
  }
});

const cfgSchema = z.object({
  apiKey: z.string().optional().nullable(),
  env: z.enum(['sandbox', 'production']).optional(),
});
router.put('/config', validate(cfgSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    await setBillingConfig(ownerId, req.body.apiKey, req.body.env);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Falha ao salvar' });
  }
});

router.post('/test', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await testConnection(ownerId) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Falha na conexao' });
  }
});

const chargeSchema = z.object({
  customerName: z.string().min(1),
  cpfCnpj: z.string().min(8),
  value: z.number().positive(),
  billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED']).default('PIX'),
  dueDate: z.string().min(8),
  description: z.string().optional(),
});
router.post('/charges', validate(chargeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await createCharge(ownerId, req.body) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Falha ao criar cobranca' });
  }
});

router.get('/charges', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await listCharges(ownerId) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Falha ao listar' });
  }
});

const subSchema = z.object({
  customerName: z.string().min(1),
  cpfCnpj: z.string().min(8),
  value: z.number().positive(),
  billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED']).default('PIX'),
  nextDueDate: z.string().min(8),
  description: z.string().optional(),
});
router.post('/subscriptions', validate(subSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await createSubscription(ownerId, req.body) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Falha ao criar assinatura' });
  }
});

router.get('/subscriptions', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await listSubscriptions(ownerId) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Falha ao listar' });
  }
});

router.delete('/subscriptions/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await cancelSubscription(ownerId, String(req.params.id)) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Falha ao cancelar' });
  }
});

router.get('/plans', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await getPlans(ownerId) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Falha' });
  }
});

const plansSchema = z.object({
  plans: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    price: z.number().nonnegative(),
    description: z.string().optional(),
  })).max(10),
});
router.put('/plans', validate(plansSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    res.json({ success: true, data: await setPlans(ownerId, req.body.plans) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Falha ao salvar planos' });
  }
});

export default router;
