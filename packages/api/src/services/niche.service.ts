/**
 * Nicho da empresa: o que faz o sistema servir a qualquer negocio.
 *
 * O sistema nasceu com cara de ferramenta de pizzaria. O gatilho de clima
 * dizia "noite de chuva pede pizza", o detector de elogio procurava
 * "delicioso", os exemplos das telas eram todos de comida. Para uma clinica
 * odontologica ou um escritorio de advocacia isso nao e so inutil — e
 * constrangedor.
 *
 * A REGRA QUE MANDA: nicho desconhecido cai no GENERICO, nunca em comida.
 * E melhor uma sugestao neutra que serve para todo mundo do que uma
 * sugestao especifica do ramo errado.
 */

export interface Nicho {
  chave: string;
  rotulo: string;
  /**
   * O clima muda a demanda deste ramo?
   *
   * Para pizzaria, chuva a noite E a oportunidade. Para um escritorio de
   * advocacia, "noite de chuva pede advogado" e absurdo. Quando false, o
   * gatilho de clima simplesmente nao existe para a marca.
   */
  climaImporta: boolean;
  /** Como o clima se conecta ao que o ramo vende. Vazio quando nao conecta. */
  pautasDeClima?: { chuva?: string; frio?: string; calor?: string };
  /** Palavras de elogio tipicas do ramo, para a fabrica de prova social. */
  elogios: string[];
  /** Chamadas para acao tipicas do ramo. */
  chamadas: string[];
  /** Contexto que entra no prompt da IA ao gerar conteudo. */
  contextoIA: string;
}

/**
 * Termos que valem para QUALQUER ramo. Sao a base: todo nicho herda estes
 * e acrescenta os proprios.
 */
export const ELOGIOS_GERAIS = [
  'melhor', 'excelente', 'perfeit', 'otim', 'maravilh', 'sensacional',
  'recomendo', 'amei', 'adorei', 'nota 10', 'impecavel', 'top demais',
  'apaixonad', 'surpreendent', 'atencios', 'caprichad',
];

/**
 * Verbos de chamada que QUALQUER ramo usa.
 *
 * "peça", "agende" e "reserve" moram aqui, nao no nicho: uma pizzaria pede
 * pra pedir, uma clinica pra agendar, um salao pra reservar — mas todos os
 * tres verbos aparecem em quase todo ramo. O que e mesmo especifico sao as
 * frases inteiras ("marque sua consulta", "traga seu pet", "matricule").
 */
export const CHAMADAS_GERAIS = [
  'comenta', 'comente', 'marca', 'marque', 'chama', 'chame', 'corre',
  'clica', 'clique', 'link na bio', 'arrasta', 'salva', 'compartilha',
  'aproveit', 'garanta', 'adquira', 'peca', 'pede', 'agend', 'reserv',
  'solicite', 'fale com a gente', 'saiba mais', 'chama no zap',
];

export const NICHOS: Nicho[] = [
  {
    chave: 'alimentacao',
    rotulo: 'Alimentação e bebidas',
    climaImporta: true,
    pautasDeClima: {
      chuva: 'ligue a chuva ao conforto de pedir em casa',
      frio: 'ligue o frio ao que voces têm de mais quente e aconchegante',
      calor: 'ligue o calor ao que voces têm de mais refrescante',
    },
    elogios: ['delici', 'saboros', 'temperad', 'fresquinh', 'no ponto', 'caseir'],
    chamadas: ['peca', 'pede', 'reserv', 'experimente', 'prove'],
    contextoIA: 'Negócio de alimentação. Fale de sabor, frescor e do prazer de comer bem.',
  },
  {
    chave: 'beleza',
    rotulo: 'Beleza e estética',
    climaImporta: false,
    elogios: ['ficou lind', 'arrasou', 'transformou', 'maos de fada', 'caprich'],
    chamadas: ['agend', 'marque seu horario', 'reserv', 'garanta seu horario'],
    contextoIA: 'Negócio de beleza e estética. Fale de autoestima, transformação e cuidado, mostrando antes e depois quando fizer sentido.',
  },
  {
    chave: 'saude',
    rotulo: 'Saúde e bem-estar',
    climaImporta: false,
    elogios: ['atencios', 'cuidados', 'humaniz', 'me senti segur', 'profission'],
    chamadas: ['agend', 'marque sua consulta', 'agende sua avaliacao'],
    contextoIA: 'Área de saúde. Tom sério e acolhedor, sem promessa de resultado e sem linguagem sensacionalista. Nunca prometa cura nem use antes e depois de procedimento.',
  },
  {
    chave: 'fitness',
    rotulo: 'Academia e esportes',
    climaImporta: true,
    pautasDeClima: {
      chuva: 'ligue a chuva ao treino que nao depende do tempo la fora',
      frio: 'ligue o frio a dificuldade de sair da cama e ao que motiva a treinar mesmo assim',
      calor: 'ligue o calor a hidratacao e ao melhor horario para treinar',
    },
    elogios: ['evolui', 'mudou minha vida', 'resultado', 'motivad', 'acolhedor'],
    chamadas: ['agend', 'venha treinar', 'faca sua aula experimental', 'matricule'],
    contextoIA: 'Academia ou esporte. Fale de constância e evolução, sem prometer resultado rápido nem padrão de corpo.',
  },
  {
    chave: 'varejo',
    rotulo: 'Loja e varejo',
    climaImporta: false,
    elogios: ['qualidade', 'chegou rapid', 'exatamente como', 'bem embalad', 'confiavel'],
    chamadas: ['compre', 'garanta o seu', 'aproveite', 'ultimas pecas', 'chama no direct'],
    contextoIA: 'Loja de varejo. Destaque o produto, o diferencial e a facilidade de comprar.',
  },
  {
    chave: 'servicos',
    rotulo: 'Serviços em geral',
    climaImporta: false,
    elogios: ['resolveu', 'pontual', 'honest', 'salvou', 'rapid', 'confiavel'],
    chamadas: ['solicite um orcamento', 'chama no zap', 'agend', 'fale com a gente'],
    contextoIA: 'Prestador de serviços. Fale de confiança, prazo e resolução do problema do cliente.',
  },
  {
    chave: 'educacao',
    rotulo: 'Educação e cursos',
    climaImporta: false,
    elogios: ['aprendi', 'didatic', 'mudou minha carreira', 'paciente', 'clar'],
    chamadas: ['inscreva', 'matricule', 'garanta sua vaga', 'saiba mais'],
    contextoIA: 'Educação. Fale de transformação pelo conhecimento e de aplicação prática, sem promessa de emprego garantido.',
  },
  {
    chave: 'imobiliario',
    rotulo: 'Imóveis',
    climaImporta: false,
    elogios: ['realizou o sonho', 'transparent', 'acompanhou', 'sem dor de cabeca'],
    chamadas: ['agende uma visita', 'fale com o corretor', 'saiba mais', 'chama no zap'],
    contextoIA: 'Mercado imobiliário. Fale do imóvel e da região, com informação concreta e sem promessa de valorização.',
  },
  {
    chave: 'automotivo',
    rotulo: 'Automotivo',
    climaImporta: false,
    elogios: ['ficou nov', 'honest', 'resolveu', 'preco just', 'confio'],
    chamadas: ['agend', 'traga seu carro', 'faca um orcamento', 'chama no zap'],
    contextoIA: 'Setor automotivo. Fale de confiança técnica, prazo e cuidado com o veículo do cliente.',
  },
  {
    chave: 'pet',
    rotulo: 'Pet',
    climaImporta: false,
    elogios: ['cuidaram bem', 'meu pet ador', 'carinhos', 'atencios', 'ficou lind'],
    chamadas: ['agend', 'traga seu pet', 'marque o banho', 'chama no zap'],
    contextoIA: 'Negócio pet. Fale com afeto pelo animal e tranquilize o tutor.',
  },
  {
    chave: 'eventos',
    rotulo: 'Eventos e festas',
    climaImporta: true,
    pautasDeClima: {
      chuva: 'ligue a chuva a estrutura coberta e a tranquilidade de ter plano B',
      frio: 'ligue o frio ao clima aconchegante de um evento a noite',
      calor: 'ligue o calor a estrutura ao ar livre e a bebida gelada',
    },
    elogios: ['inesquecivel', 'organiz', 'superou', 'lind', 'todo mundo elogiou'],
    chamadas: ['reserve sua data', 'peca um orcamento', 'agend', 'fale com a gente'],
    contextoIA: 'Eventos e festas. Fale de momento marcante e de organização sem estresse.',
  },
  {
    chave: 'juridico',
    rotulo: 'Jurídico e contábil',
    climaImporta: false,
    elogios: ['resolveu', 'explicou tudo', 'transparent', 'atencios', 'confio', 'seguranca'],
    chamadas: ['agende uma consulta', 'fale com a gente', 'tire suas duvidas'],
    contextoIA: 'Área jurídica ou contábil. Tom sóbrio e educativo. NUNCA prometa resultado de processo, não capte cliente de forma agressiva e respeite os limites de publicidade da profissão.',
  },
];

/** Nicho neutro: o que vale quando nada foi escolhido. */
export const GENERICO: Nicho = {
  chave: 'generico',
  rotulo: 'Outro',
  climaImporta: false,
  elogios: [],
  chamadas: [],
  contextoIA: 'Fale do diferencial do negócio de forma clara e direta.',
};

/**
 * Acha o nicho pela chave.
 *
 * Chave desconhecida, nula ou vazia cai no GENERICO — nunca em comida.
 * Uma sugestao neutra serve para todo mundo; uma sugestao do ramo errado
 * envergonha o cliente.
 */
export function nichoDe(chave?: string | null): Nicho {
  if (!chave) return GENERICO;
  return NICHOS.find((n) => n.chave === String(chave).toLowerCase()) || GENERICO;
}

/** Todos os elogios que valem para este nicho: os gerais mais os do ramo. */
export function elogiosDoNicho(chave?: string | null): string[] {
  return [...ELOGIOS_GERAIS, ...nichoDe(chave).elogios];
}

/** Todas as chamadas para acao que valem para este nicho. */
export function chamadasDoNicho(chave?: string | null): string[] {
  return [...CHAMADAS_GERAIS, ...nichoDe(chave).chamadas];
}

/**
 * A pauta de clima deste nicho, ou null quando o clima nao muda a demanda
 * do ramo.
 *
 * E aqui que se evita o absurdo: um escritorio de advocacia postando
 * "noite de chuva pede advogado".
 */
export function pautaDeClima(
  chave: string | null | undefined,
  condicao: 'chuva' | 'frio' | 'calor' | null,
  cidade: string,
): string | null {
  if (!condicao) return null;
  const n = nichoDe(chave);
  if (!n.climaImporta) return null;

  const gancho = n.pautasDeClima?.[condicao];
  if (!gancho) return null;

  const clima = { chuva: 'previsão de chuva', frio: 'a noite vai esfriar', calor: 'a noite vai ser quente' }[condicao];
  return `Post de oportunidade: ${clima} hoje em ${cidade}. ${gancho}. `
    + 'Escreva algo curto e convidativo, sem clichê.';
}

/** Lista para o seletor da tela. */
export function opcoes(): Array<{ chave: string; rotulo: string }> {
  return [...NICHOS.map((n) => ({ chave: n.chave, rotulo: n.rotulo })), { chave: GENERICO.chave, rotulo: GENERICO.rotulo }];
}
