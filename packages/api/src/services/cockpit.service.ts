/**
 * Cockpit: as marcas da carteira numa tela so, pior primeiro.
 *
 * Hoje o dono da agencia precisa abrir marca por marca para descobrir que
 * um token venceu ou que a grade de um cliente esta vazia — e normalmente
 * descobre pelo WhatsApp do proprio cliente.
 *
 * A ORDEM E O PRODUTO. Uma lista alfabetica de 40 marcas nao ajuda
 * ninguem; o que ajuda e "estas tres precisam de voce hoje".
 */

export type Gravidade = 'critico' | 'atencao' | 'ok';

export interface Sinal {
  tipo: string;
  gravidade: Gravidade;
  texto: string;
}

export interface DadosDaMarca {
  id: string;
  nome: string;
  /** Posts agendados nos proximos 7 dias. */
  agendados7d: number;
  /** Posts que falharam ao publicar nas ultimas 24h. */
  falhas24h: number;
  /** Posts esperando o cliente aprovar ha mais de 48h. */
  aprovacoesParadas: number;
  /** Dias ate o token do Instagram vencer. null = sem conta conectada. */
  diasAteTokenVencer: number | null;
  /** Ultima publicacao bem-sucedida. null = nunca publicou. */
  ultimaPublicacao: Date | null;
}

/**
 * Limiares.
 *
 * GRADE_MINIMA e 3 porque abaixo disso a marca fica menos de dois dias no
 * ar com a cadencia tipica — e quando a agencia percebe, ja passou.
 */
export const GRADE_MINIMA = 3;
export const TOKEN_CRITICO_DIAS = 7;
export const TOKEN_ATENCAO_DIAS = 21;
export const SILENCIO_CRITICO_DIAS = 14;

/**
 * O que esta errado nesta marca.
 *
 * Falha de publicacao vem SEMPRE primeiro: e o unico sinal que significa
 * que algo ja deu errado, e nao que vai dar. Os outros sao prevencao.
 */
export function sinaisDaMarca(d: DadosDaMarca, agora = new Date()): Sinal[] {
  const sinais: Sinal[] = [];

  if (d.falhas24h > 0) {
    sinais.push({
      tipo: 'falha_publicacao',
      gravidade: 'critico',
      texto: `${d.falhas24h} post${d.falhas24h > 1 ? 's' : ''} falhou ao publicar nas últimas 24h.`,
    });
  }

  // Sem conta conectada nao e "token vencendo": e a marca inteira parada.
  if (d.diasAteTokenVencer === null) {
    sinais.push({ tipo: 'sem_conta', gravidade: 'critico', texto: 'Nenhuma conta do Instagram conectada.' });
  } else if (d.diasAteTokenVencer <= 0) {
    sinais.push({ tipo: 'token_vencido', gravidade: 'critico', texto: 'O acesso ao Instagram venceu. Nada será publicado.' });
  } else if (d.diasAteTokenVencer <= TOKEN_CRITICO_DIAS) {
    sinais.push({
      tipo: 'token_expirando',
      gravidade: 'critico',
      texto: `O acesso ao Instagram vence em ${d.diasAteTokenVencer} dia${d.diasAteTokenVencer > 1 ? 's' : ''}.`,
    });
  } else if (d.diasAteTokenVencer <= TOKEN_ATENCAO_DIAS) {
    sinais.push({
      tipo: 'token_expirando',
      gravidade: 'atencao',
      texto: `O acesso ao Instagram vence em ${d.diasAteTokenVencer} dias.`,
    });
  }

  if (d.agendados7d === 0) {
    sinais.push({ tipo: 'grade_vazia', gravidade: 'critico', texto: 'Nada agendado para os próximos 7 dias.' });
  } else if (d.agendados7d < GRADE_MINIMA) {
    sinais.push({
      tipo: 'grade_magra',
      gravidade: 'atencao',
      texto: `Só ${d.agendados7d} post${d.agendados7d > 1 ? 's' : ''} agendado${d.agendados7d > 1 ? 's' : ''} para a semana.`,
    });
  }

  if (d.aprovacoesParadas > 0) {
    sinais.push({
      tipo: 'aprovacao_parada',
      gravidade: 'atencao',
      texto: `${d.aprovacoesParadas} post${d.aprovacoesParadas > 1 ? 's' : ''} esperando o cliente aprovar há mais de 2 dias.`,
    });
  }

  // Marca que nunca publicou nao esta em silencio: esta em onboarding, e
  // tratar como abandono geraria alarme em todo cliente novo.
  if (d.ultimaPublicacao) {
    const dias = Math.floor((agora.getTime() - new Date(d.ultimaPublicacao).getTime()) / 86_400_000);
    if (dias >= SILENCIO_CRITICO_DIAS) {
      sinais.push({ tipo: 'silencio', gravidade: 'critico', texto: `Sem publicar há ${dias} dias.` });
    }
  }

  return sinais;
}

const PESO: Record<Gravidade, number> = { critico: 30, atencao: 12, ok: 0 };

/**
 * Nota de saude, de 0 a 100.
 *
 * Serve para ORDENAR, nao para ser exibida como verdade absoluta. Por isso
 * a tela mostra os sinais, nao o numero — e o numero so decide quem sobe.
 */
export function notaDeSaude(sinais: Sinal[]): number {
  const perda = sinais.reduce((s, x) => s + PESO[x.gravidade], 0);
  return Math.max(0, 100 - perda);
}

export function gravidadeMaxima(sinais: Sinal[]): Gravidade {
  if (sinais.some((s) => s.gravidade === 'critico')) return 'critico';
  if (sinais.some((s) => s.gravidade === 'atencao')) return 'atencao';
  return 'ok';
}

export interface LinhaCockpit extends DadosDaMarca {
  sinais: Sinal[];
  nota: number;
  gravidade: Gravidade;
}

/**
 * A carteira ordenada: quem precisa de atencao primeiro.
 *
 * Desempate por NOME, nao pela ordem que veio do banco: sem isso a lista
 * dancaria a cada atualizacao e o usuario perderia o lugar onde estava.
 */
export function montarCockpit(marcas: DadosDaMarca[], agora = new Date()): LinhaCockpit[] {
  return (marcas || [])
    .map((m) => {
      const sinais = sinaisDaMarca(m, agora);
      return { ...m, sinais, nota: notaDeSaude(sinais), gravidade: gravidadeMaxima(sinais) };
    })
    .sort((a, b) => (a.nota !== b.nota ? a.nota - b.nota : a.nome.localeCompare(b.nome, 'pt-BR')));
}

/** Resumo de uma linha para o topo da tela. */
export function resumoDaCarteira(linhas: LinhaCockpit[]): {
  total: number; criticas: number; atencao: number; ok: number;
} {
  return {
    total: linhas.length,
    criticas: linhas.filter((l) => l.gravidade === 'critico').length,
    atencao: linhas.filter((l) => l.gravidade === 'atencao').length,
    ok: linhas.filter((l) => l.gravidade === 'ok').length,
  };
}
