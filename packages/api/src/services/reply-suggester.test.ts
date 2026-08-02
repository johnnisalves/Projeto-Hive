import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectarIntencao } from './reply-suggester.service';

/**
 * A intencao decide a orientacao que vai para a IA. Classificar errado faz
 * a resposta sair sem chamar para a venda (em pergunta de preco) ou sem
 * empatia (em reclamacao) — os dois casos que mais custam dinheiro.
 */

describe('detectarIntencao', () => {
  const casos: Array<[string, string]> = [
    // Preco: o mais importante de acertar
    ['preco', 'quanto custa?'],
    ['preco', 'Qual o valor dessa peça?'],
    ['preco', 'quanto é o frete pra Petrolina'],
    ['preco', 'me passa o preço por favor'],
    ['preco', 'quanto fica pra 20 pessoas?'],
    ['preco', 'faz orçamento?'],

    // Reclamacao
    ['reclamacao', 'péssimo atendimento'],
    ['reclamacao', 'chegou com defeito'],
    ['reclamacao', 'demorou demais pra entregar'],
    ['reclamacao', 'não gostei do produto'],

    // Interesse de compra
    ['interesse', 'quero comprar!'],
    ['interesse', 'como faço para comprar?'],
    ['interesse', 'tenho interesse, ainda tem disponível?'],

    // Elogio
    ['elogio', 'amei demais 😍'],
    ['elogio', 'que lindo!'],
    ['elogio', 'parabéns pelo trabalho'],
    ['elogio', 'top demais'],

    // Duvida generica
    ['duvida', 'vocês fazem entrega?'],
    ['duvida', 'qual horário abre?'],
    ['duvida', 'onde fica?'],

    // Sem intencao clara
    ['outro', 'bom dia'],
    ['outro', '🔥🔥🔥'],
  ];

  for (const [esperado, texto] of casos) {
    test(`"${texto}" -> ${esperado}`, () => {
      assert.equal(detectarIntencao(texto), esperado);
    });
  }

  // Reclamacao ganha de pergunta: "por que demorou tanto?" tem "?" e "por
  // que", mas responder como duvida generica seria pessimo.
  test('reclamação com ponto de interrogação continua reclamação', () => {
    assert.equal(detectarIntencao('por que demorou tanto?'), 'reclamacao');
    assert.equal(detectarIntencao('qual o problema com o pedido?'), 'reclamacao');
  });

  // Preco ganha de tudo: e o comentario que mais vira venda.
  test('preço vence outras pistas na mesma frase', () => {
    assert.equal(detectarIntencao('amei! quanto custa?'), 'preco');
    assert.equal(detectarIntencao('quero comprar, qual o valor?'), 'preco');
  });

  test('caixa alta e acento não atrapalham', () => {
    assert.equal(detectarIntencao('QUANTO CUSTA'), 'preco');
    assert.equal(detectarIntencao('PRECO?'), 'preco');
    assert.equal(detectarIntencao('preço?'), 'preco');
  });

  test('texto vazio ou nulo não quebra', () => {
    assert.equal(detectarIntencao(''), 'outro');
    assert.equal(detectarIntencao(undefined as unknown as string), 'outro');
  });
});
