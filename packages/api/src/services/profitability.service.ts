/**
 * Rentabilidade por marca: qual cliente da lucro e qual da prejuizo.
 *
 * Nenhuma ferramenta de social media responde isso. E a pergunta que
 * reposiciona o DisparaAI de "ferramenta de postagem" para "sistema de
 * gestao da agencia" — porque e a unica que muda decisao de negocio
 * (renegociar, subir o fee, ou devolver o cliente).
 *
 * TUDO AQUI E ESTIMATIVA, e o codigo trata como tal. Vender um numero
 * desses como exato faria a agencia demitir um cliente com base numa
 * conta que ela nao conferiu.
 */

export interface Esforco {
  /** Posts criados no periodo. */
  posts: number;
  /** Posts que tiveram arte gerada (custa mais que so escrever legenda). */
  artes: number;
  /** Respostas de inbox (comentario ou DM). */
  respostas: number;
  /** Tarefas concluidas ligadas a marca. */
  tarefas: number;
}

/**
 * Minutos por atividade.
 *
 * Sao valores de referencia de operacao de agencia pequena, e ficam
 * configuraveis: uma agencia que so agenda gasta menos que uma que produz
 * a arte do zero, e chutar por ela geraria um numero sem relacao com a
 * realidade dela.
 */
export const MINUTOS_PADRAO = { post: 20, arte: 15, resposta: 3, tarefa: 30 };
export type TabelaMinutos = typeof MINUTOS_PADRAO;

export function minutosGastos(e: Esforco, tabela: TabelaMinutos = MINUTOS_PADRAO): number {
  return (
    (e.posts || 0) * tabela.post
    + (e.artes || 0) * tabela.arte
    + (e.respostas || 0) * tabela.resposta
    + (e.tarefas || 0) * tabela.tarefa
  );
}

/**
 * Custo em centavos.
 *
 * Arredonda uma vez no fim, nao a cada parcela: arredondar por atividade
 * acumularia erro e o total nao fecharia com a soma das linhas na tela.
 */
export function custoCentavos(minutos: number, custoHoraCentavos: number): number {
  if (!custoHoraCentavos || custoHoraCentavos <= 0) return 0;
  return Math.round((minutos / 60) * custoHoraCentavos);
}

export type Situacao = 'saudavel' | 'apertado' | 'prejuizo';

/** Abaixo de 30% de margem, o cliente nao paga a estrutura da agencia. */
export const MARGEM_SAUDAVEL = 30;

export function classificar(margemPct: number): Situacao {
  if (margemPct < 0) return 'prejuizo';
  return margemPct < MARGEM_SAUDAVEL ? 'apertado' : 'saudavel';
}

export interface Resultado {
  minutos: number;
  custoCentavos: number;
  feeCentavos: number;
  margemCentavos: number;
  margemPct: number;
  situacao: Situacao;
}

/**
 * A conta da marca.
 *
 * Devolve null quando falta fee OU custo/hora: sem um dos dois nao existe
 * margem, e mostrar "0% de margem" seria pior que nao mostrar nada — a
 * agencia leria como prejuizo.
 */
export function calcular(
  esforco: Esforco,
  feeCentavos: number | null | undefined,
  custoHoraCentavos: number | null | undefined,
  tabela: TabelaMinutos = MINUTOS_PADRAO,
): Resultado | null {
  if (!feeCentavos || feeCentavos <= 0) return null;
  if (!custoHoraCentavos || custoHoraCentavos <= 0) return null;

  const minutos = minutosGastos(esforco, tabela);
  const custo = custoCentavos(minutos, custoHoraCentavos);
  const margemCentavos = feeCentavos - custo;
  const margemPct = Math.round((margemCentavos / feeCentavos) * 100);

  return {
    minutos,
    custoCentavos: custo,
    feeCentavos,
    margemCentavos,
    margemPct,
    situacao: classificar(margemPct),
  };
}

/**
 * Quanto a agencia teria que cobrar para chegar na margem alvo.
 *
 * E o numero acionavel: "esse cliente precisa passar de R$ 800 para
 * R$ 1.400" resolve, enquanto "margem de 12%" so informa.
 */
export function feeSugerido(custoCentavos: number, margemAlvoPct = MARGEM_SAUDAVEL): number {
  if (custoCentavos <= 0) return 0;
  // Margem de 100% ou mais e impossivel: o preco tenderia ao infinito.
  const alvo = Math.min(95, Math.max(0, margemAlvoPct));
  return Math.round(custoCentavos / (1 - alvo / 100));
}

export interface LinhaRentabilidade extends Partial<Resultado> {
  id: string;
  nome: string;
  esforco: Esforco;
  /** Null quando falta fee ou custo/hora configurado. */
  temConta: boolean;
  feeSugeridoCentavos?: number;
}

/**
 * A carteira ordenada por quem sangra primeiro.
 *
 * Marcas sem conta possivel vao para o FIM, nao para o topo: elas nao sao
 * um problema, so estao sem configuracao — e enche-las no topo esconderia
 * os clientes que realmente dao prejuizo.
 */
export function ranquear(linhas: LinhaRentabilidade[]): LinhaRentabilidade[] {
  return [...linhas].sort((a, b) => {
    if (a.temConta !== b.temConta) return a.temConta ? -1 : 1;
    if (!a.temConta) return a.nome.localeCompare(b.nome, 'pt-BR');
    return (a.margemPct ?? 0) - (b.margemPct ?? 0);
  });
}
