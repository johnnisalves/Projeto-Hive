import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarPalavra,
  casaGatilho,
  escolherGatilho,
  montarResposta,
  dentroDoPrazo,
} from './comment-trigger.service';

/**
 * Um comentario aceita UMA resposta privada, e so por 7 dias. Errar aqui nao
 * da erro visivel: o lead simplesmente nunca recebe a DM, e a unica chance
 * daquele comentario ja foi queimada.
 */

const g = (palavra: string, extra: Partial<any> = {}) => ({
  id: palavra,
  palavra,
  resposta: 'r',
  postId: null,
  ativo: true,
  ...extra,
});

describe('normalizarPalavra', () => {
  test('tira acento e caixa', () => {
    assert.equal(normalizarPalavra('CARDÁPIO'), 'cardapio');
    assert.equal(normalizarPalavra('  Eu   Quero  '), 'eu quero');
  });
});

describe('casaGatilho', () => {
  test('casa mesmo com o seguidor escrevendo diferente', () => {
    assert.ok(casaGatilho('EU QUERO!!!', 'eu quero'));
    assert.ok(casaGatilho('quero o cardápio', 'CARDAPIO'));
    assert.ok(casaGatilho('cardapio por favor', 'cardápio'));
  });

  // Trecho solto dispararia o gatilho errado: "quero" nao pode casar em
  // "requerimento" nem em "querosene".
  test('compara palavra inteira, nao pedaco', () => {
    assert.ok(!casaGatilho('mandei o requerimento', 'quero'));
    assert.ok(!casaGatilho('comprei querosene', 'quero'));
    assert.ok(casaGatilho('quero sim', 'quero'));
  });

  test('funciona no comeco, no meio e no fim do comentario', () => {
    assert.ok(casaGatilho('quero muito', 'quero'));
    assert.ok(casaGatilho('eu quero isso', 'quero'));
    assert.ok(casaGatilho('sim, quero', 'quero'));
  });

  test('pontuacao grudada nao atrapalha', () => {
    assert.ok(casaGatilho('quero!', 'quero'));
    assert.ok(casaGatilho('(quero)', 'quero'));
    assert.ok(casaGatilho('quero...', 'quero'));
  });

  test('emoji no comentario nao quebra o casamento', () => {
    assert.ok(casaGatilho('quero 🍕🔥', 'quero'));
  });

  // Se o usuario cadastrar um gatilho com parenteses ou ponto, o regex nao
  // pode explodir nem virar coringa.
  test('caractere especial no gatilho e tratado como texto', () => {
    assert.ok(casaGatilho('quero (promo)', '(promo)'));
    assert.ok(!casaGatilho('quero xyz', 'q.ero'));
  });

  test('vazio nao casa com nada', () => {
    assert.ok(!casaGatilho('', 'quero'));
    assert.ok(!casaGatilho('quero', ''));
  });
});

describe('escolherGatilho', () => {
  test('sem gatilho que case, devolve null', () => {
    assert.equal(escolherGatilho('boa noite', [g('quero')]), null);
  });

  test('gatilho desativado nao responde', () => {
    assert.equal(escolherGatilho('quero', [g('quero', { ativo: false })]), null);
  });

  // Um gatilho generico roubaria os comentarios do especifico, que tem
  // resposta melhor.
  test('a palavra mais especifica ganha', () => {
    const escolhido = escolherGatilho('quero o cardapio completo', [g('quero'), g('cardapio completo')]);
    assert.equal(escolhido!.palavra, 'cardapio completo');
  });

  test('gatilho daquele post ganha do gatilho geral da conta', () => {
    const escolhido = escolherGatilho('quero', [g('quero'), g('quero', { id: 'do-post', postId: 'p1' })], 'p1');
    assert.equal(escolhido!.id, 'do-post');
  });

  test('gatilho de outro post nao vaza para este', () => {
    assert.equal(escolherGatilho('quero', [g('quero', { postId: 'p1' })], 'p2'), null);
  });

  test('gatilho geral vale para qualquer post', () => {
    assert.ok(escolherGatilho('quero', [g('quero')], 'qualquer-post'));
  });
});

describe('montarResposta', () => {
  test('troca a marcacao pelo @ de quem comentou', () => {
    assert.equal(montarResposta('Oi {nome}! Segue o link', 'jussara'), 'Oi @jussara! Segue o link');
  });

  // Sem username (acontece), a mensagem nao pode sair com "Oi {nome}!"
  // literal na cara do seguidor.
  test('sem username, a frase ainda faz sentido', () => {
    assert.equal(montarResposta('Oi {nome}!', null), 'Oi tudo bem!');
    assert.ok(!montarResposta('Oi {nome}!', null).includes('{'));
  });

  test('aceita a marcacao em qualquer caixa', () => {
    assert.equal(montarResposta('Oi {NOME}', 'ana'), 'Oi @ana');
  });
});

describe('dentroDoPrazo', () => {
  const agora = new Date(2026, 5, 15, 12, 0, 0);
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000);

  test('comentario recente pode receber resposta', () => {
    assert.ok(dentroDoPrazo(diasAtras(1), agora));
    assert.ok(dentroDoPrazo(diasAtras(6), agora));
  });

  // Passar do prazo faz a API recusar. Checar antes evita marcar como
  // respondido um comentario que nunca recebeu a DM.
  test('passou de 7 dias, nao tenta', () => {
    assert.ok(!dentroDoPrazo(diasAtras(8), agora));
  });

  test('exatamente 7 dias ainda vale', () => {
    assert.ok(dentroDoPrazo(diasAtras(7), agora));
  });
});
