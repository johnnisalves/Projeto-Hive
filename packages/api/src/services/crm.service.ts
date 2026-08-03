/**
 * Micro-CRM do inbox: a DM com intencao de compra vira lead com valor.
 *
 * A IA do inbox ja classifica intencao. O que faltava era materializar isso
 * num funil, para a agencia parar de reportar "respondemos 80 DMs" e passar
 * a reportar "as DMs viraram R$ 3.200".
 *
 * O funil e DELIBERADAMENTE curto. Um CRM de sete etapas nao e preenchido
 * por quem atende no balcao entre um pedido e outro — e funil nao
 * preenchido nao vale nada.
 */

export const ETAPAS = ['novo', 'respondido', 'orcamento', 'fechado', 'perdido'] as const;
export type Etapa = typeof ETAPAS[number];

/** Etapas em que o lead ainda pode virar dinheiro. */
export const ETAPAS_ABERTAS: Etapa[] = ['novo', 'respondido', 'orcamento'];
/** Etapas que encerram o lead. */
export const ETAPAS_FINAIS: Etapa[] = ['fechado', 'perdido'];

export const ROTULOS: Record<Etapa, string> = {
  novo: 'Novo',
  respondido: 'Respondido',
  orcamento: 'Orçamento enviado',
  fechado: 'Fechado',
  perdido: 'Perdido',
};

/**
 * A mudanca de etapa e valida?
 *
 * Voltar atras E PERMITIDO de proposito: no mundo real o cliente some, o
 * atendente marca "perdido" e ele volta duas semanas depois. Um funil que
 * so anda para frente forcaria criar um lead duplicado, e a atribuicao ao
 * post de origem se perderia.
 *
 * O unico movimento barrado e o que nao muda nada.
 */
export function podeMover(de: Etapa, para: Etapa): boolean {
  if (!ETAPAS.includes(de) || !ETAPAS.includes(para)) return false;
  return de !== para;
}

/**
 * Fechar exige valor.
 *
 * Um lead "fechado" sem valor destroi o unico numero que o funil existe
 * para produzir — e depois ninguem lembra quanto foi.
 */
export function exigeValor(etapa: Etapa): boolean {
  return etapa === 'fechado';
}

export interface Lead {
  etapa: Etapa;
  valorCentavos?: number | null;
  postId?: string | null;
  criadoEm: Date;
  fechadoEm?: Date | null;
}

export interface ResumoFunil {
  porEtapa: Record<Etapa, { leads: number; valorCentavos: number }>;
  abertos: number;
  fechados: number;
  perdidos: number;
  receitaCentavos: number;
  /** Fechados sobre (fechados + perdidos). Null quando nada foi decidido ainda. */
  taxaConversao: number | null;
  /** Valor medio dos leads fechados. Null quando nao ha fechamento. */
  ticketMedioCentavos: number | null;
}

/**
 * O funil em numeros.
 *
 * A taxa de conversao usa fechados / (fechados + perdidos), nao
 * fechados / total: leads que ainda estao abertos nao perderam nada, e
 * conta-los no denominador faria a taxa despencar so por ter movimento
 * novo no inbox — punindo justamente a semana em que o marketing funcionou.
 */
export function resumoDoFunil(leads: Lead[]): ResumoFunil {
  const porEtapa = Object.fromEntries(
    ETAPAS.map((e) => [e, { leads: 0, valorCentavos: 0 }]),
  ) as ResumoFunil['porEtapa'];

  for (const l of leads || []) {
    const etapa = ETAPAS.includes(l.etapa) ? l.etapa : 'novo';
    porEtapa[etapa].leads++;
    porEtapa[etapa].valorCentavos += l.valorCentavos || 0;
  }

  const fechados = porEtapa.fechado.leads;
  const perdidos = porEtapa.perdido.leads;
  const decididos = fechados + perdidos;
  const receitaCentavos = porEtapa.fechado.valorCentavos;

  return {
    porEtapa,
    abertos: ETAPAS_ABERTAS.reduce((s, e) => s + porEtapa[e].leads, 0),
    fechados,
    perdidos,
    receitaCentavos,
    taxaConversao: decididos > 0 ? Math.round((fechados / decididos) * 100) : null,
    ticketMedioCentavos: fechados > 0 ? Math.round(receitaCentavos / fechados) : null,
  };
}

/**
 * Quais posts geraram mais dinheiro em leads fechados.
 *
 * E a ponte entre o funil e a atribuicao: responde "esse post vendeu?" com
 * conversa e valor reais, nao com proxy de engajamento.
 */
export function receitaPorPost(leads: Lead[]): Array<{ postId: string; leads: number; receitaCentavos: number }> {
  const mapa = new Map<string, { leads: number; receitaCentavos: number }>();

  for (const l of leads || []) {
    if (!l.postId) continue;
    const atual = mapa.get(l.postId) || { leads: 0, receitaCentavos: 0 };
    atual.leads++;
    // So o que FECHOU vira receita. Somar orcamento enviado como receita
    // inflaria o numero que a agencia leva pro cliente.
    if (l.etapa === 'fechado') atual.receitaCentavos += l.valorCentavos || 0;
    mapa.set(l.postId, atual);
  }

  return Array.from(mapa.entries())
    .map(([postId, v]) => ({ postId, ...v }))
    .sort((a, b) => b.receitaCentavos - a.receitaCentavos || b.leads - a.leads);
}

/** Dias sem mexer no lead. Serve para o alerta de lead esquecido. */
export const DIAS_PARADO = 3;

export function paradoHaDias(lead: { etapa: Etapa; atualizadoEm: Date }, agora = new Date()): number | null {
  // Lead finalizado nao esta parado: esta pronto.
  if (ETAPAS_FINAIS.includes(lead.etapa)) return null;
  return Math.floor((agora.getTime() - new Date(lead.atualizadoEm).getTime()) / 86_400_000);
}

export function esquecidos<T extends { etapa: Etapa; atualizadoEm: Date }>(
  leads: T[],
  agora = new Date(),
): T[] {
  return (leads || [])
    .filter((l) => {
      const dias = paradoHaDias(l, agora);
      return dias !== null && dias >= DIAS_PARADO;
    })
    .sort((a, b) => new Date(a.atualizadoEm).getTime() - new Date(b.atualizadoEm).getTime());
}
