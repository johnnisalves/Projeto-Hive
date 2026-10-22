import crypto from 'crypto';
import { prisma } from '../config/database';

/**
 * Token de API pessoal — para scripts e automacoes falarem com a API como o
 * proprio usuario, sem login no navegador.
 *
 * O token aparece UMA vez, na criacao. No banco fica so o hash SHA-256 e um
 * prefixo curto para o usuario reconhecer qual e qual na lista. Revogar e
 * marcar revokedAt: o token deixa de valer na hora.
 */
export const PREFIXO_TOKEN = 'dpa_';
const BYTES = 24; // 48 caracteres hex depois do prefixo

export function gerarTokenPessoal(): string {
  return PREFIXO_TOKEN + crypto.randomBytes(BYTES).toString('hex');
}

export function hashTokenPessoal(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Formato do token pessoal — os JWT de login nunca comecam assim. */
export function pareceTokenPessoal(token: string): boolean {
  return token.startsWith(PREFIXO_TOKEN) && /^[0-9a-f]+$/.test(token.slice(PREFIXO_TOKEN.length))
    && token.length === PREFIXO_TOKEN.length + BYTES * 2;
}

/** Parte visivel na lista ("dpa_3f9a…"), para reconhecer o token sem expor. */
export function prefixoVisivel(token: string): string {
  return token.slice(0, PREFIXO_TOKEN.length + 6);
}

const db = () => prisma as any;

/** Dono de um token valido (nao revogado), ou null. */
export async function usuarioDoTokenPessoal(token: string): Promise<string | null> {
  const achado = await db().apiToken.findFirst({
    where: { tokenHash: hashTokenPessoal(token), revokedAt: null },
    select: { id: true, userId: true },
  });
  if (!achado) return null;
  // Ultimo uso e informativo: nunca atrasa nem derruba a requisicao.
  void db().apiToken.update({ where: { id: achado.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return achado.userId;
}
