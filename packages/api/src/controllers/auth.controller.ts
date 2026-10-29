import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';

const jwtOptions: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as any };

export async function register(req: Request, res: Response) {
  try {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already registered' });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name },
      select: { id: true, email: true, name: true, role: true, allowedPages: true },
    });

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, jwtOptions);

    res.status(201).json({ success: true, data: { user, token } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, jwtOptions);

    res.json({
      success: true,
      data: { user: { id: user.id, email: user.email, name: user.name, role: user.role, allowedPages: user.allowedPages }, token },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ============================================================
// Login com Google (Google Identity Services)
// O navegador recebe um ID token do Google; aqui validamos o token com o
// proprio Google, conferimos que foi emitido para o NOSSO client id e que o
// e-mail e verificado. So o Client ID e necessario (e publico) — sem secret.
// ============================================================

/** Client ID do Google: env GOOGLE_CLIENT_ID ou Setting do dono da plataforma. */
async function getGoogleClientId(): Promise<string | null> {
  if (process.env.GOOGLE_CLIENT_ID) return process.env.GOOGLE_CLIENT_ID;
  const owner = await prisma.user.findFirst({
    where: { role: 'OWNER', ownerId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!owner) return null;
  const s = await prisma.setting.findUnique({ where: { userId_key: { userId: owner.id, key: 'GOOGLE_CLIENT_ID' } } });
  return s?.value || null;
}

export async function googleConfig(_req: Request, res: Response) {
  try {
    res.json({ success: true, data: { clientId: await getGoogleClientId() } });
  } catch {
    res.json({ success: true, data: { clientId: null } });
  }
}

export async function googleLogin(req: Request, res: Response) {
  try {
    const { credential } = req.body as { credential?: string };
    if (!credential) {
      res.status(400).json({ success: false, error: 'Token do Google ausente' });
      return;
    }
    const clientId = await getGoogleClientId();
    if (!clientId) {
      res.status(400).json({ success: false, error: 'Login com Google nao configurado' });
      return;
    }

    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const info = (await r.json().catch(() => ({}))) as Record<string, string>;
    const validIssuer = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    if (!r.ok || info.aud !== clientId || !validIssuer || info.email_verified !== 'true' || !info.email) {
      res.status(401).json({ success: false, error: 'Login com Google invalido' });
      return;
    }

    const email = info.email.toLowerCase();
    let user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user) {
      // Primeira vez com essa conta Google: cria o usuario (senha aleatoria, nunca usada)
      const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      user = await prisma.user.create({ data: { email, password: randomPassword, name: info.name || null } });
    }

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, jwtOptions);
    res.json({
      success: true,
      data: { user: { id: user.id, email: user.email, name: user.name, role: user.role, allowedPages: user.allowedPages }, token },
    });
  } catch (err) {
    console.error('[auth] googleLogin:', (err as Error)?.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Token not provided' });
      return;
    }

    const oldToken = header.slice(7);
    const payload = jwt.verify(oldToken, env.JWT_SECRET) as { userId: string };
    const token = jwt.sign({ userId: payload.userId }, env.JWT_SECRET, jwtOptions);

    res.json({ success: true, data: { token } });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}
