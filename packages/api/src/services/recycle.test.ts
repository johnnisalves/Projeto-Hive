import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pontuacao, elegivel, ranquear, PostAvaliado, DIAS_MINIMOS, DIAS_ENTRE_RECICLAGENS,
} from './recycle.service';

/**
 * Reciclar cedo demais faz o seguidor perceber a repeticao — e o alcance
 * cai justamente no post que era o melhor da conta. As travas de tempo sao
 * o que separa "reciclagem" de "spam do proprio conteudo".
 */

const hoje = new Date(2026, 5, 1);
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 86_400_000);

function post(over: Partial<PostAvaliado> = {}): PostAvaliado {
  return {
    id: 'p1',
    caption: 'Legenda',
    imageUrl: 'https://x/i.jpg',
    publishedAt: diasAtras(90),
    recycledAt: null,
    likes: 100,
    comments: 10,
    ...over,
  };
}

describe('pontuacao', () => {
  // Curtir custa um toque; comentar custa intencao.
  test('comentário pesa 3x mais que curtida', () => {
    assert.equal(pontuacao(100, 0), 100);
    assert.equal(pontuacao(0, 100), 300);
  });

  test('post com menos curtidas mas mais comentários vence', () => {
    const engajado = pontuacao(50, 20);   // 50 + 60 = 110
    const vaidoso = pontuacao(200, 2);    // 200 + 6 = 206
    assert.ok(vaidoso > engajado, 'confirma a formula');
    // E com a diferenca de comentarios mais forte, o engajado vence:
    assert.ok(pontuacao(50, 60) > pontuacao(200, 2));
  });

  test('número negativo não vira nota negativa', () => {
    assert.equal(pontuacao(-10, -5), 0);
  });

  test('zero em tudo dá zero', () => {
    assert.equal(pontuacao(0, 0), 0);
  });
});

describe('elegivel', () => {
  test('post recente demais não pode ser reciclado', () => {
    assert.equal(elegivel(post({ publishedAt: diasAtras(DIAS_MINIMOS - 1) }), hoje), false);
    assert.equal(elegivel(post({ publishedAt: diasAtras(DIAS_MINIMOS + 1) }), hoje), true);
  });

  // Sem esta trava o mesmo post voltaria toda semana.
  test('post reciclado há pouco tempo espera a vez', () => {
    assert.equal(elegivel(post({ recycledAt: diasAtras(DIAS_ENTRE_RECICLAGENS - 1) }), hoje), false);
    assert.equal(elegivel(post({ recycledAt: diasAtras(DIAS_ENTRE_RECICLAGENS + 1) }), hoje), true);
  });

  test('post sem arte não entra — não há o que republicar', () => {
    assert.equal(elegivel(post({ imageUrl: null }), hoje), false);
  });

  test('post nunca publicado não entra', () => {
    assert.equal(elegivel(post({ publishedAt: null }), hoje), false);
  });

  test('post antigo e nunca reciclado é elegível', () => {
    assert.equal(elegivel(post({ publishedAt: diasAtras(365), recycledAt: null }), hoje), true);
  });
});

describe('ranquear', () => {
  test('ordena do mais engajado para o menos', () => {
    const r = ranquear([
      post({ id: 'fraco', likes: 10, comments: 0 }),
      post({ id: 'forte', likes: 10, comments: 100 }),
      post({ id: 'medio', likes: 150, comments: 0 }),
    ], hoje);
    assert.deepEqual(r.map((p) => p.id), ['forte', 'medio', 'fraco']);
  });

  test('descarta os inelegíveis antes de ordenar', () => {
    const r = ranquear([
      post({ id: 'novo', publishedAt: diasAtras(5), likes: 9999 }),   // recente demais
      post({ id: 'valido', likes: 10 }),
    ], hoje);
    assert.deepEqual(r.map((p) => p.id), ['valido']);
  });

  test('respeita o limite pedido', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => post({ id: `p${i}`, likes: i }));
    assert.equal(ranquear(muitos, hoje, 5).length, 5);
  });

  test('nenhum elegível devolve lista vazia', () => {
    const r = ranquear([post({ publishedAt: diasAtras(1) })], hoje);
    assert.deepEqual(r, []);
  });

  test('lista vazia não quebra', () => {
    assert.deepEqual(ranquear([], hoje), []);
  });

  // O critério "receita" muda a pergunta de "o que a audiência curtiu?"
  // para "o que encheu o caixa?" — e são respostas diferentes com
  // frequência: o post engraçado ganha em curtida, o de promoção ganha em
  // pedido.
  test('por receita, o que vendeu ganha do que só engajou', () => {
    const r = ranquear([
      post({ id: 'viral', likes: 5000, comments: 400, receitaCentavos: 0 }),
      post({ id: 'vendeu', likes: 12, comments: 1, receitaCentavos: 89000 }),
    ], hoje, 10, 'receita');
    assert.deepEqual(r.map((p) => p.id), ['vendeu', 'viral']);
  });

  test('por engajamento, o ranking antigo continua igual', () => {
    const entrada = [
      post({ id: 'viral', likes: 5000, comments: 400, receitaCentavos: 0 }),
      post({ id: 'vendeu', likes: 12, comments: 1, receitaCentavos: 89000 }),
    ];
    assert.deepEqual(ranquear(entrada, hoje).map((p) => p.id), ['viral', 'vendeu']);
  });

  // Quem ainda não usa cupom nem modo balcão não pode receber uma lista
  // aleatória: os sem receita caem para o fim, mas ordenados entre si por
  // engajamento.
  test('posts sem receita medida ficam atrás, mas em ordem útil', () => {
    const r = ranquear([
      post({ id: 'semA', likes: 10, comments: 0 }),
      post({ id: 'semB', likes: 900, comments: 0 }),
      post({ id: 'com', likes: 1, comments: 0, receitaCentavos: 500 }),
    ], hoje, 10, 'receita');
    assert.deepEqual(r.map((p) => p.id), ['com', 'semB', 'semA']);
  });

  test('ninguém com receita medida cai no ranking de engajamento', () => {
    const r = ranquear([
      post({ id: 'a', likes: 10 }),
      post({ id: 'b', likes: 900 }),
    ], hoje, 10, 'receita');
    assert.deepEqual(r.map((p) => p.id), ['b', 'a']);
  });

  test('o limite vale igual nos dois critérios', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => post({ id: `p${i}`, likes: i, receitaCentavos: i * 100 }));
    assert.equal(ranquear(muitos, hoje, 5, 'receita').length, 5);
  });
});
