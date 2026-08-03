/**
 * Playbooks de nicho: a configuracao de uma marca vira modelo reaproveitavel.
 *
 * A agencia guarda um playbook por nicho (pizzaria, barbearia, clinica) e,
 * ao fechar cliente novo, aplica em vez de configurar do zero. Onboarding
 * de uma semana vira uma hora — e onboarding e onde a agencia perde margem.
 *
 * O PERIGO REAL NAO E COPIAR DE MENOS, E COPIAR DE MAIS.
 *
 * Copiar a chave PIX de um cliente para outro manda dinheiro para a conta
 * errada. Copiar o WhatsApp faz o pedido de uma pizzaria cair no celular
 * de outra. Copiar o token do portal de aprovacao da a um cliente acesso
 * aos posts do outro. Por isso a lista do que se copia e uma ALLOWLIST
 * explicita: campo novo no schema nao entra no playbook por descuido.
 */

/** O que E estilo e configuracao de nicho — pode ser reaproveitado. */
export const CAMPOS_DO_PLAYBOOK = [
  'voiceTone',
  'tonePrompt',
  'stylePrompt',
  'artDirection',
  'defaultHashtags',
  'defaultPlatforms',
  'mixVender',
  'mixEducar',
  'mixEngajar',
  'cpmCentavos',
  'autoPublicarPilares',
] as const;

/** Cores sao opcionais: nicho parecido nao significa identidade visual igual. */
export const CAMPOS_VISUAIS = [
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'fontFamily',
  'headingFont',
  'bodyFont',
] as const;

/**
 * O que NUNCA sai de uma marca para outra.
 *
 * Esta lista existe para ser lida por gente, nao pelo codigo: a protecao
 * de verdade e a allowlist acima. Vazar qualquer um destes causa dano
 * financeiro ou de privacidade, nao so configuracao errada.
 */
export const NUNCA_COPIAR = [
  'id', 'userId', 'name', 'logoUrl',
  'pixKey', 'pixCity', 'whatsappPhone', 'phone', 'feeCentavos',
  'websiteUrl', 'instagramUrl', 'cidade',
  'bioSlug', 'approvalToken', 'isDefault',
  'createdAt', 'updatedAt',
] as const;

export interface Playbook {
  versao: number;
  nome: string;
  nicho?: string;
  config: Record<string, any>;
  visual?: Record<string, any>;
}

export const VERSAO_ATUAL = 1;

/**
 * Tira o playbook de uma marca ja configurada.
 *
 * Campo vazio nao entra: aplicar um playbook nao pode APAGAR o que o
 * usuario ja preencheu na marca nova.
 */
export function exportar(
  marca: Record<string, any>,
  opcoes: { nome: string; nicho?: string; incluirVisual?: boolean },
): Playbook {
  const pega = (campos: readonly string[]) => {
    const out: Record<string, any> = {};
    for (const c of campos) {
      const v = marca[c];
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[c] = v;
    }
    return out;
  };

  return {
    versao: VERSAO_ATUAL,
    nome: opcoes.nome,
    nicho: opcoes.nicho,
    config: pega(CAMPOS_DO_PLAYBOOK),
    ...(opcoes.incluirVisual ? { visual: pega(CAMPOS_VISUAIS) } : {}),
  };
}

/**
 * Monta o que vai ser gravado na marca de destino.
 *
 * Passa pela allowlist DE NOVO na aplicacao, nao so na exportacao: o
 * playbook pode ter sido editado a mao ou vindo de outra instalacao, e
 * confiar no conteudo dele seria confiar em entrada externa.
 */
export function aplicar(playbook: Playbook, opcoes: { aplicarVisual?: boolean } = {}): Record<string, any> {
  const permitido = new Set<string>([...CAMPOS_DO_PLAYBOOK]);
  if (opcoes.aplicarVisual) for (const c of CAMPOS_VISUAIS) permitido.add(c);

  const origem = { ...(playbook?.config || {}), ...(opcoes.aplicarVisual ? playbook?.visual || {} : {}) };

  const dados: Record<string, any> = {};
  for (const [chave, valor] of Object.entries(origem)) {
    if (!permitido.has(chave)) continue;
    if (valor === null || valor === undefined || valor === '') continue;
    dados[chave] = valor;
  }
  return dados;
}

/** O playbook e valido? Serve para arquivo colado ou importado de fora. */
export function validar(bruto: any): { ok: boolean; erro?: string; playbook?: Playbook } {
  if (!bruto || typeof bruto !== 'object') return { ok: false, erro: 'Formato inválido.' };
  if (typeof bruto.nome !== 'string' || !bruto.nome.trim()) return { ok: false, erro: 'O playbook precisa de um nome.' };
  if (!bruto.config || typeof bruto.config !== 'object') return { ok: false, erro: 'O playbook está sem configuração.' };

  // Versao maior que a nossa veio de uma instalacao mais nova; aplicar
  // poderia gravar campo com formato que este codigo nao entende.
  if (Number(bruto.versao) > VERSAO_ATUAL) {
    return { ok: false, erro: 'Este playbook foi criado numa versão mais nova do DisparaAI.' };
  }

  return { ok: true, playbook: bruto as Playbook };
}

/** O que o usuario vai ver antes de aplicar, em portugues. */
const ROTULOS: Record<string, string> = {
  voiceTone: 'tom de voz',
  tonePrompt: 'instruções de tom para a IA',
  stylePrompt: 'instruções de estilo visual',
  artDirection: 'direção de arte',
  defaultHashtags: 'hashtags padrão',
  defaultPlatforms: 'canais padrão',
  mixVender: 'mix de conteúdo',
  mixEducar: 'mix de conteúdo',
  mixEngajar: 'mix de conteúdo',
  cpmCentavos: 'CPM de referência',
  autoPublicarPilares: 'pilares com publicação automática',
  primaryColor: 'cores', secondaryColor: 'cores', accentColor: 'cores',
  fontFamily: 'fontes', headingFont: 'fontes', bodyFont: 'fontes',
};

export function resumir(dados: Record<string, any>): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const chave of Object.keys(dados)) {
    const rotulo = ROTULOS[chave] || chave;
    if (vistos.has(rotulo)) continue;
    vistos.add(rotulo);
    out.push(rotulo);
  }
  return out;
}
