import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  getFormatSpec,
  safeAreaPx,
  geminiAspectRatio,
  openRouterAspectRatio,
  huggingFaceDimensions,
} from './format-spec';
import {
  detectNiche,
  resolveCreativeMode,
  buildCreativePlanSystemPrompt,
  planToImagePrompt,
  buildNegativePrompt,
  type CreativeInput,
  type CreativePlan,
} from './creative-engine';
import { normalizeToSpec } from './image-normalize';

const baseInput: CreativeInput = {
  topic: 'Pizzaria premium chegando em Petrolina',
  brand: { name: 'Bella Napoli', primaryColor: '#E63946', secondaryColor: '#F1FAEE' },
  headline: 'Chegou em Petrolina',
  format: 'ig-feed',
  creativeMode: 'auto',
  creativeIntensity: 'balanced',
  variationSeed: 7,
};

test('formatos resolvem para o canvas correto', () => {
  const cases: Record<string, [number, number, string]> = {
    'ig-feed': [1080, 1350, '4:5'],
    'ig-feed-square': [1080, 1080, '1:1'],
    'ig-stories': [1080, 1920, '9:16'],
    'yt-thumbnail': [1280, 720, '16:9'],
    'tw-post': [1200, 675, '16:9'],
    '4:5': [1080, 1350, '4:5'],
    '9:16': [1080, 1920, '9:16'],
  };
  for (const [fmt, [w, h, r]] of Object.entries(cases)) {
    const s = getFormatSpec(fmt);
    assert.equal(s.width, w, fmt);
    assert.equal(s.height, h, fmt);
    assert.equal(s.ratio, r, fmt);
  }
});

test('safe area de stories = 14% topo / 15% base', () => {
  const s = safeAreaPx(getFormatSpec('ig-stories'));
  assert.equal(s.top, 269);
  assert.equal(s.bottom, 288);
  assert.equal(safeAreaPx(getFormatSpec('ig-feed')).top, undefined);
});

test('providers recebem o aspect ratio certo (nunca 1:1 forcado)', () => {
  assert.equal(geminiAspectRatio(getFormatSpec('ig-feed')), '4:5');
  assert.equal(geminiAspectRatio(getFormatSpec('ig-stories')), '9:16');
  assert.equal(geminiAspectRatio(getFormatSpec('ig-feed-square')), '1:1');
  assert.equal(openRouterAspectRatio(getFormatSpec('yt-thumbnail')), '16:9');
  const feed = huggingFaceDimensions(getFormatSpec('ig-feed'));
  assert.equal(feed.width, 816);
  assert.equal(feed.height, 1024);
  const story = huggingFaceDimensions(getFormatSpec('ig-stories'));
  assert.equal(story.width, 576);
  assert.equal(story.height, 1024);
});

test('deteccao de nicho', () => {
  const cases: [string, string][] = [
    ['Pizzaria premium chegando em Petrolina', 'food'],
    ['Promoção de hambúrguer artesanal', 'food'],
    ['Clínica odontológica moderna', 'health'],
    ['Imobiliária de luxo em Recife', 'realestate'],
    ['Loja de moda feminina, nova coleção', 'fashion'],
    ['Empresa de energia solar', 'energy'],
    ['Tecnologia SaaS para gestão', 'tech'],
    ['Salão de beleza e barbearia', 'beauty'],
    ['Oficina mecânica e estética automotiva', 'automotive'],
    ['Escola bilíngue matrículas abertas', 'education'],
  ];
  for (const [brief, want] of cases) {
    assert.equal(detectNiche(brief, null), want, brief);
  }
});

test('modo automatico por nicho', () => {
  assert.equal(resolveCreativeMode('auto', 'food'), 'food');
  assert.equal(resolveCreativeMode('auto', 'health'), 'humanized');
  assert.equal(resolveCreativeMode('auto', 'realestate'), 'luxury');
  assert.equal(resolveCreativeMode('auto', 'tech'), 'minimal');
  assert.equal(resolveCreativeMode('pop', 'food'), 'pop', 'escolha manual vence auto');
  assert.equal(resolveCreativeMode('modo-inexistente', 'food'), 'food', 'invalido cai no auto do nicho');
});

test('nao forca fundo escuro e injeta regras de food', () => {
  const sys = buildCreativePlanSystemPrompt(baseInput);
  assert.match(sys, /never a default/i);
  assert.doesNotMatch(sys, /#0a0a0f|#1B1B1B/i);
  assert.match(sys, /food styling/i);
  assert.match(sys, /4:5/);
  assert.match(sys, /1080x1350/);
  assert.match(sys, /never invent a price/i);
});

test('diversidade: 10 seeds -> 10 prompts distintos', () => {
  const prompts = new Set<string>();
  for (let seed = 0; seed < 10; seed++) {
    prompts.add(buildCreativePlanSystemPrompt({ ...baseInput, variationSeed: seed }));
  }
  assert.equal(prompts.size, 10);
});

test('foto do usuario e logo', () => {
  const plan: CreativePlan = {
    objective: 'o', audience: 'a', concept: 'c', visualHook: 'v', primarySubject: 's',
    composition: 'comp', palette: 'pal', typographyMood: 'typo', lighting: 'light',
    camera: 'cam', environment: 'env', emotion: 'emo', headline: 'Chegou em Petrolina',
    cta: 'Peça já', negativeInstructions: 'nada',
  };
  const withPhoto = planToImagePrompt(plan, { ...baseInput, hasUserPhoto: true, bakeText: true });
  assert.match(withPhoto, /Generate NO human figure/i);
  assert.match(withPhoto, /35-45%/);
  assert.match(withPhoto, /Do not draw, letter or invent a logo/i);
  const noPhoto = planToImagePrompt(plan, { ...baseInput, hasUserPhoto: false, bakeText: true });
  assert.doesNotMatch(noPhoto, /Generate NO human figure/i);
  assert.match(noPhoto, /correct anatomy, natural hands/i);
});

test('bakeText controla se ha texto no prompt', () => {
  const plan: CreativePlan = {
    objective: 'o', audience: 'a', concept: 'c', visualHook: 'v', primarySubject: 's',
    composition: 'comp', palette: 'pal', typographyMood: 'typo', lighting: 'light',
    camera: 'cam', environment: 'env', emotion: 'emo', headline: 'Chegou em Petrolina',
    cta: 'Peça já', negativeInstructions: 'nada',
  };
  assert.match(planToImagePrompt(plan, { ...baseInput, bakeText: true }), /TEXT TO RENDER/);
  assert.match(planToImagePrompt(plan, { ...baseInput, bakeText: false }), /Render NO text/);
});

test('negative prompt sempre bloqueia texto e fundo escuro padrao', () => {
  const neg = buildNegativePrompt(null);
  assert.match(neg, /text/);
  assert.match(neg, /default dark gradient background/);
});

test('normalizacao entrega o canvas exato (cover-crop, sem distorcer)', async () => {
  const synth = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 85, b: 51 } } }).png().toBuffer();
  const cases: [number, number, string][] = [
    [1024, 1024, 'ig-feed'],
    [1024, 1792, 'ig-feed'],
    [1024, 1024, 'ig-stories'],
    [1792, 1024, 'ig-feed'],
    [816, 1024, 'ig-feed'],
    [1024, 1024, 'yt-thumbnail'],
  ];
  for (const [w, h, fmt] of cases) {
    const spec = getFormatSpec(fmt);
    const out = await normalizeToSpec(await synth(w, h), spec);
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.width, spec.width, `${w}x${h} -> ${fmt} width`);
    assert.equal(meta.height, spec.height, `${w}x${h} -> ${fmt} height`);
  }
});
