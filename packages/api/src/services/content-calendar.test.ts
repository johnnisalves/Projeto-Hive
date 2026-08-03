import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  diasEscolhidos,
  montarCronograma,
  montarPrompt,
  isolarObjeto,
  repararStrings,
  lerJson,
  normalizarHorario,
  normalizarPost,
  normalizar,
  celulaCsv,
  gerarCsv,
  escaparIcs,
  dobrarLinhaIcs,
  gerarIcs,
  nomeDoArquivo,
  dataBr,
  Briefing,
} from './content-calendar.service';

/**
 * A DECISAO CENTRAL: as datas sao calculadas aqui, nunca pela IA. Pedir data
 * para o modelo e pedir para ele errar em silencio — e calendario com data
 * invalida so aparece quando o post nao publica.
 */

const briefing = (over: Partial<Briefing> = {}): Briefing => ({
  nicho: 'pizzaria em Petrolina, delivery e eventos',
  publico: 'famílias 25-50 da cidade',
  plataformas: ['INSTAGRAM', 'FACEBOOK'],
  objetivo: 'Vender',
  tom: 'Próximo e amigável',
  frequencia: '3x',
  ano: 2026,
  mes: 8,
  ...over,
});

describe('diasEscolhidos', () => {
  test('cada frequencia tem seus dias', () => {
    assert.deepEqual(diasEscolhidos({ frequencia: '3x' }), [1, 3, 5]);
    assert.deepEqual(diasEscolhidos({ frequencia: '5x' }), [1, 2, 3, 4, 5]);
    assert.deepEqual(diasEscolhidos({ frequencia: 'diario' }), [0, 1, 2, 3, 4, 5, 6]);
  });

  test('personalizado usa os dias informados, ordenados', () => {
    assert.deepEqual(diasEscolhidos({ frequencia: 'personalizado', diasDaSemana: [5, 0, 2] }), [0, 2, 5]);
  });

  // Dia repetido geraria dois posts no mesmo dia — e a tela pode mandar
  // duplicado se o usuario clicar rapido.
  test('dia repetido nao vira post duplicado', () => {
    assert.deepEqual(diasEscolhidos({ frequencia: 'personalizado', diasDaSemana: [1, 1, 3] }), [1, 3]);
  });

  test('dia fora da faixa e descartado', () => {
    assert.deepEqual(diasEscolhidos({ frequencia: 'personalizado', diasDaSemana: [-1, 3, 9] }), [3]);
  });

  test('personalizado sem dia nenhum devolve vazio', () => {
    assert.deepEqual(diasEscolhidos({ frequencia: 'personalizado', diasDaSemana: [] }), []);
  });
});

describe('montarCronograma', () => {
  test('so gera datas que caem nos dias escolhidos', () => {
    const datas = montarCronograma(briefing({ frequencia: '3x' }));
    for (const d of datas) assert.ok([1, 3, 5].includes(d.getDay()));
  });

  test('todas as datas sao do mes pedido', () => {
    const datas = montarCronograma(briefing({ mes: 8, ano: 2026 }));
    for (const d of datas) {
      assert.equal(d.getMonth(), 7);
      assert.equal(d.getFullYear(), 2026);
    }
  });

  // O erro que este servico existe para impedir. Nenhuma data pode "rolar"
  // para o mes seguinte.
  test('mes de 30 dias nunca gera dia 31', () => {
    const datas = montarCronograma(briefing({ mes: 4, frequencia: 'diario' }));
    assert.equal(datas.length, 30);
    assert.equal(datas[datas.length - 1].getDate(), 30);
  });

  test('fevereiro comum tem 28, bissexto tem 29', () => {
    assert.equal(montarCronograma(briefing({ mes: 2, ano: 2026, frequencia: 'diario' })).length, 28);
    assert.equal(montarCronograma(briefing({ mes: 2, ano: 2028, frequencia: 'diario' })).length, 29);
  });

  test('dezembro nao vaza para janeiro do ano seguinte', () => {
    const datas = montarCronograma(briefing({ mes: 12, frequencia: 'diario' }));
    assert.equal(datas.length, 31);
    assert.equal(datas[30].getFullYear(), 2026);
  });

  test('as datas saem em ordem crescente e sem repetir', () => {
    const datas = montarCronograma(briefing({ frequencia: '5x' }));
    for (let i = 1; i < datas.length; i++) assert.ok(datas[i] > datas[i - 1]);
    assert.equal(new Set(datas.map((d) => d.getTime())).size, datas.length);
  });

  test('sem dia escolhido, nao ha cronograma', () => {
    assert.deepEqual(montarCronograma(briefing({ frequencia: 'personalizado', diasDaSemana: [] })), []);
  });
});

describe('montarPrompt', () => {
  const cron = montarCronograma(briefing());

  test('manda o cronograma pronto e exige um post por data', () => {
    const p = montarPrompt(briefing(), cron);
    assert.ok(p.includes(`EXATAMENTE ${cron.length} posts`));
    assert.ok(p.includes(dataBr(cron[0])));
    assert.ok(p.includes(dataBr(cron[cron.length - 1])));
  });

  test('lista as plataformas como restricao', () => {
    assert.match(montarPrompt(briefing(), cron), /use SOMENTE estas.*INSTAGRAM, FACEBOOK/);
  });

  test('sem pilares informados, manda a IA criar', () => {
    assert.match(montarPrompt(briefing(), cron), /Crie de 4 a 6 pilares/);
  });

  test('com pilares informados, proibe inventar outros', () => {
    const p = montarPrompt(briefing({ pilares: ['bastidores', 'ofertas'] }), cron);
    assert.match(p, /EXATAMENTE estes pilares/);
    assert.ok(p.includes('bastidores, ofertas'));
  });

  // Uma clinica nao pode receber sugestao de restaurante.
  test('o contexto do ramo entra no prompt quando existe', () => {
    assert.ok(montarPrompt(briefing(), cron, 'Área de saúde, sem promessa de cura.').includes('sem promessa de cura'));
  });
});

describe('lerJson — escada de reparo', () => {
  test('JSON limpo passa direto', () => {
    assert.deepEqual(lerJson('{"a":1}'), { a: 1 });
  });

  test('tira cerca de markdown', () => {
    assert.deepEqual(lerJson('```json\n{"a":1}\n```'), { a: 1 });
  });

  test('tira texto solto antes e depois', () => {
    assert.deepEqual(lerJson('Claro! Aqui está:\n{"a":1}\nEspero ter ajudado.'), { a: 1 });
  });

  test('vírgula sobrando antes do fecha', () => {
    assert.deepEqual(lerJson('{"a":1,}'), { a: 1 });
    assert.deepEqual(lerJson('{"a":[1,2,]}'), { a: [1, 2] });
  });

  // O erro mais comum do modelo: aspas cruas dentro da string.
  test('aspas nao escapadas dentro do texto', () => {
    const r = lerJson('{"gancho":"ela disse "sim" na hora"}');
    assert.equal(r.gancho, 'ela disse "sim" na hora');
  });

  test('quebra de linha crua dentro da string', () => {
    assert.equal(lerJson('{"descricao":"linha um\nlinha dois"}').descricao, 'linha um\nlinha dois');
  });

  // Desistir na primeira tentativa jogaria fora uma geracao inteira que
  // estava quase boa.
  test('combina os reparos quando precisa dos dois', () => {
    const r = lerJson('{"a":"diz "oi"","b":[1,]}');
    assert.equal(r.a, 'diz "oi"');
    assert.deepEqual(r.b, [1]);
  });

  test('lixo irrecuperavel falha com mensagem clara', () => {
    assert.throws(() => lerJson('não sou json'), /JSON válido/);
    assert.throws(() => lerJson(''), /JSON válido/);
  });

  test('isolarObjeto e repararStrings nao quebram com vazio', () => {
    assert.equal(isolarObjeto(''), '');
    assert.equal(repararStrings(''), '');
  });
});

describe('normalizarHorario', () => {
  test('hora valida passa', () => {
    assert.equal(normalizarHorario('19:30'), '19:30');
    assert.equal(normalizarHorario('9:05'), '09:05');
  });

  // Sem isso, uma hora invalida viraria data invalida no .ics e o evento
  // simplesmente nao apareceria na agenda.
  test('hora invalida cai no padrao', () => {
    assert.equal(normalizarHorario('noite'), '19:00');
    assert.equal(normalizarHorario(''), '19:00');
    assert.equal(normalizarHorario(null), '19:00');
    assert.equal(normalizarHorario('19h30'), '19:00');
  });

  test('hora fora da faixa e limitada, nao recusada', () => {
    assert.equal(normalizarHorario('25:00'), '23:00');
    assert.equal(normalizarHorario('10:99'), '10:59');
  });
});

describe('normalizarPost — nao confia em nada', () => {
  const plataformas = ['INSTAGRAM', 'FACEBOOK'];
  const pilares = ['Bastidores', 'Ofertas'];

  test('post completo passa', () => {
    const p = normalizarPost({
      plataforma: 'INSTAGRAM', formato: 'Reel', pilar: 'Ofertas',
      titulo: 'Promo de terça', gancho: 'Olha isso', descricao: 'Mostrar a pizza',
      cta: 'Peça agora', hashtags: ['#pizza', 'petrolina'], horario: '20:00',
    }, plataformas, pilares);

    assert.equal(p.plataforma, 'INSTAGRAM');
    assert.deepEqual(p.hashtags, ['pizza', 'petrolina']);
    assert.equal(p.horario, '20:00');
  });

  // Publicar num canal que o usuario nao escolheu e pior que repetir canal.
  test('plataforma fora das escolhidas vira a primeira permitida', () => {
    assert.equal(normalizarPost({ plataforma: 'TIKTOK' }, plataformas, pilares).plataforma, 'INSTAGRAM');
    assert.equal(normalizarPost({ plataforma: '' }, plataformas, pilares).plataforma, 'INSTAGRAM');
  });

  test('plataforma em minuscula ainda e reconhecida', () => {
    assert.equal(normalizarPost({ plataforma: 'facebook' }, plataformas, pilares).plataforma, 'FACEBOOK');
  });

  test('pilar inventado cai no primeiro definido', () => {
    assert.equal(normalizarPost({ pilar: 'Inventado' }, plataformas, pilares).pilar, 'Bastidores');
  });

  test('pilar casa sem diferenciar caixa', () => {
    assert.equal(normalizarPost({ pilar: 'OFERTAS' }, plataformas, pilares).pilar, 'Ofertas');
  });

  test('campos faltando ganham valor util, nao undefined', () => {
    const p = normalizarPost({}, plataformas, pilares);
    assert.equal(p.formato, 'Post');
    assert.ok(p.titulo.length > 0);
    assert.deepEqual(p.hashtags, []);
  });

  test('hashtags demais sao cortadas', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => `t${i}`);
    assert.equal(normalizarPost({ hashtags: muitas }, plataformas, pilares).hashtags.length, 8);
  });

  test('hashtags que nao sao lista nao quebram', () => {
    assert.deepEqual(normalizarPost({ hashtags: 'pizza' }, plataformas, pilares).hashtags, []);
  });
});

describe('normalizar — casa com o cronograma', () => {
  const cron = montarCronograma(briefing({ frequencia: '3x' }));
  const resposta = (n: number) => ({
    pilares: [{ nome: 'Bastidores', descricao: 'x' }],
    posts: Array.from({ length: n }, (_, i) => ({ plataforma: 'INSTAGRAM', titulo: `Post ${i}` })),
  });

  test('cada post recebe a data do cronograma, na ordem', () => {
    const r = normalizar(resposta(cron.length), cron, briefing());
    assert.equal(r.posts.length, cron.length);
    r.posts.forEach((p, i) => assert.equal(p.data.getTime(), cron[i].getTime()));
  });

  // Nunca inventamos data para completar: post a mais e descartado, post a
  // menos deixa o mes mais curto — mas toda data e real.
  test('modelo devolvendo posts a mais: o excedente e descartado', () => {
    assert.equal(normalizar(resposta(cron.length + 10), cron, briefing()).posts.length, cron.length);
  });

  test('modelo devolvendo posts a menos: nenhuma data inventada', () => {
    const r = normalizar(resposta(3), cron, briefing());
    assert.equal(r.posts.length, 3);
    r.posts.forEach((p, i) => assert.equal(p.data.getTime(), cron[i].getTime()));
  });

  test('pilares do briefing mandam: o modelo nao pode renomear', () => {
    const r = normalizar(
      { pilares: [{ nome: 'Outro Nome' }], posts: [] },
      cron,
      briefing({ pilares: ['Bastidores', 'Ofertas'] }),
    );
    assert.deepEqual(r.pilares.map((p) => p.nome), ['Bastidores', 'Ofertas']);
  });

  test('resposta vazia ou torta nao quebra', () => {
    assert.deepEqual(normalizar(null, cron, briefing()).posts, []);
    assert.deepEqual(normalizar({ posts: 'nao e lista' }, cron, briefing()).posts, []);
    assert.ok(normalizar({}, cron, briefing()).pilares.length > 0);
  });
});

describe('exportacao CSV', () => {
  const posts = normalizar(
    { pilares: [{ nome: 'Ofertas' }], posts: [{ plataforma: 'INSTAGRAM', titulo: 'Promo, hoje', gancho: 'Diz "oi"', hashtags: ['pizza'] }] },
    montarCronograma(briefing()),
    briefing(),
  ).posts;

  test('celula com virgula, aspas ou quebra vai entre aspas', () => {
    assert.equal(celulaCsv('sem nada'), 'sem nada');
    assert.equal(celulaCsv('tem, virgula'), '"tem, virgula"');
    assert.equal(celulaCsv('diz "oi"'), '"diz ""oi"""');
  });

  test('o cabecalho e as linhas batem em numero de colunas', () => {
    const linhas = gerarCsv(posts).split('\r\n');
    const colunas = (l: string) => (l.match(/,/g) || []).length;
    assert.equal(colunas(linhas[0]), 9);
  });

  // Sem o BOM, o Excel em portugues abre em ANSI e "promoção" vira
  // mojibake na planilha que o cliente recebe.
  test('comeca com BOM para o Excel abrir em UTF-8', () => {
    assert.ok(gerarCsv(posts).startsWith('﻿'));
  });

  test('sem posts, sai so o cabecalho', () => {
    assert.equal(gerarCsv([]).split('\r\n').length, 1);
  });
});

describe('exportacao ICS', () => {
  const cron = montarCronograma(briefing({ frequencia: '3x' }));
  const posts = normalizar(
    { pilares: [{ nome: 'Ofertas' }], posts: cron.map(() => ({ plataforma: 'INSTAGRAM', titulo: 'Promo', horario: '19:00' })) },
    cron,
    briefing(),
  ).posts;
  const ics = gerarIcs(posts, 'Conteúdo · agosto 2026', new Date(Date.UTC(2026, 7, 1, 12, 0, 0)));

  test('estrutura minima do formato', () => {
    assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, posts.length);
  });

  // Com \n puro o Outlook recusa o arquivo inteiro.
  test('quebra de linha e CRLF, como o RFC exige', () => {
    assert.ok(ics.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics));
  });

  test('cada evento tem lembrete de uma hora antes', () => {
    assert.equal((ics.match(/TRIGGER:-PT60M/g) || []).length, posts.length);
  });

  test('escapa os caracteres reservados', () => {
    assert.equal(escaparIcs('a, b; c'), 'a\\, b\\; c');
    assert.equal(escaparIcs('linha1\nlinha2'), 'linha1\\nlinha2');
    assert.equal(escaparIcs('barra \\ invertida'), 'barra \\\\ invertida');
  });

  // Acento ocupa 2 bytes em UTF-8: dobrar por caractere estoura o limite
  // numa legenda em portugues, e alguns clientes recusam o arquivo.
  test('dobra a linha contando BYTES, nao caracteres', () => {
    const longa = `SUMMARY:${'ã'.repeat(60)}`;
    const dobrada = dobrarLinhaIcs(longa);
    for (const parte of dobrada.split('\r\n')) {
      assert.ok(Buffer.byteLength(parte, 'utf8') <= 75, `linha com ${Buffer.byteLength(parte, 'utf8')} bytes`);
    }
  });

  test('continuacao comeca com espaco', () => {
    const d = dobrarLinhaIcs(`SUMMARY:${'a'.repeat(200)}`);
    d.split('\r\n').slice(1).forEach((p) => assert.ok(p.startsWith(' ')));
  });

  test('linha curta nao e dobrada', () => {
    assert.equal(dobrarLinhaIcs('SUMMARY:curto'), 'SUMMARY:curto');
  });

  test('sem posts ainda gera um calendario valido', () => {
    const vazio = gerarIcs([], 'Vazio');
    assert.ok(vazio.includes('BEGIN:VCALENDAR'));
    assert.ok(!vazio.includes('BEGIN:VEVENT'));
  });

  test('o horario do evento e o do post', () => {
    const um = gerarIcs(
      [{ ...posts[0], horario: '08:30' }],
      'X',
      new Date(Date.UTC(2026, 7, 1)),
    );
    assert.match(um, /DTSTART:\d{8}T083000/);
    assert.match(um, /DTEND:\d{8}T090000/);
  });
});

describe('nomeDoArquivo', () => {
  test('vira slug legivel', () => {
    assert.equal(nomeDoArquivo('Pizzaria Essência', 8, 2026), 'calendario-pizzaria-essencia-agosto-2026');
  });

  test('nome vazio ou so simbolo nao gera arquivo sem nome', () => {
    assert.equal(nomeDoArquivo('', 1, 2026), 'calendario-conteudo-janeiro-2026');
    assert.equal(nomeDoArquivo('!!!', 1, 2026), 'calendario-conteudo-janeiro-2026');
  });
});
