/**
 * Gerador de PIX "copia e cola" (BR Code), pela especificacao EMV do Banco
 * Central. Roda inteiro aqui dentro: nao depende de banco, de PSP nem de
 * chave de API.
 *
 * POR QUE ISSO IMPORTA MAIS QUE O RESTO DO SISTEMA: um erro aqui nao quebra
 * uma tela, manda o dinheiro do cliente para o lugar errado ou gera um codigo
 * que o app do banco recusa na frente do comprador. Cada regra abaixo existe
 * por causa de uma recusa real de app de banco, e os testes cobrem uma a uma.
 */

/**
 * CRC16-CCITT (FALSE): polinomio 0x1021, inicio 0xFFFF, sem reflexao e sem
 * XOR final. E a variante que o BR Code exige — as outras variantes de CRC16
 * geram um codigo com aparencia valida que o banco recusa na leitura.
 */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta um campo no formato EMV: ID (2) + tamanho (2) + valor.
 *
 * O tamanho conta CARACTERES, e o padrao so reserva 2 digitos para ele — por
 * isso todo valor precisa ser ASCII e caber em 99. Acentos viram 2 bytes em
 * UTF-8 e desalinham a contagem, alem de serem recusados por varios bancos.
 */
export function campo(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`;
}

/**
 * Deixa o texto no formato que o BR Code aceita: sem acento, sem simbolo e
 * em caixa alta. "Pizzaria Essenza" continua legivel; "Petrolina-PE" vira
 * "PETROLINA PE".
 */
export function sanitizarTexto(bruto: string, max: number): string {
  return (bruto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

/**
 * Formata o valor como o padrao exige: ponto decimal, sempre 2 casas, sem
 * separador de milhar. "1.234,50" ou "1,234.50" fazem o app do banco recusar.
 */
export function formatarValor(valor: number): string {
  return valor.toFixed(2);
}

/**
 * Identificador da transacao (txid). So aceita letra e numero, ate 25.
 *
 * E o campo que amarra o pagamento ao post de origem — e o que faz o dinheiro
 * chegar carimbado. Quando nao ha identificador, o padrao manda usar "***".
 */
export function sanitizarTxid(bruto?: string | null): string {
  const limpo = (bruto || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25);
  return limpo || '***';
}

export interface PixParams {
  /** Chave PIX: CPF/CNPJ, telefone, e-mail ou chave aleatoria. */
  chave: string;
  nome: string;
  cidade: string;
  /** Opcional. Sem valor, quem paga digita quanto quer. */
  valor?: number | null;
  /** Amarra o pagamento a um post ou campanha. */
  txid?: string | null;
}

/**
 * Monta o payload copia e cola.
 *
 * A ordem dos campos NAO e livre: o padrao exige ordem crescente de ID, e o
 * CRC (63) e calculado sobre tudo que veio antes, ja incluindo o proprio
 * cabecalho "6304".
 */
export function gerarPixCopiaECola(params: PixParams): string {
  const chave = (params.chave || '').trim();
  if (!chave) throw new Error('Informe a chave PIX da marca');

  // A chave vai crua (nao sanitizada): e-mail tem ponto e arroba, chave
  // aleatoria tem hifen. Sanitizar aqui destruiria a chave e o dinheiro
  // cairia em lugar nenhum.
  const merchant = campo('00', 'br.gov.bcb.pix') + campo('01', chave);

  const partes = [
    campo('00', '01'),
    campo('26', merchant),
    campo('52', '0000'),
    campo('53', '986'),
    // Valor e opcional: sem ele, o app abre com campo livre para digitar.
    ...(params.valor && params.valor > 0 ? [campo('54', formatarValor(params.valor))] : []),
    campo('58', 'BR'),
    campo('59', sanitizarTexto(params.nome, 25) || 'RECEBEDOR'),
    campo('60', sanitizarTexto(params.cidade, 15) || 'BRASIL'),
    campo('62', campo('05', sanitizarTxid(params.txid))),
  ];

  const semCrc = `${partes.join('')}6304`;
  return semCrc + crc16(semCrc);
}

/**
 * Confere um payload lendo o CRC que veio nele e recalculando.
 * Usado nos testes e para validar codigo colado pelo usuario.
 */
export function pixValido(payload: string): boolean {
  if (!payload || payload.length < 8) return false;
  const corpo = payload.slice(0, -4);
  if (!corpo.endsWith('6304')) return false;
  return crc16(corpo) === payload.slice(-4).toUpperCase();
}
