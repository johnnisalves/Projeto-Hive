import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { processarComentario } from '../services/comment-trigger.service';
import { registrarDecisao } from '../services/brand-brain.service';

/**
 * Receptor de webhooks da Meta (Instagram e Facebook).
 *
 * Em vez de o DisparaAI ficar perguntando "chegou comentario novo?" de
 * tempos em tempos, a Meta avisa no momento em que acontece. Menos
 * chamadas, menos risco de estourar o rate limit, e inbox em tempo real.
 *
 * ROTA PUBLICA — a Meta chama sem autenticacao nossa. Por isso a
 * verificacao de assinatura abaixo nao e opcional: sem ela, qualquer um
 * que descubra a URL injeta evento falso no sistema.
 */

const router = Router();

/**
 * Confere o X-Hub-Signature-256 que a Meta manda em todo POST.
 *
 * Usa timingSafeEqual em vez de === de proposito: comparacao comum vaza,
 * pelo tempo de resposta, quantos bytes iniciais bateram, e isso permite
 * descobrir a assinatura byte a byte.
 */
function assinaturaValida(req: Request, appSecret: string): boolean {
  const cabecalho = req.header('x-hub-signature-256') || '';
  if (!cabecalho.startsWith('sha256=')) return false;

  const corpo = (req as any).rawBody;
  if (!corpo) return false;

  const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(corpo).digest('hex');
  const a = Buffer.from(cabecalho);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * GET — a Meta chama uma vez, ao cadastrar a URL no painel, para conferir
 * que somos nos. Devolvemos o desafio se o token bater.
 */
router.get('/meta', (req: Request, res: Response) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const desafio = req.query['hub.challenge'];

  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!esperado) {
    console.warn('[Webhook] META_WEBHOOK_VERIFY_TOKEN nao configurado — verificacao recusada');
    res.sendStatus(500);
    return;
  }

  if (modo === 'subscribe' && token === esperado) {
    console.log('[Webhook] Verificado pela Meta');
    res.status(200).send(String(desafio));
    return;
  }
  console.warn('[Webhook] Verificacao recusada: token nao confere');
  res.sendStatus(403);
});

/** POST — os eventos em si. */
router.post('/meta', async (req: Request, res: Response) => {
  const appSecret = process.env.FACEBOOK_APP_SECRET || process.env.THREADS_APP_SECRET;

  if (!appSecret) {
    console.error('[Webhook] Sem app secret configurado: nao da para validar a assinatura, evento descartado');
    res.sendStatus(500);
    return;
  }
  if (!assinaturaValida(req, appSecret)) {
    console.warn('[Webhook] Assinatura invalida — evento descartado');
    res.sendStatus(403);
    return;
  }

  // Responder rapido e obrigatorio: a Meta desiste em poucos segundos e
  // reenvia, o que geraria evento duplicado. Processamos depois do 200.
  res.sendStatus(200);

  try {
    const corpo = req.body;
    for (const entrada of corpo?.entry || []) {
      for (const item of entrada?.changes || []) {
        const campo = item?.field;
        const valor = item?.value;
        console.log(`[Webhook] ${corpo.object}/${campo}:`, JSON.stringify(valor).slice(0, 300));

        // O evento cru NAO e mais gravado num Setting de pseudo-usuario
        // 'webhook'. Aquilo nunca funcionou: Setting.userId tem chave
        // estrangeira para User, entao o upsert falhava sempre e o
        // .catch(() => {}) engolia o erro em silencio. Pior, se tivesse
        // funcionado seria um registro unico compartilhado por TODOS os
        // clientes da instalacao — o evento de um apareceria para o outro.
        // O log acima ja preserva o formato para depuracao.

        // `entrada.id` e a CONTA que recebeu o evento. Sem passar isso
        // adiante nao ha como saber de quem e o comentario — ver
        // tratarComentario.
        if (campo === 'comments') await tratarComentario(valor, String(entrada?.id || ''));
      }
    }
  } catch (err) {
    // Ja respondemos 200; erro aqui nao pode virar reenvio infinito.
    console.error('[Webhook] Falha ao processar evento:', (err as Error).message);
  }
});

/**
 * Comentario recebido: dispara a DM automatica se alguma palavra-gatilho casar.
 *
 * QUEM E O DONO DO COMENTARIO: vem de `entry[].id`, o unico lugar onde a
 * Meta poe a conta que RECEBEU o evento. O `value` do webhook de comments
 * traz { id, text, parent_id, from, media:{id, media_product_type} } — nao
 * existe `media.owner_id` ali.
 *
 * `from.id` NAO serve de reserva: e o IGSID de QUEM COMENTOU, nunca casa
 * com instagramToken.instagramUserId, e ainda tornava a guarda de
 * auto-resposta tautologica (comparava from.id com ele mesmo). Com isso a
 * feature inteira ficava morta em silencio.
 */
async function tratarComentario(valor: any, contaWebhookId: string): Promise<void> {
  const commentId = valor?.id;
  const texto = valor?.text;
  const contaId = String(contaWebhookId || valor?.media?.owner_id || '');
  if (!commentId || !texto || !contaId) return;

  const conta = await prisma.instagramToken.findFirst({ where: { instagramUserId: contaId } }).catch(() => null);
  if (!conta) {
    // Sem log, uma conta nao conectada era indistinguivel de "nao casou
    // gatilho" — foi assim que o bug anterior passou despercebido.
    console.warn(`[Gatilho] Comentario da conta ${contaId} ignorado: nenhuma conta conectada com esse id.`);
    return;
  }

  // Nao responder ao proprio dono: a marca comentando no proprio post
  // dispararia a automacao e mandaria DM para ela mesma.
  if (String(valor?.from?.id || '') === contaId) return;

  const r = await processarComentario({
    userId: conta.userId,
    commentId: String(commentId),
    texto: String(texto),
    postId: valor?.media?.id ? String(valor.media.id) : null,
    username: valor?.from?.username || null,
    token: conta.accessToken,
  }).catch((e) => ({ respondido: false, motivo: e?.message }));

  if (r.respondido) {
    console.log(`[Gatilho] DM automatica enviada para o comentario ${commentId}`);
    await registrarDecisao({
      userId: conta.userId,
      ator: 'gatilho',
      acao: `Respondi no direct quem comentou "${String(texto).slice(0, 40)}"`,
      justificativa: 'A palavra bateu com um gatilho que você cadastrou.',
    });
  } else if (r.motivo && r.motivo !== 'nenhum gatilho casou' && r.motivo !== 'comentario ja respondido') {
    console.warn(`[Gatilho] Nao respondeu ${commentId}: ${r.motivo}`);
  }
}

export default router;
