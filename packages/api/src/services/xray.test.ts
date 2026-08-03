import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  taxaEngajamento,
  frequenciaSemanal,
  diagnosticar,
  normalizarUsername,
  TAXA_OTIMA,
  TAXA_BAIXA,
  FREQ_IDEAL_MIN,
} from './xray.service';

/**
 * Esta pagina e PUBLICA e o resultado e feito para ser compartilhado. Um
 * numero errado aqui vira print no grupo do WhatsApp com o nome do
 * DisparaAI embaixo.
 */

const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const midias = (qtd: number, likes: number, comments = 0, espacamento = 2) =>
  Array.from({ length: qtd }, (_, i) => ({ likes, comments, timestamp: dias(i * espacamento) }));

describe('taxaEngajamento', () => {
  // E A metrica que compara contas de tamanhos diferentes.
  test('calcula interacoes medias sobre seguidores', () => {
    assert.equal(taxaEngajamento(midias(10, 50, 0), 1000), 5);
    assert.equal(taxaEngajamento(midias(10, 40, 10), 1000), 5);
  });

  // Dividir por zero daria "Infinity%" na tela de uma pagina publica.
  test('conta sem seguidores nao gera taxa', () => {
    assert.equal(taxaEngajamento(midias(5, 10), 0), null);
    assert.equal(taxaEngajamento(midias(5, 10), -1), null);
  });

  test('sem posts nao gera taxa', () => {
    assert.equal(taxaEngajamento([], 1000), null);
  });

  test('arredonda para uma casa', () => {
    assert.equal(taxaEngajamento(midias(3, 37), 1000), 3.7);
  });
});

describe('frequenciaSemanal', () => {
  test('calcula pelos intervalos reais', () => {
    // 8 posts, um a cada 2 dias = 14 dias -> 4 por semana
    assert.equal(frequenciaSemanal(midias(8, 10, 0, 2)), 4);
  });

  // "posts / 4 semanas" mentiria para quem publicou tudo num dia so.
  test('nao chuta media fixa', () => {
    const mesmoDia = Array.from({ length: 20 }, () => ({ likes: 1, comments: 0, timestamp: dias(0) }));
    assert.equal(frequenciaSemanal(mesmoDia), null);
  });

  test('menos de dois posts nao da para calcular', () => {
    assert.equal(frequenciaSemanal(midias(1, 10)), null);
    assert.equal(frequenciaSemanal([]), null);
  });

  test('post sem data e ignorado sem quebrar', () => {
    const mistos = [{ likes: 1, comments: 0 }, ...midias(4, 10, 0, 3)];
    assert.ok(frequenciaSemanal(mistos)! > 0);
  });
});

describe('diagnosticar', () => {
  const perfil = (over: Partial<any> = {}) => ({
    username: 'essenza',
    followers: 1000,
    mediaCount: 120,
    midias: midias(10, 40, 5, 2),
    ...over,
  });

  test('perfil bom recebe nota alta e elogio', () => {
    const d = diagnosticar(perfil({ midias: midias(10, 60, 15, 2) }));
    assert.ok(d.nota >= 70);
    assert.ok(d.sinais.some((s) => s.bom));
  });

  test('perfil fraco recebe nota baixa e problemas apontados', () => {
    const d = diagnosticar(perfil({ followers: 10000, midias: midias(3, 20, 0, 10) }));
    assert.ok(d.nota < 55);
    assert.ok(d.sinais.some((s) => !s.bom));
  });

  // Nota 0 ou 100 promete uma certeza que um diagnostico de 24 posts nao
  // tem — e nota 0 numa pagina publica humilha quem foi olhar.
  test('a nota nunca chega aos extremos', () => {
    const pessimo = diagnosticar(perfil({ followers: 999999, midias: midias(2, 1, 0, 30) }));
    const otimo = diagnosticar(perfil({ followers: 100, midias: midias(20, 90, 40, 1) }));
    assert.ok(pessimo.nota >= 10);
    assert.ok(otimo.nota <= 95);
  });

  test('frequencia baixa e apontada com o numero ideal junto', () => {
    const d = diagnosticar(perfil({ midias: midias(4, 40, 5, 14) }));
    const sinal = d.sinais.find((s) => /por semana/.test(s.texto))!;
    assert.ok(!sinal.bom);
    assert.match(sinal.texto, new RegExp(`${FREQ_IDEAL_MIN} a`));
  });

  test('excesso de posts tambem e apontado', () => {
    const d = diagnosticar(perfil({ midias: Array.from({ length: 24 }, (_, i) => ({ likes: 40, comments: 5, timestamp: dias(i * 0.2) })) }));
    assert.ok(d.sinais.some((s) => /muito/.test(s.texto)));
  });

  test('post fora da curva vira dica de repetir o formato', () => {
    const comViral = [...midias(9, 20, 2, 2), { likes: 900, comments: 100, timestamp: dias(1) }];
    const d = diagnosticar(perfil({ midias: comViral }));
    assert.ok(d.sinais.some((s) => /3x mais/.test(s.texto)));
  });

  test('falta de comentario e apontada', () => {
    const d = diagnosticar(perfil({ midias: midias(10, 200, 0, 2) }));
    assert.ok(d.sinais.some((s) => /comenta/.test(s.texto)));
  });

  test('taxa otima e taxa baixa geram sinais opostos', () => {
    const alto = diagnosticar(perfil({ followers: 100, midias: midias(10, TAXA_OTIMA + 1, 0, 2) }));
    const baixo = diagnosticar(perfil({ followers: 100000, midias: midias(10, TAXA_BAIXA, 0, 2) }));
    assert.ok(alto.sinais[0].bom);
    assert.ok(!baixo.sinais[0].bom);
  });

  test('perfil sem post nenhum nao quebra', () => {
    const d = diagnosticar(perfil({ midias: [] }));
    assert.ok(d.nota > 0);
    assert.ok(d.sinais.length > 0);
  });

  test('sempre devolve um resumo em portugues', () => {
    assert.ok(diagnosticar(perfil()).resumo.length > 10);
  });
});

describe('normalizarUsername', () => {
  test('aceita o @ e o nome cru', () => {
    assert.equal(normalizarUsername('@essenza'), 'essenza');
    assert.equal(normalizarUsername('essenza'), 'essenza');
  });

  // Colar a URL inteira e o que a maioria faz.
  test('aceita a URL colada do navegador', () => {
    assert.equal(normalizarUsername('https://www.instagram.com/pizzaria.essenza/'), 'pizzaria.essenza');
    assert.equal(normalizarUsername('instagram.com/essenza?igsh=abc'), 'essenza');
  });

  test('mantem ponto e underscore, que sao validos', () => {
    assert.equal(normalizarUsername('pizza_essenza.oficial'), 'pizza_essenza.oficial');
  });

  test('tira o que nao pode existir num @', () => {
    assert.equal(normalizarUsername('essen za!'), 'essenza');
    assert.equal(normalizarUsername('ESSENZA'), 'essenza');
  });

  test('lixo vira string curta, que a rota recusa', () => {
    assert.equal(normalizarUsername(''), '');
    assert.equal(normalizarUsername('!!!'), '');
  });
});
