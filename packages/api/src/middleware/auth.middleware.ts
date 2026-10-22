import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pareceTokenPessoal, usuarioDoTokenPessoal } from '../services/api-token.service';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  /** Como a requisicao se autenticou: login (JWT), token pessoal ou servico interno. */
  authVia?: 'jwt' | 'api-token' | 'service';
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token not provided' });
    return;
  }

  const token = header.slice(7);

  // Internal service token (bot, MCP)
  if (env.INTERNAL_SERVICE_TOKEN && token === env.INTERNAL_SERVICE_TOKEN) {
    req.userId = 'service';
    req.authVia = 'service';
    next();
    return;
  }

  // Token de API pessoal (scripts do usuario) — ver api-token.service
  if (pareceTokenPessoal(token)) {
    usuarioDoTokenPessoal(token)
      .then((userId) => {
        if (!userId) {
          res.status(401).json({ success: false, error: 'Token de API invalido ou revogado' });
          return;
        }
        req.userId = userId;
        req.authVia = 'api-token';
        next();
      })
      .catch(() => res.status(401).json({ success: false, error: 'Token de API invalido' }));
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    req.authVia = 'jwt';
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}
