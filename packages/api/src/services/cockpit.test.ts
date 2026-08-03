import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sinaisDaMarca,
  notaDeSaude,
  gravidadeMaxima,
  montarCockpit,
  resumoDaCarteira,
  GRADE_MINIMA,
  TOKEN_CRITICO_DIAS,
  SILENCIO_CRITICO_DIAS,
} from './cockpit.service';

/**
 * A ORDEM E O PRODUTO. Uma lista alfabetica de 40 marcas nao ajuda ninguem;
 * o que ajuda e "estas tres precisam de voce hoje". Se a ordenacao errar, a
 * tela inteira perde a razao de existir.
 */

const agora = new Date(2026, 7, 15, 12, 0, 0);
const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000);

const marca = (over: Partial<any> = {}) => ({
  id: 'm1',
  nome: 'Pizzaria Essenza',
  agendados7d: 8,
  falhas24h: 0,
  aprovacoesParadas: 0,
  diasAteTokenVencer: 45,
  ultimaPublicacao: diasAtras(1),
  ...over,
});

describe('sinaisDaMarca', () => {
  test('marca saudavel nao gera sinal nenhum', () => {
    assert.deepEqual(sinaisDaMarca(marca(), agora), []);
  });

  // E o unico sinal que significa que algo JA deu errado; os outros sao
  // prevencao. Por isso vem primeiro na lista.
  test('falha de publicacao e o primeiro sinal', () => {
    const s = sinaisDaMarca(marca({ falhas24h: 2, agendados7d: 0, diasAteTokenVencer: 1 }), agora);
    assert.equal(s[0].tipo, 'falha_publicacao');
    assert.equal(s[0].gravidade, 'critico');
  });

  test('grade vazia e critico; grade magra e atencao', () => {
    assert.equal(sinaisDaMarca(marca({ agendados7d: 0 }), agora)[0].gravidade, 'critico');
    assert.equal(sinaisDaMarca(marca({ agendados7d: GRADE_MINIMA - 1 }), agora)[0].gravidade, 'atencao');
    assert.deepEqual(sinaisDaMarca(marca({ agendados7d: GRADE_MINIMA }), agora), []);
  });

  test('token vencendo escala de atencao para critico', () => {
    assert.equal(sinaisDaMarca(marca({ diasAteTokenVencer: 20 }), agora)[0].gravidade, 'atencao');
    assert.equal(sinaisDaMarca(marca({ diasAteTokenVencer: TOKEN_CRITICO_DIAS }), agora)[0].gravidade, 'critico');
    assert.equal(sinaisDaMarca(marca({ diasAteTokenVencer: 30 }), agora).length, 0);
  });

  test('token ja vencido diz que nada sera publicado', () => {
    const s = sinaisDaMarca(marca({ diasAteTokenVencer: 0 }), agora);
    assert.equal(s[0].tipo, 'token_vencido');
    assert.match(s[0].texto, /Nada será publicado/);
  });

  // Sem conta nao e "token vencendo": e a marca inteira parada, e a acao
  // que resolve e outra (conectar, nao renovar).
  test('sem conta conectada tem sinal proprio', () => {
    const s = sinaisDaMarca(marca({ diasAteTokenVencer: null }), agora);
    assert.equal(s[0].tipo, 'sem_conta');
    assert.equal(s[0].gravidade, 'critico');
  });

  test('aprovacao parada e atencao, nao critico', () => {
    const s = sinaisDaMarca(marca({ aprovacoesParadas: 3 }), agora);
    assert.equal(s[0].gravidade, 'atencao');
    assert.match(s[0].texto, /3 posts/);
  });

  test('silencio longo vira sinal', () => {
    const s = sinaisDaMarca(marca({ ultimaPublicacao: diasAtras(SILENCIO_CRITICO_DIAS) }), agora);
    assert.ok(s.some((x) => x.tipo === 'silencio'));
  });

  // Marca que nunca publicou esta em onboarding, nao abandonada. Tratar
  // como silencio geraria alarme em todo cliente novo da agencia.
  test('marca que nunca publicou nao conta como silenciosa', () => {
    const s = sinaisDaMarca(marca({ ultimaPublicacao: null }), agora);
    assert.ok(!s.some((x) => x.tipo === 'silencio'));
  });

  test('singular e plural sao escritos certo', () => {
    assert.match(sinaisDaMarca(marca({ falhas24h: 1 }), agora)[0].texto, /1 post falhou/);
    assert.match(sinaisDaMarca(marca({ falhas24h: 2 }), agora)[0].texto, /2 posts falhou/);
    assert.match(sinaisDaMarca(marca({ agendados7d: 1 }), agora)[0].texto, /1 post agendado para/);
  });
});

describe('notaDeSaude', () => {
  test('marca sem problema tem nota cheia', () => {
    assert.equal(notaDeSaude([]), 100);
  });

  test('critico pesa mais que atencao', () => {
    const critico = notaDeSaude([{ tipo: 'x', gravidade: 'critico', texto: '' }]);
    const atencao = notaDeSaude([{ tipo: 'x', gravidade: 'atencao', texto: '' }]);
    assert.ok(critico < atencao);
  });

  // Uma marca com tudo errado nao pode gerar nota negativa: quebraria a
  // barra de progresso e a ordenacao ficaria imprevisivel.
  test('nota nunca fica negativa', () => {
    const muitos = Array.from({ length: 10 }, () => ({ tipo: 'x', gravidade: 'critico' as const, texto: '' }));
    assert.equal(notaDeSaude(muitos), 0);
  });
});

describe('gravidadeMaxima', () => {
  test('um critico no meio de atencoes manda na cor', () => {
    assert.equal(gravidadeMaxima([
      { tipo: 'a', gravidade: 'atencao', texto: '' },
      { tipo: 'b', gravidade: 'critico', texto: '' },
    ]), 'critico');
  });

  test('sem sinal e ok', () => {
    assert.equal(gravidadeMaxima([]), 'ok');
  });
});

describe('montarCockpit', () => {
  test('pior primeiro', () => {
    const linhas = montarCockpit([
      marca({ id: 'boa', nome: 'Boa' }),
      marca({ id: 'ruim', nome: 'Ruim', agendados7d: 0, diasAteTokenVencer: 1, falhas24h: 3 }),
      marca({ id: 'media', nome: 'Media', aprovacoesParadas: 2 }),
    ], agora);

    assert.equal(linhas[0].id, 'ruim');
    assert.equal(linhas[1].id, 'media');
    assert.equal(linhas[2].id, 'boa');
  });

  // Sem desempate estavel a lista dancaria a cada atualizacao e o usuario
  // perderia o lugar onde estava lendo.
  test('marcas empatadas ficam em ordem alfabetica, sempre igual', () => {
    const entrada = [marca({ id: '1', nome: 'Zebra' }), marca({ id: '2', nome: 'Abelha' })];
    const a = montarCockpit(entrada, agora).map((l) => l.nome);
    const b = montarCockpit([...entrada].reverse(), agora).map((l) => l.nome);
    assert.deepEqual(a, ['Abelha', 'Zebra']);
    assert.deepEqual(a, b);
  });

  test('desempate respeita acento do portugues', () => {
    const linhas = montarCockpit([marca({ id: '1', nome: 'Zap' }), marca({ id: '2', nome: 'Água' })], agora);
    assert.equal(linhas[0].nome, 'Água');
  });

  test('carteira vazia nao quebra', () => {
    assert.deepEqual(montarCockpit([], agora), []);
  });
});

describe('resumoDaCarteira', () => {
  test('conta cada faixa', () => {
    const linhas = montarCockpit([
      marca({ id: '1', nome: 'A' }),
      marca({ id: '2', nome: 'B', agendados7d: 0 }),
      marca({ id: '3', nome: 'C', aprovacoesParadas: 1 }),
    ], agora);

    const r = resumoDaCarteira(linhas);
    assert.equal(r.total, 3);
    assert.equal(r.criticas, 1);
    assert.equal(r.atencao, 1);
    assert.equal(r.ok, 1);
  });

  test('cada marca cai em exatamente uma faixa', () => {
    const linhas = montarCockpit(
      Array.from({ length: 12 }, (_, i) => marca({ id: String(i), nome: `M${i}`, agendados7d: i, aprovacoesParadas: i % 3 })),
      agora,
    );
    const r = resumoDaCarteira(linhas);
    assert.equal(r.criticas + r.atencao + r.ok, r.total);
  });
});
