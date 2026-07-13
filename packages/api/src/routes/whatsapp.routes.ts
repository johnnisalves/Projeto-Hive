import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  publishToWhatsappStatus,
  testWhatsappConnection,
  connectWhatsappSession,
  getWhatsappSessionStatus,
  getWhatsappQr,
  logoutWhatsappSession,
} from '../services/whatsapp.service';

const router = Router();
router.use(authMiddleware);

const db = () => prisma as any;

// GET /api/whatsapp/connections
router.get('/connections', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const items = await db().whatsappConnection.findMany({
      where: { userId },
      select: { id: true, name: true, host: true, phone: true, isDefault: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: items });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/whatsapp/connections
const addSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(4),
  token: z.string().min(6),
  phone: z.string().optional(),
});
router.post('/connections', validate(addSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const { name, host, token, phone } = req.body;
    const count = await db().whatsappConnection.count({ where: { userId } });
    const conn = await db().whatsappConnection.create({
      data: { name, host, token, phone: phone || null, isDefault: count === 0, userId },
    });
    res.json({ success: true, data: { id: conn.id, name: conn.name, isDefault: conn.isDefault } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// PUT /api/whatsapp/connections/:id/default
router.put('/connections/:id/default', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = req.params.id as string;
    await db().whatsappConnection.updateMany({ where: { userId }, data: { isDefault: false } });
    await db().whatsappConnection.update({ where: { id }, data: { isDefault: true } });
    res.json({ success: true, data: { id, isDefault: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// DELETE /api/whatsapp/connections/:id
router.delete('/connections/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = req.params.id as string;
    const conn = await db().whatsappConnection.findFirst({ where: { id, userId } });
    if (!conn) { res.status(404).json({ success: false, error: 'Conexao nao encontrada' }); return; }
    await db().whatsappConnection.delete({ where: { id } });
    if (conn.isDefault) {
      const next = await db().whatsappConnection.findFirst({ where: { userId } });
      if (next) await db().whatsappConnection.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// Helper: pega a conexao (com host+token) validando ownership
async function loadConn(userId: string, id: string) {
  return db().whatsappConnection.findFirst({ where: { id, userId } });
}

// POST /api/whatsapp/connections/:id/connect - abre o socket (prepara o QR)
router.post('/connections/:id/connect', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = String(req.params.id);
    const conn = await loadConn(userId, id);
    if (!conn) { res.status(404).json({ success: false, error: 'Conexao nao encontrada' }); return; }
    await connectWhatsappSession(conn.host, conn.token);
    const status = await getWhatsappSessionStatus(conn.host, conn.token);
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/whatsapp/connections/:id/qr - QR atual (data URI) para escanear
router.get('/connections/:id/qr', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = String(req.params.id);
    const conn = await loadConn(userId, id);
    if (!conn) { res.status(404).json({ success: false, error: 'Conexao nao encontrada' }); return; }
    // garante socket aberto, senao nao ha QR
    await connectWhatsappSession(conn.host, conn.token);
    const status = await getWhatsappSessionStatus(conn.host, conn.token);
    if (status.loggedIn) { res.json({ success: true, data: { qr: null, loggedIn: true } }); return; }
    // o WuzAPI leva ~1s para gerar o QR apos o connect — tenta algumas vezes
    let qr: string | null = null;
    for (let i = 0; i < 6 && !qr; i++) {
      const r = await getWhatsappQr(conn.host, conn.token);
      qr = r.qr;
      if (!qr) {
        const st = await getWhatsappSessionStatus(conn.host, conn.token);
        if (st.loggedIn) { res.json({ success: true, data: { qr: null, loggedIn: true } }); return; }
        await new Promise((ok) => setTimeout(ok, 600));
      }
    }
    res.json({ success: true, data: { qr, loggedIn: false } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/whatsapp/connections/:id/status - loggedIn / connected
router.get('/connections/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = String(req.params.id);
    const conn = await loadConn(userId, id);
    if (!conn) { res.status(404).json({ success: false, error: 'Conexao nao encontrada' }); return; }
    const status = await getWhatsappSessionStatus(conn.host, conn.token);
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/whatsapp/connections/:id/logout - desloga o numero
router.post('/connections/:id/logout', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const id = String(req.params.id);
    const conn = await loadConn(userId, id);
    if (!conn) { res.status(404).json({ success: false, error: 'Conexao nao encontrada' }); return; }
    await logoutWhatsappSession(conn.host, conn.token);
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/whatsapp/test - valida host+token
const testSchema = z.object({ host: z.string().min(4), token: z.string().min(6) });
router.post('/test', validate(testSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { host, token } = req.body;
    const r = await testWhatsappConnection(host, token);
    res.json({ success: r.ok, data: r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/whatsapp/status/:postId - publica o post no Status do WhatsApp
router.post('/status/:postId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const postId = req.params.postId as string;
    const connectionId = (req.body?.connectionId as string) || undefined;
    // valida ownership do post
    const post = await prisma.post.findFirst({ where: { id: postId, userId } });
    if (!post) { res.status(404).json({ success: false, error: 'Post nao encontrado' }); return; }
    const result = await publishToWhatsappStatus(postId, connectionId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

export default router;
