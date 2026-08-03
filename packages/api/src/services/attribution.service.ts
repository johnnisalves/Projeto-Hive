import { prisma } from '../config/database';

/**
 * Atribuicao: ligar post a dinheiro no caixa.
 *
 * Sao tres caminhos, do mais simples ao mais completo, porque o comercio
 * brasileiro nao e homogeneo:
 *
 * 1. LINK RASTREAVEL — cada post ganha um link curto proprio que conta o
 *    clique e leva ao WhatsApp com uma mensagem que carrega o codigo do
 *    post. Quando a conversa chega, ela ja nasce atribuida.
 * 2. CUPOM — codigo curto na arte, resgatado no balcao. Serve para a loja
 *    de rua que nunca tera pixel nem e-commerce.
 * 3. MODO BALCAO — dois toques por venda ("veio do Instagram", R$ 80).
 *    E o degrau zero: funciona no dia seguinte, sem treinar ninguem.
 */

/**
 * Alfabeto sem 0/O, 1/I/L: sao os pares que a pessoa erra ao ler o codigo
 * da arte em voz alta ou digitar no caixa. Um codigo ilegivel vira venda
 * nao atribuida, que e exatamente o que estamos tentando resolver.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function gerarCodigoCurto(tamanho = 6): string {
  let s = '';
  for (let i = 0; i < tamanho; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return s;
}

/**
 * Codigo de cupom legivel: prefixo da marca + sufixo curto.
 * "ESSENZA-K4T" e melhor que "a8f3d9" para quem le no story e fala no balcao.
 */
export function gerarCodigoCupom(nomeMarca: string): string {
  const prefixo = (nomeMarca || 'PROMO')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8) || 'PROMO';
  return `${prefixo}-${gerarCodigoCurto(3)}`;
}

/**
 * Telefone brasileiro no formato que o wa.me exige: so digitos, com o 55 na
 * frente.
 *
 * O TAMANHO e o que decide se o 55 ja esta la, nunca o prefixo: o DDD 55
 * existe (Santa Maria/RS), entao "55999998888" pode ser DDD 55 + celular.
 * Olhar so o inicio faria numeros de uma regiao inteira virarem lixo.
 */
export function normalizarTelefone(bruto: string): string | null {
  let d = (bruto || '').replace(/\D/g, '');
  // Prefixo de operadora ("0" antes do DDD) que a pessoa digita por habito.
  if (d.length > 11 && d.startsWith('0')) d = d.replace(/^0+/, '');

  if (d.length === 13 || d.length === 12) return d.startsWith('55') ? d : null;
  if (d.length === 11 || d.length === 10) return `55${d}`;
  // 8 ou 9 digitos: veio sem DDD e nao da para adivinhar a regiao.
  return null;
}

/**
 * Link do WhatsApp com mensagem pronta e o codigo do post embutido.
 *
 * O codigo entre colchetes e o que amarra a conversa ao post. Fica visivel
 * (nao da para esconder texto no wa.me), entao vai no fim e curto, para
 * parecer referencia de pedido em vez de rastreador.
 */
export function montarLinkWhatsapp(telefone: string, mensagem: string, codigo?: string | null): string | null {
  const fone = normalizarTelefone(telefone);
  if (!fone) return null;
  const texto = codigo ? `${mensagem} [${codigo}]` : mensagem;
  return `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
}

/**
 * Acha o codigo de rastreio na primeira mensagem que o cliente manda.
 * Aceita [ABC123] e #ABC123, porque o cliente as vezes reescreve a mensagem.
 */
export function extrairCodigo(texto: string): string | null {
  // Sobe para caixa alta antes de casar: o cliente reescreve a mensagem em
  // minusculas com frequencia, e a conversa perderia a atribuicao por isso.
  const m = (texto || '').toUpperCase().match(/[[#]([A-Z0-9]{4,12})]?/);
  return m ? m[1] : null;
}

export interface CupomEstado {
  expiresAt?: Date | null;
  maxUsos?: number | null;
  usos: number;
  ativo: boolean;
}

/** Motivo pelo qual o cupom nao pode ser resgatado, ou null se pode. */
export function motivoRecusa(c: CupomEstado, agora = new Date()): string | null {
  if (!c.ativo) return 'Este cupom foi desativado.';
  if (c.expiresAt && new Date(c.expiresAt).getTime() < agora.getTime()) return 'Este cupom venceu.';
  // maxUsos nulo = ilimitado. Zero e um limite real (cupom esgotado), entao
  // a checagem precisa distinguir null de 0 — por isso nao usa truthiness.
  if (c.maxUsos != null && c.usos >= c.maxUsos) return 'Este cupom atingiu o limite de usos.';
  return null;
}

/**
 * Junta os tres caminhos num numero so de receita atribuida, em centavos.
 *
 * Trabalhamos em CENTAVOS o tempo todo: somar reais em ponto flutuante
 * acumula erro (0.1 + 0.2 !== 0.3) e o total do relatorio nao fecharia com
 * a soma das linhas.
 */
export interface EntradaReceita {
  cupons: Array<{ valorCentavos: number }>;
  balcao: Array<{ valorCentavos: number | null; origem: string }>;
}

export const ORIGENS_DE_SOCIAL = ['INSTAGRAM', 'FACEBOOK', 'WHATSAPP'];

export function consolidarReceita(e: EntradaReceita): {
  totalCentavos: number;
  cupomCentavos: number;
  balcaoCentavos: number;
  vendasBalcao: number;
} {
  const cupomCentavos = e.cupons.reduce((s, c) => s + (c.valorCentavos || 0), 0);

  // So conta o balcao que veio de social. Marcar "passou na frente" e
  // somar no ROI do Instagram seria inflar o proprio resultado.
  const deSocial = e.balcao.filter((b) => ORIGENS_DE_SOCIAL.includes(b.origem));
  const balcaoCentavos = deSocial.reduce((s, b) => s + (b.valorCentavos || 0), 0);

  return {
    totalCentavos: cupomCentavos + balcaoCentavos,
    cupomCentavos,
    balcaoCentavos,
    vendasBalcao: deSocial.length,
  };
}

/**
 * ROI contra o que a agencia cobra.
 *
 * Devolve null quando nao ha fee cadastrado: mostrar "ROI de 0x" ou dividir
 * por zero seria pior que omitir a linha.
 */
export function calcularRoi(receitaCentavos: number, feeCentavos?: number | null): number | null {
  if (!feeCentavos || feeCentavos <= 0) return null;
  return Math.round((receitaCentavos / feeCentavos) * 10) / 10;
}

/**
 * Alcance organico convertido em quanto custaria comprar o mesmo alcance.
 *
 * CPM e o preco por MIL impressoes — dividir por 1000 e o passo que a conta
 * inteira depende. O valor padrao (R$ 20) e a media de Feed/Reels no Brasil
 * e fica configuravel por marca.
 */
export const CPM_PADRAO_CENTAVOS = 2000;

export function valorEquivalenteEmMidia(alcance: number, cpmCentavos = CPM_PADRAO_CENTAVOS): number {
  if (!alcance || alcance <= 0) return 0;
  return Math.round((alcance / 1000) * cpmCentavos);
}

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// --- Acesso ao banco ---

/**
 * Cria (ou reaproveita) o link curto de um post.
 *
 * `brandId` NAO e opcional na pratica: o relatorio mensal conta cliques
 * filtrando por marca, e link salvo sem ela nunca aparece — os cliques do
 * PDF ficavam zerados mesmo com o botao sendo usado.
 */
export async function linkDoPost(
  userId: string,
  postId: string,
  destino: string,
  brandId?: string | null,
): Promise<{ code: string; url: string }> {
  const existente = await prisma.shortLink.findFirst({ where: { userId, postId } });
  if (existente) {
    // Link antigo criado antes deste campo existir: preenche agora, senao
    // ele fica invisivel no relatorio para sempre.
    if (brandId && !existente.brandId) {
      await prisma.shortLink.update({ where: { id: existente.id }, data: { brandId } }).catch(() => {});
    }
    return { code: existente.code, url: existente.targetUrl };
  }

  // Colisao de codigo e rara, mas o unique no banco e quem garante: tentamos
  // algumas vezes em vez de confiar na sorte de um sorteio so.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const code = gerarCodigoCurto(6);
    try {
      const l = await prisma.shortLink.create({
        data: { code, targetUrl: destino, postId, userId, brandId: brandId || null },
      });
      return { code: l.code, url: l.targetUrl };
    } catch {
      /* codigo repetido: sorteia outro */
    }
  }
  throw new Error('Nao consegui gerar um codigo de link. Tente de novo.');
}

/** Registra o clique e devolve o destino. */
export async function registrarClique(code: string): Promise<string | null> {
  const link = await prisma.shortLink.findUnique({ where: { code } });
  if (!link) return null;
  // O incremento nao pode derrubar o redirect: quem clicou tem que chegar
  // no destino mesmo se a contagem falhar.
  await prisma.shortLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }).catch(() => {});
  return link.targetUrl;
}
