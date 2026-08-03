import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  separarLinhaCsv,
  detectarSeparador,
  mapearColunas,
  lerDataBr,
  lerHashtags,
  lerPlanilha,
} from './import.service';

/**
 * Importar planilha errado nao da erro visivel: agenda 200 posts nas datas
 * erradas e o usuario so descobre quando o cliente reclama. Os testes de
 * data sao os mais importantes do arquivo.
 */

describe('separarLinhaCsv', () => {
  test('separa campos simples', () => {
    assert.deepEqual(separarLinhaCsv('a,b,c'), ['a', 'b', 'c']);
  });

  // Legenda com virgula e a regra, nao a excecao. Um split(',') seco
  // espatifaria a legenda e desalinharia a planilha inteira dali pra frente.
  test('virgula dentro de aspas nao separa', () => {
    assert.deepEqual(
      separarLinhaCsv('03/08/2026,"Chegou a pizza nova, vem provar",foto.jpg'),
      ['03/08/2026', 'Chegou a pizza nova, vem provar', 'foto.jpg'],
    );
  });

  test('aspas duplicadas viram uma aspa literal', () => {
    assert.deepEqual(separarLinhaCsv('a,"disse ""oi"" pra ela",c'), ['a', 'disse "oi" pra ela', 'c']);
  });

  test('campo vazio nao some', () => {
    assert.deepEqual(separarLinhaCsv('a,,c'), ['a', '', 'c']);
    assert.deepEqual(separarLinhaCsv('a,b,'), ['a', 'b', '']);
  });

  test('funciona com ponto e virgula', () => {
    assert.deepEqual(separarLinhaCsv('a;b;c', ';'), ['a', 'b', 'c']);
  });
});

describe('detectarSeparador', () => {
  // O Excel em portugues salva com ponto e virgula. E a origem mais comum
  // de "importei e veio tudo numa coluna so".
  test('reconhece o ponto e virgula do Excel brasileiro', () => {
    assert.equal(detectarSeparador('data;legenda;imagem'), ';');
  });

  test('reconhece virgula', () => {
    assert.equal(detectarSeparador('data,legenda,imagem'), ',');
  });

  test('reconhece tabulacao (colado do Google Sheets)', () => {
    assert.equal(detectarSeparador('data\tlegenda\timagem'), '\t');
  });
});

describe('mapearColunas', () => {
  test('aceita os nomes que a pessoa realmente escreve', () => {
    assert.deepEqual(mapearColunas(['Data', 'Legenda', 'Imagem']), { data: 0, legenda: 1, imagem: 2 });
    assert.deepEqual(mapearColunas(['quando', 'texto']), { data: 0, legenda: 1 });
    assert.deepEqual(mapearColunas(['DATA E HORA', 'caption']), { data: 0, legenda: 1 });
  });

  test('ignora acento e caixa no cabecalho', () => {
    assert.equal(mapearColunas(['Descrição'])['legenda'], 0);
    assert.equal(mapearColunas(['MÍDIA'])['imagem'], 0);
  });

  test('coluna desconhecida e simplesmente ignorada', () => {
    const m = mapearColunas(['data', 'observacoes internas', 'legenda']);
    assert.equal(m.data, 0);
    assert.equal(m.legenda, 2);
  });
});

describe('lerDataBr', () => {
  // O ERRO MAIS CARO DO ARQUIVO: new Date("03/08/2026") le como 8 de marco
  // (mes/dia). Agendaria a campanha inteira nos meses errados, em silencio,
  // porque as duas leituras dao datas validas.
  test('03/08/2026 e 3 de agosto, nao 8 de marco', () => {
    const d = lerDataBr('03/08/2026')!;
    assert.equal(d.getDate(), 3);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getFullYear(), 2026);
  });

  test('le a hora quando vem junto', () => {
    const d = lerDataBr('03/08/2026 14:30')!;
    assert.equal(d.getHours(), 14);
    assert.equal(d.getMinutes(), 30);
  });

  test('aceita 14h30, como o brasileiro escreve', () => {
    const d = lerDataBr('03/08/2026 14h30')!;
    assert.equal(d.getHours(), 14);
  });

  // Meia-noite mandaria o post para a madrugada, quando ninguem ve.
  test('sem hora, agenda de manha e nao a meia-noite', () => {
    assert.equal(lerDataBr('03/08/2026')!.getHours(), 9);
  });

  test('aceita ponto e hifen como separador', () => {
    assert.equal(lerDataBr('03.08.2026')!.getMonth(), 7);
    assert.equal(lerDataBr('03-08-2026')!.getMonth(), 7);
  });

  test('ano de dois digitos vira 20xx', () => {
    assert.equal(lerDataBr('03/08/26')!.getFullYear(), 2026);
  });

  test('formato ISO passa direto', () => {
    const d = lerDataBr('2026-08-03T14:30')!;
    assert.equal(d.getDate(), 3);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getHours(), 14);
  });

  // 31/02 "rola" para 03/03 no construtor do JS. Aceitar isso agendaria o
  // post num dia que o usuario nunca escolheu.
  test('data que nao existe e recusada, nao corrigida em silencio', () => {
    assert.equal(lerDataBr('31/02/2026'), null);
    assert.equal(lerDataBr('32/01/2026'), null);
    assert.equal(lerDataBr('01/13/2026'), null);
  });

  test('hora impossivel e recusada', () => {
    assert.equal(lerDataBr('03/08/2026 25:00'), null);
    assert.equal(lerDataBr('03/08/2026 14:99'), null);
  });

  test('lixo devolve null', () => {
    assert.equal(lerDataBr(''), null);
    assert.equal(lerDataBr('amanha'), null);
    assert.equal(lerDataBr('abc/def/ghi'), null);
  });

  // ISO e inequivoco na ORDEM, mas nao na validade: 2026-02-30 tambem
  // "rola" para 2 de marco no construtor do JS. A conferencia de rolagem
  // precisa valer para os dois formatos, nao so para o brasileiro.
  test('data ISO que nao existe tambem e recusada', () => {
    assert.equal(lerDataBr('2026-02-30'), null);
    assert.equal(lerDataBr('2026-13-01'), null);
    assert.equal(lerDataBr('2026-04-31'), null);
    assert.equal(lerDataBr('2027-02-29'), null);
  });

  test('data ISO valida continua passando', () => {
    assert.equal(lerDataBr('2028-02-29')!.getDate(), 29);
    assert.equal(lerDataBr('2026-08-31')!.getDate(), 31);
  });

  test('29 de fevereiro passa em ano bissexto e falha fora dele', () => {
    assert.ok(lerDataBr('29/02/2028'));
    assert.equal(lerDataBr('29/02/2027'), null);
  });
});

describe('lerHashtags', () => {
  test('aceita qualquer separador e tira o #', () => {
    assert.deepEqual(lerHashtags('#pizza #petrolina'), ['pizza', 'petrolina']);
    assert.deepEqual(lerHashtags('pizza, petrolina; delivery'), ['pizza', 'petrolina', 'delivery']);
  });

  test('vazio da lista vazia', () => {
    assert.deepEqual(lerHashtags(''), []);
  });
});

describe('lerPlanilha', () => {
  const agora = new Date(2026, 7, 1, 12, 0, 0);

  test('le uma planilha boa', () => {
    const csv = [
      'data,legenda,imagem,hashtags',
      '03/08/2026 10:00,Pizza nova,https://x.com/a.jpg,#pizza #petrolina',
      '04/08/2026 19:00,Promo de quinta,https://x.com/b.jpg,',
    ].join('\n');

    const r = lerPlanilha(csv, agora);
    assert.equal(r.validas, 2);
    assert.equal(r.invalidas, 0);
    assert.equal(r.linhas[0].legenda, 'Pizza nova');
    assert.deepEqual(r.linhas[0].hashtags, ['pizza', 'petrolina']);
  });

  test('funciona com o CSV do Excel brasileiro', () => {
    const csv = 'data;legenda\n03/08/2026 10:00;Pizza nova';
    assert.equal(lerPlanilha(csv, agora).validas, 1);
  });

  // Parar no primeiro erro faria o usuario descobrir os problemas um por
  // vez, em dez tentativas.
  test('reporta TODOS os erros de uma vez', () => {
    const csv = [
      'data,legenda',
      ',Sem data',
      '03/08/2026 10:00,',
      '31/02/2026 10:00,Data que nao existe',
      '05/08/2026 10:00,Essa esta certa',
    ].join('\n');

    const r = lerPlanilha(csv, agora);
    assert.equal(r.validas, 1);
    assert.equal(r.invalidas, 3);
    assert.match(r.linhas[0].erro!, /Data inválida/);
    assert.match(r.linhas[1].erro!, /Sem legenda/);
    assert.match(r.linhas[2].erro!, /Data inválida/);
  });

  test('aponta o numero da linha da planilha, nao o indice', () => {
    const r = lerPlanilha('data,legenda\n,vazio', agora);
    // Cabecalho e a linha 1; o primeiro dado e a 2.
    assert.equal(r.linhas[0].linha, 2);
  });

  test('data no passado e recusada', () => {
    const r = lerPlanilha('data,legenda\n01/01/2020 10:00,Antiga', agora);
    assert.match(r.linhas[0].erro!, /passado/);
  });

  // Dois posts no mesmo minuto: o Instagram trata como spam e um deles falha.
  test('horario repetido e barrado', () => {
    const csv = ['data,legenda', '03/08/2026 10:00,Um', '03/08/2026 10:00,Dois'].join('\n');
    const r = lerPlanilha(csv, agora);
    assert.equal(r.validas, 1);
    assert.match(r.linhas[1].erro!, /mesmo horário/);
  });

  test('imagem que nao e endereco web e recusada', () => {
    const csv = 'data,legenda,imagem\n03/08/2026 10:00,Post,C:\\fotos\\pizza.jpg';
    assert.match(lerPlanilha(csv, agora).linhas[0].erro!, /http/);
  });

  test('sem as colunas obrigatorias, explica o que falta', () => {
    const r = lerPlanilha('nome,email\nJoao,a@b.com', agora);
    assert.match(r.erroGeral!, /data.*legenda|legenda.*data/);
    assert.equal(r.linhas.length, 0);
  });

  test('planilha so com cabecalho nao quebra', () => {
    assert.ok(lerPlanilha('data,legenda', agora).erroGeral);
    assert.ok(lerPlanilha('', agora).erroGeral);
  });

  test('linha em branco no meio e ignorada', () => {
    const csv = 'data,legenda\n03/08/2026 10:00,Um\n\n04/08/2026 10:00,Dois';
    assert.equal(lerPlanilha(csv, agora).validas, 2);
  });

  test('arquivo salvo no Windows (CRLF) e lido igual', () => {
    const csv = 'data,legenda\r\n03/08/2026 10:00,Pizza nova\r\n';
    assert.equal(lerPlanilha(csv, agora).validas, 1);
  });

  // Legenda de Instagram TEM quebra de linha, e o Excel salva isso como um
  // campo entre aspas com \n dentro. Cortar ali despedacava a legenda E
  // criava uma linha fantasma que aparecia como "sem data".
  test('legenda com quebra de linha dentro de aspas continua uma linha so', () => {
    const csv = 'data,legenda\n03/08/2026 10:00,"Chegou a pizza nova\n\nVem provar hoje"';
    const r = lerPlanilha(csv, agora);
    assert.equal(r.linhas.length, 1);
    assert.equal(r.validas, 1);
    assert.ok(r.linhas[0].legenda.includes('Vem provar hoje'));
    assert.ok(r.linhas[0].legenda.includes('\n'));
  });

  test('quebra dentro de aspas nao vira linha fantasma sem data', () => {
    const csv = 'data,legenda\n03/08/2026 10:00,"Um\ndois"\n04/08/2026 10:00,Outro';
    const r = lerPlanilha(csv, agora);
    assert.equal(r.linhas.length, 2);
    assert.equal(r.invalidas, 0);
  });

  // Truncar em silencio faria o usuario achar que importou tudo e so
  // descobrir o buraco quando a grade acabasse no meio.
  test('planilha grande demais avisa o que ficou de fora', () => {
    const linhas = Array.from({ length: 520 }, (_, i) => {
      const dia = String((i % 27) + 1).padStart(2, '0');
      const hora = String(i % 24).padStart(2, '0');
      const min = String(i % 60).padStart(2, '0');
      return `${dia}/09/2026 ${hora}:${min},Post ${i}`;
    });
    const r = lerPlanilha(['data,legenda', ...linhas].join('\n'), agora);
    assert.ok(r.aviso);
    assert.match(r.aviso!, /20/);
  });

  test('planilha dentro do limite nao gera aviso', () => {
    assert.equal(lerPlanilha('data,legenda\n03/08/2026 10:00,Post', agora).aviso, undefined);
  });
});
