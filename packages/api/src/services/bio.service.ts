/**
 * Link-in-bio: logica pura de slug e de URL.
 *
 * O slug vai para o endereco publico, e a URL do botao vem digitada pelo
 * usuario e vira href numa pagina aberta. Os dois precisam ser tratados
 * antes de chegar no HTML.
 */

/** Nomes que nao podem virar slug porque colidem com rotas do app. */
export const SLUGS_RESERVADOS = new Set([
  'api', 'admin', 'posts', 'brands', 'inbox', 'settings', 'login', 'bio',
  'aprovar', 'radar', 'reciclar', 'autopilot', 'calendar', 'analytics',
]);

/**
 * Transforma o nome da marca em slug de URL.
 *
 * Remove acento antes de filtrar: sem isso "Pizzaria Essenza Açaí" perderia
 * o "ç" e o "í" no meio da palavra, virando "pizzaria-essenza-aa".
 */
export function gerarSlug(nome: string): string {
  return (nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // tira os acentos, mantendo a letra
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** O slug e utilizavel? */
export function slugValido(slug: string): boolean {
  if (!slug || slug.length < 3 || slug.length > 40) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return false;
  if (SLUGS_RESERVADOS.has(slug)) return false;
  return true;
}

/**
 * Normaliza a URL do botao.
 *
 * SEGURANCA: a URL vira href numa pagina publica. Sem esta checagem, um
 * "javascript:..." colado no campo executaria script em quem clicasse.
 * Aceitamos so http e https; sem esquema, assumimos https.
 */
export function normalizarUrl(bruta: string): string | null {
  const t = (bruta || '').trim();
  if (!t) return null;

  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;

  try {
    const u = new URL(comEsquema);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
