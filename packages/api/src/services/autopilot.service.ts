import { datasDoMes, DataComemorativa } from './calendar-br';

/**
 * Piloto automatico: monta o plano de conteudo de um mes inteiro.
 *
 * A parte dificil nao e gerar texto — e decidir O QUE postar em cada dia.
 * Este arquivo resolve isso e nada mais: entra "quantos posts por semana"
 * e o perfil da marca, sai uma lista de pautas com data, tema e objetivo.
 * A geracao de arte e legenda acontece depois, reusando o que ja existe.
 *
 * Logica pura, sem banco e sem IA, para poder ser testada de verdade.
 */

/** Objetivo de cada post. Espelha os modos que o caption.service ja aceita. */
export type Pilar = 'vender' | 'educar' | 'engajar';

export interface Pauta {
  data: Date;
  /** Assunto para a IA desenvolver. */
  tema: string;
  pilar: Pilar;
  /** Preenchido quando a pauta nasceu de uma data comemorativa. */
  dataComemorativa?: string;
  /** 3 = data forte, 1 = post de rotina. Ordena o que nao pode faltar. */
  prioridade: 1 | 2 | 3;
}

/**
 * Mistura padrao dos pilares.
 *
 * Vender demais cansa e derruba alcance; so educar nao paga a conta. A
 * proporcao 3-4-3 e o meio-termo que a maioria das marcas locais aguenta.
 */
export const MIX_PADRAO: Record<Pilar, number> = { vender: 3, educar: 4, engajar: 3 };

/** Temas de rotina por pilar, usados nos dias sem data comemorativa. */
const TEMAS_ROTINA: Record<Pilar, string[]> = {
  vender: [
    'Destaque de um produto ou serviço com o diferencial dele',
    'Oferta ou condição especial da semana',
    'Depoimento de cliente satisfeito',
    'Antes e depois de um trabalho entregue',
    'Combo ou sugestão que aumenta o ticket',
  ],
  educar: [
    'Dica prática que resolve uma dúvida comum do cliente',
    'Erro que as pessoas cometem e como evitar',
    'Passo a passo simples relacionado ao seu produto',
    'Mito x verdade sobre o seu ramo',
    'Como escolher o produto certo para cada necessidade',
    'Curiosidade sobre como o produto é feito',
  ],
  engajar: [
    'Bastidores do dia a dia da equipe',
    'Pergunta para o público responder nos comentários',
    'Enquete entre duas opções do seu catálogo',
    'História de como o negócio começou',
    'Apresentação de um membro da equipe',
  ],
};

/**
 * Distribui os posts pelos dias do mes.
 *
 * Regras que importam:
 *  - data comemorativa forte SEMPRE vira post, mesmo estourando o ritmo;
 *  - o resto se espalha para nao concentrar tudo numa semana;
 *  - nada e agendado no passado quando o mes ja comecou.
 */
export function planejarMes(opcoes: {
  ano: number;
  mes: number;
  postsPorSemana: number;
  ramo?: string;
  /** Referencia de "agora"; o padrao e a data corrente. */
  hoje?: Date;
  mix?: Record<Pilar, number>;
}): Pauta[] {
  const { ano, mes, ramo } = opcoes;
  const postsPorSemana = Math.max(1, Math.min(Math.round(opcoes.postsPorSemana), 14));
  const hoje = opcoes.hoje ?? new Date();
  const mix = opcoes.mix ?? MIX_PADRAO;

  const diasNoMes = new Date(ano, mes, 0).getDate();

  // Se o mes ja comecou, so planeja daqui para frente.
  const mesAtual = hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes;
  const primeiroDia = mesAtual ? hoje.getDate() + 1 : 1;
  if (primeiroDia > diasNoMes) return [];

  const comemorativas = datasDoMes(ano, mes, ramo).filter((d) => d.dia >= primeiroDia);
  const pautas: Pauta[] = [];
  const diasUsados = new Set<number>();

  // 1. Datas comemorativas primeiro — sao os dias que nao podem faltar.
  for (const d of comemorativas) {
    pautas.push({
      data: new Date(ano, mes - 1, d.dia),
      tema: temaParaData(d),
      pilar: d.peso === 3 ? 'vender' : 'engajar',
      dataComemorativa: d.nome,
      prioridade: d.peso,
    });
    diasUsados.add(d.dia);
  }

  // 2. Completa com rotina ate atingir o volume pedido.
  const diasDisponiveis = diasNoMes - primeiroDia + 1;
  const alvo = Math.round((diasDisponiveis / 7) * postsPorSemana);
  const faltam = Math.max(0, alvo - pautas.length);

  if (faltam > 0) {
    const livres = [];
    for (let dia = primeiroDia; dia <= diasNoMes; dia++) {
      if (!diasUsados.has(dia)) livres.push(dia);
    }

    // Espalha em vez de pegar os primeiros: um passo proporcional evita
    // concentrar o mes inteiro na primeira semana.
    const passo = Math.max(1, Math.floor(livres.length / faltam));
    const sequencia = sequenciaDePilares(faltam, mix);

    for (let i = 0; i < faltam && i * passo < livres.length; i++) {
      const dia = livres[i * passo];
      const pilar = sequencia[i];
      pautas.push({
        data: new Date(ano, mes - 1, dia),
        tema: TEMAS_ROTINA[pilar][i % TEMAS_ROTINA[pilar].length],
        pilar,
        prioridade: 1,
      });
    }
  }

  return pautas.sort((a, b) => a.data.getTime() - b.data.getTime());
}

/**
 * Sequencia de pilares que respeita a proporcao pedida.
 *
 * Intercalado de proposito: agrupar geraria uma semana so de venda seguida
 * de uma semana so de dica, e o perfil ficaria estranho.
 */
export function sequenciaDePilares(quantidade: number, mix: Record<Pilar, number>): Pilar[] {
  const total = mix.vender + mix.educar + mix.engajar;
  if (total <= 0) return Array(quantidade).fill('educar');

  const cotas: Array<{ pilar: Pilar; restante: number }> = [
    { pilar: 'vender', restante: (mix.vender / total) * quantidade },
    { pilar: 'educar', restante: (mix.educar / total) * quantidade },
    { pilar: 'engajar', restante: (mix.engajar / total) * quantidade },
  ];

  const saida: Pilar[] = [];
  for (let i = 0; i < quantidade; i++) {
    // A cada passo escolhe quem esta mais "devendo" post.
    cotas.sort((a, b) => b.restante - a.restante);
    saida.push(cotas[0].pilar);
    cotas[0].restante -= 1;
  }
  return saida;
}

/** Vira o texto que a IA recebe como assunto do post. */
function temaParaData(d: DataComemorativa & { dia: number }): string {
  if (d.peso === 3) {
    return `${d.nome}: post comemorativo conectando a data ao que o negócio vende, com chamada para ação`;
  }
  return `${d.nome}: post leve celebrando a data, conectado ao universo do negócio`;
}

/** Resumo para mostrar antes de gerar as artes. */
export function resumoDoPlano(pautas: Pauta[]): {
  total: number; comemorativas: number; porPilar: Record<Pilar, number>;
} {
  const porPilar: Record<Pilar, number> = { vender: 0, educar: 0, engajar: 0 };
  for (const p of pautas) porPilar[p.pilar]++;
  return {
    total: pautas.length,
    comemorativas: pautas.filter((p) => p.dataComemorativa).length,
    porPilar,
  };
}
