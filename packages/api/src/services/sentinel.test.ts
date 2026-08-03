import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  naJanela,
  detectarCrise,
  devePausar,
  elegivelComoDepoimento,
  prepararDepoimento,
  melhoresDepoimentos,
  MINIMO_COMENTARIOS,
  MAX_CARACTERES_DEPOIMENTO,
} from './sentinel.service';

/**
 * Os dois erros caros aqui sao opostos:
 * - alarme falso pausa a grade de um cliente sem motivo;
 * - alarme perdido deixa a marca despejando promocao no meio de um incendio.
 * Por isso a deteccao exige volume E proporcao ao mesmo tempo.
 */

const agora = new Date(2026, 7, 2, 23, 0, 0);
const minAtras = (n: number) => new Date(agora.getTime() - n * 60_000);

const c = (texto: string, sentimento?: string, min = 5) => ({
  id: texto.slice(0, 8),
  texto,
  criadoEm: minAtras(min),
  sentimento,
});

describe('naJanela', () => {
  test('crise se mede em minutos, nao em dias', () => {
    assert.ok(naJanela(c('a', 'negativo', 10), agora));
    assert.ok(!naJanela(c('a', 'negativo', 200), agora));
  });
});

describe('detectarCrise', () => {
  test('avalanche de negativos vira crise', () => {
    const r = detectarCrise([
      c('pessimo', 'negativo'), c('horrivel', 'negativo'), c('nunca mais', 'negativo'),
      c('que absurdo', 'negativo'), c('caro demais', 'negativo'), c('gostei', 'positivo'),
    ], agora);
    assert.ok(r.crise);
    assert.match(r.motivo!, /5 de 6/);
  });

  // Duas pessoas mal-humoradas num post morto nao sao crise. Pausar a grade
  // do cliente por isso seria pior que o problema.
  test('volume baixo nao dispara, mesmo 100% negativo', () => {
    const r = detectarCrise([c('ruim', 'negativo'), c('pessimo', 'negativo')], agora);
    assert.ok(!r.crise);
    assert.equal(r.proporcao, 1);
  });

  // Post que viralizou naturalmente atrai alguns criticos; volume sozinho
  // nao pode disparar.
  test('muito comentario com poucos negativos nao dispara', () => {
    const comentarios = [
      ...Array.from({ length: 40 }, (_, i) => c(`otimo ${i}`, 'positivo')),
      ...Array.from({ length: 5 }, (_, i) => c(`ruim ${i}`, 'negativo')),
    ];
    assert.ok(!detectarCrise(comentarios, agora).crise);
  });

  test('comentario velho nao conta para a crise de agora', () => {
    const antigos = Array.from({ length: 10 }, (_, i) => c(`ruim ${i}`, 'negativo', 300));
    const r = detectarCrise(antigos, agora);
    assert.ok(!r.crise);
    assert.equal(r.total, 0);
  });

  const negativos = (n: number) => Array.from({ length: n }, (_, i) => c(`ruim ${i}`, 'negativo'));
  const positivos = (n: number) => Array.from({ length: n }, (_, i) => c(`bom ${i}`, 'positivo'));

  test('no volume minimo exato, ja dispara', () => {
    assert.equal(MINIMO_COMENTARIOS, 5);
    assert.ok(detectarCrise([...negativos(3), ...positivos(2)], agora).crise);
  });

  test('um comentario abaixo do minimo, nao dispara', () => {
    assert.ok(!detectarCrise([...negativos(3), ...positivos(1)], agora).crise);
  });

  // Metade negativa e o limiar: tem que contar como crise, nao ficar de fora
  // por um "menor que" onde deveria ser "menor ou igual".
  test('proporcao exatamente na metade conta como crise', () => {
    const r = detectarCrise([...negativos(3), ...positivos(3)], agora);
    assert.equal(r.proporcao, 0.5);
    assert.ok(r.crise);
  });

  test('logo abaixo da metade nao dispara', () => {
    assert.ok(!detectarCrise([...negativos(3), ...positivos(4)], agora).crise);
  });

  test('sem comentario nenhum nao quebra', () => {
    const r = detectarCrise([], agora);
    assert.ok(!r.crise);
    assert.equal(r.proporcao, 0);
  });
});

describe('devePausar', () => {
  // Travar a conta inteira por um comentario ruim seria pior que o problema.
  test('conteudo de educar segue no ar', () => {
    assert.equal(devePausar('educar'), false);
    assert.equal(devePausar('engajar'), false);
  });

  test('promocao para: soa como marca ignorando a reclamacao', () => {
    assert.equal(devePausar('vender'), true);
  });

  // Sem pilar nao da para garantir que nao e promocao; errar para o lado
  // cauteloso e barato aqui.
  test('post sem pilar definido tambem pausa', () => {
    assert.equal(devePausar(null), true);
    assert.equal(devePausar(undefined), true);
    assert.equal(devePausar(''), true);
  });
});

describe('elegivelComoDepoimento', () => {
  test('elogio com frase vira depoimento', () => {
    assert.ok(elegivelComoDepoimento(c('a melhor pizza de Petrolina, massa perfeita')));
    assert.ok(elegivelComoDepoimento(c('amei demais, recomendo pra todo mundo')));
  });

  // "top" e elogio, mas numa arte de depoimento fica ridiculo.
  test('elogio de uma palavra nao vira arte', () => {
    assert.ok(!elegivelComoDepoimento(c('top')));
    assert.ok(!elegivelComoDepoimento(c('melhor')));
  });

  test('risada e emoji solto nao sao depoimento', () => {
    assert.ok(!elegivelComoDepoimento(c('kkkkk melhor coisa')));
    assert.ok(!elegivelComoDepoimento(c('❤️')));
  });

  test('comentario negativo nunca passa', () => {
    assert.ok(!elegivelComoDepoimento(c('dizem que e a melhor mas nao gostei', 'negativo')));
  });

  test('comentario sem elogio nenhum nao passa', () => {
    assert.ok(!elegivelComoDepoimento(c('qual o horario de funcionamento?')));
    assert.ok(!elegivelComoDepoimento(c('')));
  });

  // \b em JavaScript usa [A-Za-z0-9_]: "ótimo" logo apos pontuacao nunca
  // casaria com \bótimo. Bug ja visto neste projeto.
  test('elogio acentuado colado em pontuacao e reconhecido', () => {
    assert.ok(elegivelComoDepoimento(c('nossa, ótimo atendimento sempre')));
    assert.ok(elegivelComoDepoimento(c('que delícia essa pizza, parabens')));
  });

  test('textao nao vira depoimento', () => {
    assert.ok(!elegivelComoDepoimento(c(`melhor pizza ${'x'.repeat(400)}`)));
  });

  // A elegibilidade tem que julgar o texto JA LIMPO, que e o que vai pra
  // arte. Julgando o texto cru, estes dois passavam e viravam depoimento
  // vazio ou sem elogio nenhum na peca publicada.
  test('elogio que estava so na hashtag nao vira depoimento', () => {
    assert.ok(!elegivelComoDepoimento(c('comi ontem #melhorpizzaria #top')));
  });

  test('comentario que fica curto demais depois de limpo nao passa', () => {
    assert.ok(!elegivelComoDepoimento(c('@pizzaria @amiga melhor #pizza')));
  });

  test('elogio de verdade continua passando mesmo com @ e hashtag junto', () => {
    assert.ok(elegivelComoDepoimento(c('@pizzaria a melhor pizza da cidade, massa perfeita #pizza')));
  });
});

describe('prepararDepoimento', () => {
  test('tira @ e hashtag que nao fazem sentido na arte', () => {
    assert.equal(prepararDepoimento('@pizzaria melhor pizza! #pizza'), 'melhor pizza!');
  });

  test('texto curto passa intacto', () => {
    assert.equal(prepararDepoimento('A melhor pizza da cidade'), 'A melhor pizza da cidade');
  });

  test('corte respeita o limite', () => {
    const r = prepararDepoimento(`${'palavra '.repeat(60)}fim`);
    assert.ok(r.length <= MAX_CARACTERES_DEPOIMENTO + 3);
  });

  // Terminar no meio de uma palavra fica pior que nao ter depoimento.
  test('nao corta no meio da palavra', () => {
    const r = prepararDepoimento(`${'palavra '.repeat(60)}fim`);
    assert.ok(r.endsWith('...') || /[.!?]$/.test(r));
    assert.ok(!/\w\.\.\.$/.test(r.replace(/ \.\.\.$/, '')) || r.includes(' '));
  });

  test('prefere terminar num fim de frase', () => {
    const texto = `${'a'.repeat(80)}. ${'b'.repeat(200)}`;
    assert.ok(prepararDepoimento(texto).endsWith('.'));
  });

  test('vazio nao quebra', () => {
    assert.equal(prepararDepoimento(''), '');
  });
});

describe('melhoresDepoimentos', () => {
  test('escolhe os mais especificos primeiro', () => {
    const r = melhoresDepoimentos([
      c('muito bom demais'),
      c('a melhor pizza de Petrolina, massa fina do jeito certo e atendimento otimo'),
      c('adorei bastante viu'),
    ], 2);
    assert.equal(r.length, 2);
    assert.match(r[0].texto, /Petrolina/);
  });

  test('descarta o que nao serve antes de ranquear', () => {
    const r = melhoresDepoimentos([c('top'), c('kkk'), c('qual o preco?')]);
    assert.equal(r.length, 0);
  });

  test('lista vazia nao quebra', () => {
    assert.deepEqual(melhoresDepoimentos([]), []);
  });
});
