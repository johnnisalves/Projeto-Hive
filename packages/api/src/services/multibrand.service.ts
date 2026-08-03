/**
 * Publicacao em massa multimarca: uma arte-mae vira N posts personalizados.
 *
 * O Dia da Pizza sai para 15 clientes em minutos, com o nome, o telefone e
 * a cor de cada um — em vez de um dia inteiro adaptando arte cliente a
 * cliente. E a alavanca de escala que justifica a agencia pagar mais pela
 * ferramenta.
 *
 * O RISCO QUE MANDA NO DESENHO: um {{nome}} que nao foi substituido vai ao
 * ar no perfil do cliente. E vexame publico e irreversivel. Por isso nada
 * e publicado antes de conferir marca a marca quais campos faltam.
 */

/** De onde cada marcacao tira o valor. */
export const CAMPOS: Record<string, string> = {
  nome: 'name',
  telefone: 'whatsappPhone',
  whatsapp: 'whatsappPhone',
  site: 'websiteUrl',
  instagram: 'instagramUrl',
  cidade: 'cidade',
  cor: 'primaryColor',
  cor_primaria: 'primaryColor',
  cor_secundaria: 'secondaryColor',
  logo: 'logoUrl',
};

export const MARCACOES_DISPONIVEIS = Object.keys(CAMPOS);

/**
 * Acha as marcacoes usadas no texto.
 *
 * Aceita espaco dentro das chaves ("{{ nome }}") porque e como a pessoa
 * digita quando copia de outro lugar — e uma marcacao nao reconhecida
 * viraria texto literal no post publicado.
 */
export function extrairMarcacoes(texto: string): string[] {
  const achadas = (texto || '').match(/\{\{\s*([a-z_]+)\s*\}\}/gi) || [];
  const nomes = achadas.map((m) => m.replace(/[{}\s]/g, '').toLowerCase());
  return Array.from(new Set(nomes));
}

/** Marcacoes escritas no template que nao existem. Erro de digitacao do usuario. */
export function marcacoesInvalidas(texto: string): string[] {
  return extrairMarcacoes(texto).filter((m) => !CAMPOS[m]);
}

export interface MarcaParaPreencher {
  id: string;
  name: string;
  [campo: string]: any;
}

/**
 * Troca as marcacoes pelos dados da marca.
 *
 * O telefone sai formatado para leitura ((87) 99999-8888), nao cru: o
 * numero vai para a ARTE e para a legenda, onde e lido por gente.
 */
export function preencher(template: string, marca: MarcaParaPreencher): string {
  return (template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (original, chave) => {
    const campo = CAMPOS[String(chave).toLowerCase()];
    if (!campo) return original;
    const valor = marca[campo];
    if (valor === null || valor === undefined || valor === '') return original;
    return campo === 'whatsappPhone' ? formatarTelefone(String(valor)) : String(valor);
  });
}

export function formatarTelefone(bruto: string): string {
  const d = (bruto || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return bruto;
}

export interface Pendencia {
  marcaId: string;
  marcaNome: string;
  faltando: string[];
}

/**
 * Quais marcas nao tem o que o template pede.
 *
 * Roda ANTES de qualquer publicacao. Sem essa conferencia, a marca sem
 * telefone publicaria "Chama no {{telefone}}" no proprio feed.
 */
export function conferir(template: string, marcas: MarcaParaPreencher[]): {
  pendencias: Pendencia[];
  prontas: MarcaParaPreencher[];
  invalidas: string[];
} {
  const invalidas = marcacoesInvalidas(template);
  const usadas = extrairMarcacoes(template).filter((m) => CAMPOS[m]);

  const pendencias: Pendencia[] = [];
  const prontas: MarcaParaPreencher[] = [];

  for (const marca of marcas || []) {
    const faltando = usadas.filter((m) => {
      const v = marca[CAMPOS[m]];
      return v === null || v === undefined || v === '';
    });
    if (faltando.length) pendencias.push({ marcaId: marca.id, marcaNome: marca.name, faltando });
    else prontas.push(marca);
  }

  return { pendencias, prontas, invalidas };
}

/**
 * Espalha os horarios entre as marcas.
 *
 * Publicar 15 marcas no mesmo minuto e o padrao mais suspeito que existe
 * para o Instagram, e ainda estoura o limite de chamadas da conta. O
 * intervalo tambem evita que os perfis de uma mesma cidade postem a mesma
 * campanha ao mesmo tempo, o que denunciaria a arte-mae.
 */
export const INTERVALO_MINUTOS = 7;

export function escalonar(quantidade: number, inicio: Date, intervaloMin = INTERVALO_MINUTOS): Date[] {
  return Array.from({ length: Math.max(0, quantidade) }, (_, i) =>
    new Date(inicio.getTime() + i * intervaloMin * 60_000));
}
