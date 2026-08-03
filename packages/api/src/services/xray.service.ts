/**
 * Raio-X de perfil: diagnostico publico de qualquer conta profissional.
 *
 * Serve a duas coisas ao mesmo tempo: e um diagnostico util (a pessoa
 * analisa o proprio perfil E o do concorrente) e uma isca de leads — o
 * resultado e compartilhavel e leva o visitante ao cadastro.
 *
 * Usa business_discovery, endpoint OFICIAL da Graph API. Nada de scraping:
 * so devolve o que a conta ja expoe publicamente, e so para contas
 * Business/Creator.
 */

export interface MidiaPublica {
  likes: number;
  comments: number;
  timestamp?: string;
}

export interface PerfilPublico {
  username: string;
  followers: number;
  mediaCount: number;
  midias: MidiaPublica[];
}

export interface Sinal {
  texto: string;
  /** true = elogio, false = problema. Define a cor na tela. */
  bom: boolean;
}

/**
 * Taxa de engajamento: interacoes medias sobre seguidores, em porcento.
 *
 * E A metrica que compara contas de tamanhos diferentes. Um perfil de 500
 * seguidores com 50 curtidas por post esta melhor que um de 50 mil com 200
 * — e so a taxa mostra isso.
 */
export function taxaEngajamento(midias: MidiaPublica[], followers: number): number | null {
  // Sem seguidores nao existe taxa: dividir por zero daria Infinity na tela.
  if (!followers || followers <= 0) return null;
  if (!midias || midias.length === 0) return null;

  const soma = midias.reduce((s, m) => s + (m.likes || 0) + (m.comments || 0), 0);
  const media = soma / midias.length;
  return Math.round((media / followers) * 1000) / 10;
}

/**
 * Posts por semana, calculado pela distancia entre o mais novo e o mais
 * velho da amostra — nao por "posts / 4", que mentiria para quem publicou
 * tudo num dia so.
 */
export function frequenciaSemanal(midias: MidiaPublica[]): number | null {
  const datas = (midias || [])
    .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t) => !isNaN(t))
    .sort((a, b) => b - a);

  if (datas.length < 2) return null;

  const dias = (datas[0] - datas[datas.length - 1]) / 86_400_000;
  if (dias < 1) return null;

  return Math.round(((datas.length / dias) * 7) * 10) / 10;
}

/** Faixas de referencia para negocio local no Brasil. */
export const TAXA_OTIMA = 6;
export const TAXA_BOA = 3;
export const TAXA_BAIXA = 1;
export const FREQ_IDEAL_MIN = 3;
export const FREQ_IDEAL_MAX = 7;

export interface Diagnostico {
  nota: number;
  taxa: number | null;
  frequencia: number | null;
  sinais: Sinal[];
  resumo: string;
}

/**
 * O diagnostico.
 *
 * Cada sinal e acionavel: "poste mais" nao ajuda ninguem, "voce posta 1x
 * por semana, o ideal para o seu porte e 3 a 5" ajuda. E sempre sai pelo
 * menos um elogio — um raio-X que so critica o proprio perfil da pessoa
 * nao e compartilhado, e compartilhar e o ponto.
 */
export function diagnosticar(p: PerfilPublico): Diagnostico {
  const taxa = taxaEngajamento(p.midias, p.followers);
  const freq = frequenciaSemanal(p.midias);
  const sinais: Sinal[] = [];
  let nota = 50;

  if (taxa === null) {
    sinais.push({ texto: 'Não consegui medir o engajamento — a conta precisa ter posts públicos recentes.', bom: false });
  } else if (taxa >= TAXA_OTIMA) {
    nota += 30;
    sinais.push({ texto: `Engajamento de ${taxa}% — bem acima da média. Sua audiência responde de verdade.`, bom: true });
  } else if (taxa >= TAXA_BOA) {
    nota += 18;
    sinais.push({ texto: `Engajamento de ${taxa}%, acima da média do mercado.`, bom: true });
  } else if (taxa >= TAXA_BAIXA) {
    nota += 5;
    sinais.push({ texto: `Engajamento de ${taxa}%. Dá para melhorar pedindo comentário na legenda.`, bom: false });
  } else {
    nota -= 12;
    sinais.push({ texto: `Engajamento de ${taxa}% — baixo. Vale rever formato e horário dos posts.`, bom: false });
  }

  if (freq === null) {
    sinais.push({ texto: 'Poucos posts recentes para calcular sua frequência.', bom: false });
  } else if (freq < FREQ_IDEAL_MIN) {
    nota -= 15;
    sinais.push({
      texto: `Você publica ${freq}x por semana. Para negócio local, 3 a 5 vezes é o que mantém o perfil vivo.`,
      bom: false,
    });
  } else if (freq > FREQ_IDEAL_MAX * 2) {
    nota -= 8;
    sinais.push({ texto: `${freq} posts por semana é muito — o excesso cansa e o alcance cai.`, bom: false });
  } else {
    nota += 15;
    sinais.push({ texto: `Frequência de ${freq} posts por semana está no ponto.`, bom: true });
  }

  // Consistencia: um post viral no meio de posts fracos indica que o perfil
  // tem potencial nao explorado, e e uma dica valiosa de graca.
  if (p.midias.length >= 5 && taxa !== null) {
    const interacoes = p.midias.map((m) => (m.likes || 0) + (m.comments || 0));
    const media = interacoes.reduce((a, b) => a + b, 0) / interacoes.length;
    const maximo = Math.max(...interacoes);
    if (media > 0 && maximo >= media * 3) {
      sinais.push({
        texto: 'Um dos seus posts rendeu 3x mais que a média. Vale repetir o formato dele.',
        bom: true,
      });
    }
  }

  // Comentario e o que o algoritmo mais premia; conta que so recebe curtida
  // esta deixando alcance na mesa.
  const totalComentarios = p.midias.reduce((s, m) => s + (m.comments || 0), 0);
  const totalCurtidas = p.midias.reduce((s, m) => s + (m.likes || 0), 0);
  if (totalCurtidas > 50 && totalComentarios < totalCurtidas * 0.01) {
    nota -= 6;
    sinais.push({
      texto: 'Quase ninguém comenta nos seus posts. Termine a legenda com uma pergunta.',
      bom: false,
    });
  }

  nota = Math.max(10, Math.min(95, Math.round(nota)));

  const resumo = nota >= 75 ? 'Seu perfil está bem cuidado.'
    : nota >= 50 ? 'Seu perfil está no caminho, com pontos claros para melhorar.'
      : 'Seu perfil tem bastante espaço para crescer.';

  return { nota, taxa, frequencia: freq, sinais, resumo };
}

/** Tira o @ e o resto que a pessoa cola junto (URL inteira, espaços). */
export function normalizarUsername(bruto: string): string {
  return (bruto || '')
    .trim()
    // O protocolo e opcional de proposito: quase ninguem cola "https://".
    // Sem isso, "instagram.com/essenza" era cortado no primeiro / e virava
    // a busca pelo perfil "instagram.com".
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 30);
}

/**
 * Consulta o perfil pelo business_discovery.
 *
 * Devolve `null` com motivo em vez de lancar: perfil pessoal, inexistente
 * ou privado sao respostas NORMAIS aqui, nao erros do sistema.
 */
export async function consultarPerfil(
  alvo: string,
  igUserId: string,
  token: string,
): Promise<{ perfil: PerfilPublico | null; motivo?: string }> {
  const username = normalizarUsername(alvo);
  if (username.length < 2) return { perfil: null, motivo: 'Digite um @ válido.' };

  const campos = `business_discovery.username(${username}){username,followers_count,media_count,`
    + 'media.limit(24){like_count,comments_count,timestamp}}';

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}?fields=${encodeURIComponent(campos)}&access_token=${token}`,
    );
    const j = (await r.json()) as any;

    if (j?.error) {
      const codigo = Number(j.error.code);
      // Token vencido (190) e limite estourado (4, 17, 32, 613) sao
      // problemas NOSSOS, nao do perfil consultado. Traduzir tudo para
      // "perfil nao encontrado" escondia a causa e faria a pagina publica
      // parecer quebrada para todo mundo, sem nenhum sinal no log.
      if (codigo === 190 || codigo === 102) {
        console.error('[RaioX] Token invalido ou expirado:', j.error.message);
        return { perfil: null, motivo: 'O raio-X está temporariamente indisponível. Tente mais tarde.' };
      }
      if ([4, 17, 32, 613].includes(codigo)) {
        console.warn('[RaioX] Limite da Graph API atingido:', j.error.message);
        return { perfil: null, motivo: 'Muitas consultas agora. Tente de novo em alguns minutos.' };
      }

      // O Meta devolve o mesmo erro para "nao existe" e "nao e Business",
      // entao explicamos as duas possibilidades em vez de chutar uma.
      return {
        perfil: null,
        motivo: 'Não encontrei esse perfil. Ele precisa ser uma conta Profissional (Comercial ou Criador de conteúdo) e pública.',
      };
    }

    const bd = j?.business_discovery;
    if (!bd) return { perfil: null, motivo: 'Não consegui ler esse perfil.' };

    return {
      perfil: {
        username: bd.username || username,
        followers: bd.followers_count || 0,
        mediaCount: bd.media_count || 0,
        midias: (bd.media?.data || []).map((m: any) => ({
          likes: m.like_count || 0,
          comments: m.comments_count || 0,
          timestamp: m.timestamp,
        })),
      },
    };
  } catch (err) {
    return { perfil: null, motivo: (err as Error).message };
  }
}
