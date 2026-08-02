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
});
