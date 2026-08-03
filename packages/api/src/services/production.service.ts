/**
 * Fila de producao: rascunho vazio vira post pronto.
 *
 * O piloto automatico entrega 30 rascunhos com o tema e a data — e mais
 * nada. Sem legenda, sem arte, sem hashtag. O usuario abre 30 posts e tem
 * 30 vezes o mesmo trabalho, o que faz a promessa de "o conteudo aparece
 * pronto" nao ser verdade.
 *
 * Esta fila fecha esse buraco: cada rascunho vira UM job, que gera o que
 * falta e devolve o post pronto para revisao.
 */

export type Faltando = 'legenda' | 'arte' | 'ambos' | null;

export interface PostParaProduzir {
  id: string;
  caption?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  nanoPrompt?: string | null;
  scheduledAt?: Date | null;
  status: string;
}

/**
 * O que falta neste post.
 *
 * Post com video NAO precisa de arte: a midia ja existe, e gerar imagem
 * para ele gastaria credito para produzir algo que ninguem usaria.
 */
export function oQueFalta(p: PostParaProduzir): Faltando {
  const semLegenda = !p.caption || p.caption.trim().length < 10;
  const semArte = !p.imageUrl && !p.videoUrl;

  if (semLegenda && semArte) return 'ambos';
  if (semLegenda) return 'legenda';
  if (semArte) return 'arte';
  return null;
}

/**
 * O post pode entrar na fila?
 *
 * Só rascunho e agendado entram. Produzir para um post JA PUBLICADO
 * sobrescreveria o que esta no ar; para um que falhou, empilharia trabalho
 * em cima de um erro que ninguem investigou.
 */
export const STATUS_PRODUZIVEL = ['DRAFT', 'SCHEDULED'];

export function podeProduzir(p: PostParaProduzir): boolean {
  if (!STATUS_PRODUZIVEL.includes(p.status)) return false;
  if (oQueFalta(p) === null) return false;
  // Sem tema nao ha o que a IA escrever nem desenhar. O piloto grava o tema
  // em nanoPrompt; um post criado a mao e vazio nao tem contexto nenhum.
  return Boolean((p.nanoPrompt || '').trim() || (p.caption || '').trim());
}

/**
 * A ordem da fila: o que publica ANTES fica pronto ANTES.
 *
 * Se 30 posts entram na fila e so 10 terminam antes de voce precisar, voce
 * quer os 10 mais proximos — nao 10 sorteados. Post sem data vai para o
 * fim: nao tem prazo.
 */
export function ordenarPorUrgencia<T extends PostParaProduzir>(posts: T[]): T[] {
  return [...(posts || [])].sort((a, b) => {
    const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
    const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    // Empate (ou ambos sem data): ordem estavel pelo id, para a fila nao
    // dancar entre duas chamadas.
    return a.id.localeCompare(b.id);
  });
}

/**
 * Teto por pedido.
 *
 * Gerar imagem custa dinheiro e tempo. Sem teto, um clique errado
 * enfileiraria centenas de gerações e o usuario so descobriria pela fatura.
 * 60 cobre dois meses de conteudo diario.
 */
export const MAX_POR_PEDIDO = 60;

export function separarPorTeto<T>(posts: T[], teto = MAX_POR_PEDIDO): { entram: T[]; sobram: T[] } {
  return { entram: (posts || []).slice(0, teto), sobram: (posts || []).slice(teto) };
}

export interface Progresso {
  total: number;
  prontos: number;
  faltando: number;
  porcentagem: number;
}

/**
 * Quanto ja ficou pronto.
 *
 * A porcentagem e arredondada para baixo de proposito: mostrar 100% com um
 * post ainda na fila faz o usuario abrir a tela e encontrar trabalho pela
 * frente.
 */
export function progresso(posts: PostParaProduzir[]): Progresso {
  const total = (posts || []).length;
  if (total === 0) return { total: 0, prontos: 0, faltando: 0, porcentagem: 100 };

  const prontos = posts.filter((p) => oQueFalta(p) === null).length;
  return {
    total,
    prontos,
    faltando: total - prontos,
    porcentagem: Math.floor((prontos / total) * 100),
  };
}

/**
 * O tema que a IA recebe.
 *
 * O piloto guarda o tema em nanoPrompt, as vezes com a data comemorativa
 * entre colchetes. Uma legenda ja escrita tambem serve de tema quando so
 * falta a arte.
 */
export function temaDoPost(p: PostParaProduzir): string {
  const bruto = (p.nanoPrompt || '').trim() || (p.caption || '').trim();
  return bruto.slice(0, 500);
}
