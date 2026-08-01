import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPostSchema, PLATFORMS } from './post.schemas';

/**
 * Testes da validacao de criacao de post.
 *
 * O middleware validate() devolve 400 quando o schema rejeita — ele NAO
 * filtra campo desconhecido. Entao uma plataforma faltando aqui nao degrada
 * o comportamento: quebra a criacao do post inteiro.
 */

const base = { caption: 'teste' };

describe('plataformas aceitas', () => {
  // Regressao: TIKTOK ficou de fora deste enum quando o canal foi criado,
  // e publicar no TikTok pela interface voltava 400.
  test('TIKTOK e aceito', () => {
    const r = createPostSchema.safeParse({ ...base, platforms: ['TIKTOK'] });
    assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.flatten().fieldErrors));
  });

  test('toda plataforma do publisher passa na validacao', () => {
    for (const p of PLATFORMS) {
      assert.equal(createPostSchema.safeParse({ ...base, platforms: [p] }).success, true, `${p} foi rejeitada`);
    }
  });

  test('varias plataformas juntas passam', () => {
    assert.equal(createPostSchema.safeParse({ ...base, platforms: [...PLATFORMS] }).success, true);
  });

  test('plataforma inexistente e rejeitada', () => {
    assert.equal(createPostSchema.safeParse({ ...base, platforms: ['ORKUT'] }).success, false);
  });
});

describe('marcacao de pessoas', () => {
  test('marcacao valida passa', () => {
    const r = createPostSchema.safeParse({
      ...base,
      userTags: [{ username: 'joao', x: 0.5, y: 0.5, imageIndex: 0 }],
    });
    assert.equal(r.success, true);
  });

  test('imageIndex e opcional', () => {
    assert.equal(createPostSchema.safeParse({ ...base, userTags: [{ username: 'a', x: 0, y: 1 }] }).success, true);
  });

  test('coordenada fora de 0–1 e rejeitada', () => {
    assert.equal(createPostSchema.safeParse({ ...base, userTags: [{ username: 'a', x: 1.5, y: 0.5 }] }).success, false);
    assert.equal(createPostSchema.safeParse({ ...base, userTags: [{ username: 'a', x: 0.5, y: -0.1 }] }).success, false);
  });

  test('usuario vazio e rejeitado', () => {
    assert.equal(createPostSchema.safeParse({ ...base, userTags: [{ username: '', x: 0.5, y: 0.5 }] }).success, false);
  });
});

describe('limites que a API do Meta impoe', () => {
  test('ate 3 colaboradores passa, 4 e rejeitado', () => {
    assert.equal(createPostSchema.safeParse({ ...base, collaborators: ['a', 'b', 'c'] }).success, true);
    assert.equal(createPostSchema.safeParse({ ...base, collaborators: ['a', 'b', 'c', 'd'] }).success, false);
  });

  test('ate 2 patrocinadores passa, 3 e rejeitado', () => {
    assert.equal(createPostSchema.safeParse({ ...base, sponsorIds: ['1', '2'] }).success, true);
    assert.equal(createPostSchema.safeParse({ ...base, sponsorIds: ['1', '2', '3'] }).success, false);
  });

  test('texto alternativo de 1000 chars passa, 1001 e rejeitado', () => {
    assert.equal(createPostSchema.safeParse({ ...base, altText: 'a'.repeat(1000) }).success, true);
    assert.equal(createPostSchema.safeParse({ ...base, altText: 'a'.repeat(1001) }).success, false);
  });

  test('volume do audio so de 0 a 100', () => {
    assert.equal(createPostSchema.safeParse({ ...base, audioVolume: 0 }).success, true);
    assert.equal(createPostSchema.safeParse({ ...base, audioVolume: 100 }).success, true);
    assert.equal(createPostSchema.safeParse({ ...base, audioVolume: 101 }).success, false);
  });

  test('URLs de audio e capa precisam ser validas', () => {
    assert.equal(createPostSchema.safeParse({ ...base, audioUrl: 'nao-e-url' }).success, false);
    assert.equal(createPostSchema.safeParse({ ...base, coverUrl: 'nao-e-url' }).success, false);
    assert.equal(createPostSchema.safeParse({ ...base, audioUrl: 'https://x/a.mp3' }).success, true);
  });
});

describe('compatibilidade com o que ja existia', () => {
  test('post antigo, sem nenhum campo novo, continua valido', () => {
    const r = createPostSchema.safeParse({
      caption: 'post de antes',
      imageUrl: 'https://x/i.jpg',
      hashtags: ['a', 'b'],
      platforms: ['INSTAGRAM'],
      aspectRatio: '1:1',
    });
    assert.equal(r.success, true);
  });

  test('payload vazio e valido (tudo e opcional)', () => {
    assert.equal(createPostSchema.safeParse({}).success, true);
  });
});
