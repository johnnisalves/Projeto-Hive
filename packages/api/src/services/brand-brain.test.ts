import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  diferencasObservaveis,
  consolidarRegras,
  resolverContradicoes,
  regrasParaPrompt,
  podePublicarSozinho,
  decidirSemAprovacao,
  MAX_REGRAS_NO_PROMPT,
} from './brand-brain.service';

/**
 * Uma regra errada aqui e pior que nenhuma regra: ela contamina TODAS as
 * legendas seguintes daquela marca, silenciosamente. Por isso os testes
 * insistem tanto no que NAO deve virar regra.
 */

describe('diferencasObservaveis', () => {
  test('apagar todos os emoji vira regra', () => {
    const r = diferencasObservaveis('Chegou a pizza nova 🍕🔥😍', 'Chegou a pizza nova');
    assert.ok(r.includes('Nao usar emoji nas legendas.'));
  });

  test('adicionar emoji onde nao tinha tambem vira regra', () => {
    const r = diferencasObservaveis('Chegou a pizza nova', 'Chegou a pizza nova 🍕🔥');
    assert.ok(r.includes('Usar emoji nas legendas.'));
  });

  // Limiar frouxo geraria regra a cada ajuste minimo e o prompt viraria
  // ruido ate a qualidade cair.
  test('tirar um emoji de tres nao vira regra', () => {
    const r = diferencasObservaveis('Pizza nova 🍕🔥😍', 'Pizza nova 🍕🔥');
    assert.ok(!r.some((x) => x.includes('emoji')));
  });

  test('encurtar bastante vira preferencia por legenda curta', () => {
    const longo = 'Hoje a nossa pizzaria preparou uma novidade incrivel para voce e toda a sua familia aproveitarem juntos no fim de semana';
    const r = diferencasObservaveis(longo, 'Pizza nova. Vem provar.');
    assert.ok(r.includes('Preferir legendas curtas e diretas.'));
  });

  test('corte pequeno nao vira regra de tamanho', () => {
    const r = diferencasObservaveis(
      'Hoje tem pizza nova na casa para voce provar com a familia toda',
      'Hoje tem pizza nova na casa para voce provar com a familia',
    );
    assert.ok(!r.some((x) => x.includes('curtas')));
  });

  test('apagar as hashtags da legenda vira regra', () => {
    const r = diferencasObservaveis('Pizza nova #pizza #petrolina #delivery', 'Pizza nova');
    assert.ok(r.includes('Nao colocar hashtag na legenda.'));
  });

  test('trocar abreviacao por texto por extenso vira regra', () => {
    const r = diferencasObservaveis('vc vai amar, pra hoje', 'voce vai amar, para hoje');
    assert.ok(r.includes('Escrever por extenso, sem abreviacao de internet.'));
  });

  test('tirar caixa alta vira regra', () => {
    const r = diferencasObservaveis('PROMOCAO IMPERDIVEL hoje', 'Promocao imperdivel hoje');
    assert.ok(r.includes('Nao escrever palavras em caixa alta.'));
  });

  test('baixar o excesso de exclamacao vira regra', () => {
    const r = diferencasObservaveis('Chegou!!! Corre!! Ultimas!', 'Chegou. Vem conferir.');
    assert.ok(r.includes('Usar poucas exclamacoes; tom mais sobrio.'));
  });

  // Texto identico ou vazio nao pode gerar aprendizado nenhum.
  test('sem edicao real, nao aprende nada', () => {
    assert.deepEqual(diferencasObservaveis('Pizza nova 🍕🔥', 'Pizza nova 🍕🔥'), []);
    assert.deepEqual(diferencasObservaveis('', 'Pizza'), []);
    assert.deepEqual(diferencasObservaveis('Pizza', ''), []);
    assert.deepEqual(diferencasObservaveis('', ''), []);
  });
});

describe('consolidarRegras', () => {
  test('observar de novo aumenta o peso em vez de duplicar', () => {
    const r = consolidarRegras([{ regra: 'Nao usar emoji nas legendas.', peso: 3 }], ['Nao usar emoji nas legendas.']);
    assert.equal(r.length, 1);
    assert.equal(r[0].peso, 4);
  });

  test('regra nova entra com peso 1', () => {
    const r = consolidarRegras([], ['Preferir legendas curtas e diretas.']);
    assert.equal(r[0].peso, 1);
  });

  test('ordena da mais observada para a menos', () => {
    const r = consolidarRegras([{ regra: 'A', peso: 1 }, { regra: 'B', peso: 9 }], []);
    assert.equal(r[0].regra, 'B');
  });

  test('caixa diferente e a mesma regra', () => {
    const r = consolidarRegras([{ regra: 'Nao usar emoji.', peso: 2 }], ['NAO USAR EMOJI.']);
    assert.equal(r.length, 1);
    assert.equal(r[0].peso, 3);
  });
});

describe('resolverContradicoes', () => {
  // Duas regras opostas no mesmo prompt fazem o modelo escolher no chute, e
  // a marca fica inconsistente post a post.
  test('mantem so a mais observada entre duas opostas', () => {
    const r = resolverContradicoes([
      { regra: 'Nao usar emoji nas legendas.', peso: 7 },
      { regra: 'Usar emoji nas legendas.', peso: 2 },
    ]);
    assert.equal(r.length, 1);
    assert.equal(r[0].regra, 'Nao usar emoji nas legendas.');
  });

  test('resolve cada par de opostas de forma independente', () => {
    const r = resolverContradicoes([
      { regra: 'Usar emoji nas legendas.', peso: 5 },
      { regra: 'Nao usar emoji nas legendas.', peso: 1 },
      { regra: 'Preferir legendas curtas e diretas.', peso: 4 },
      { regra: 'Preferir legendas mais longas, com contexto.', peso: 9 },
    ]);
    const textos = r.map((x) => x.regra);
    assert.ok(textos.includes('Usar emoji nas legendas.'));
    assert.ok(textos.includes('Preferir legendas mais longas, com contexto.'));
    assert.equal(r.length, 2);
  });

  test('regras que nao se contradizem passam todas', () => {
    const entrada = [
      { regra: 'Nao usar emoji nas legendas.', peso: 3 },
      { regra: 'Nao colocar hashtag na legenda.', peso: 2 },
    ];
    assert.equal(resolverContradicoes(entrada).length, 2);
  });
});

describe('regrasParaPrompt', () => {
  test('sem regras, nao polui o prompt com cabecalho vazio', () => {
    assert.equal(regrasParaPrompt([]), '');
  });

  test('lista as regras em texto', () => {
    const p = regrasParaPrompt([{ regra: 'Nao usar emoji nas legendas.', peso: 4 }]);
    assert.ok(p.includes('- Nao usar emoji nas legendas.'));
  });

  // Prompt gigante dilui a instrucao principal e o modelo passa a ignorar
  // tudo por igual.
  test('corta no limite, mantendo as mais observadas', () => {
    const muitas = Array.from({ length: 40 }, (_, i) => ({ regra: `Regra ${i}`, peso: i }));
    const p = regrasParaPrompt(muitas);
    const linhas = p.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(linhas.length, MAX_REGRAS_NO_PROMPT);
    assert.ok(p.includes('Regra 39'));
    assert.ok(!p.includes('Regra 0\n'));
  });

  test('nunca sai com regras opostas juntas', () => {
    const p = regrasParaPrompt([
      { regra: 'Nao usar emoji nas legendas.', peso: 5 },
      { regra: 'Usar emoji nas legendas.', peso: 3 },
    ]);
    assert.ok(p.includes('Nao usar emoji'));
    assert.equal(p.split('emoji').length - 1, 1);
  });
});

describe('autonomia', () => {
  // Publicar sozinho tem que ser escolha explicita. Se o default fosse
  // liberado, uma promocao com preco errado iria ao ar sem ninguem ver.
  test('sem nada liberado, nada publica sozinho', () => {
    assert.equal(podePublicarSozinho('educar', []), false);
    assert.equal(podePublicarSozinho('vender', []), false);
  });

  test('so o pilar liberado publica sozinho', () => {
    assert.equal(podePublicarSozinho('educar', ['educar']), true);
    assert.equal(podePublicarSozinho('vender', ['educar']), false);
  });

  test('post sem pilar definido nunca publica sozinho', () => {
    assert.equal(podePublicarSozinho(null, ['educar', 'vender']), false);
    assert.equal(podePublicarSozinho(undefined, ['educar']), false);
  });

  test('chegou a hora e ninguem aprovou: decide pelo pilar', () => {
    assert.equal(decidirSemAprovacao('educar', ['educar']), 'publicar');
    assert.equal(decidirSemAprovacao('vender', ['educar']), 'adiar');
    assert.equal(decidirSemAprovacao(null, ['educar']), 'adiar');
  });
});
