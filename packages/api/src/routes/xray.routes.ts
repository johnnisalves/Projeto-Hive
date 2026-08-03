import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { consultarPerfil, diagnosticar, normalizarUsername } from '../services/xray.service';

/**
 * Raio-X publico de perfil.
 *
 * ROTA SEM LOGIN, e por isso ela e a mais exposta do sistema. Duas
 * protecoes obrigatorias:
 *
 * 1. LIMITE POR IP. Cada consulta gasta cota da Graph API da conta que
 *    assina a chamada. Sem limite, um script derrubaria a cota e o
 *    Instagram de TODOS os clientes pararia de publicar.
 * 2. CACHE. O mesmo @ consultado dez vezes em dez minutos gasta uma
 *    chamada, nao dez — e perfil publico nao muda de minuto em minuto.
 */

const router = Router();

/** Limite por IP: generoso para gente, apertado para script. */
const LIMITE_POR_HORA = 12;
const JANELA_MS = 60 * 60_000;
const CACHE_MS = 30 * 60_000;

const usoPorIp = new Map<string, number[]>();
const cache = new Map<string, { em: number; dados: any }>();

function dentroDoLimite(ip: string): boolean {
  const agora = Date.now();
  const anteriores = (usoPorIp.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  if (anteriores.length >= LIMITE_POR_HORA) {
    usoPorIp.set(ip, anteriores);
    return false;
  }
  anteriores.push(agora);
  usoPorIp.set(ip, anteriores);

  // Faxina simples: sem isso o Map cresceria para sempre num processo que
  // fica meses no ar.
  if (usoPorIp.size > 5000) {
    for (const [k, v] of usoPorIp) {
      if (v.every((t) => agora - t >= JANELA_MS)) usoPorIp.delete(k);
    }
  }
  return true;
}

/**
 * GET /api/raio-x?u=@perfil
 *
 * Usa a conta configurada em RAIO_X_IG_USER_ID/RAIO_X_IG_TOKEN. Se nao
 * estiver configurada, cai para a primeira conta conectada do dono da
 * instalacao — mas SO se RAIO_X_PUBLICO estiver ligado, para ninguem
 * queimar a cota do proprio cliente sem saber.
 */
router.get('/', async (req: Request, res: Response) => {
  const alvo = normalizarUsername(String(req.query.u || ''));
  if (alvo.length < 2) {
    res.status(400).json({ success: false, error: 'Digite o @ do perfil.' });
    return;
  }

  const emCache = cache.get(alvo);
  if (emCache && Date.now() - emCache.em < CACHE_MS) {
    res.json({ success: true, data: { ...emCache.dados, doCache: true } });
    return;
  }

  const ip = req.ip || 'desconhecido';
  if (!dentroDoLimite(ip)) {
    res.status(429).json({
      success: false,
      error: 'Você fez muitas consultas seguidas. Tente de novo daqui a pouco.',
    });
    return;
  }

  try {
    // SO variavel de ambiente. O fallback que existia aqui pegava "a
    // primeira conta EAA do banco", ou seja, o token de um CLIENTE
    // qualquer: as consultas de estranhos na internet queimariam a cota de
    // Graph API dele, e quando estourasse o Instagram DELE pararia de
    // publicar — sem ninguem entender por que.
    const igUserId = process.env.RAIO_X_IG_USER_ID || '';
    const token = process.env.RAIO_X_IG_TOKEN || '';

    if (!igUserId || !token) {
      res.status(503).json({
        success: false,
        error: 'O raio-X ainda não está disponível. Configure RAIO_X_IG_USER_ID e RAIO_X_IG_TOKEN.',
      });
      return;
    }

    const { perfil, motivo } = await consultarPerfil(alvo, igUserId, token);
    if (!perfil) { res.status(404).json({ success: false, error: motivo }); return; }

    const dados = {
      username: perfil.username,
      followers: perfil.followers,
      posts: perfil.mediaCount,
      ...diagnosticar(perfil),
    };

    cache.set(alvo, { em: Date.now(), dados });
    if (cache.size > 2000) {
      for (const [k, v] of cache) if (Date.now() - v.em >= CACHE_MS) cache.delete(k);
    }

    res.json({ success: true, data: dados });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao analisar o perfil' });
  }
});

export default router;
