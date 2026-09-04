/**
 * Creative Engine — the art-direction brain, pure functions only (no I/O).
 *
 * Turns a plain brief ("promoção de pizza hoje") into a structured creative
 * plan and a production-grade image prompt, the way a creative director, art
 * director, copywriter and advertising photographer would together.
 *
 * Rules it enforces, because the previous 1-stage art director broke them:
 *   - "Premium" is never a synonym for a black background.
 *   - Templates are scaffolding, not a fixed style.
 *   - Nothing commercial (price, phone, address, date, discount) is invented.
 *   - Every brief gets a real concept, a niche-aware direction and variety.
 */

import { getFormatSpec, safeAreaPx, type FormatSpec } from './format-spec';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CreativeIntensity = 'conservative' | 'balanced' | 'bold' | 'experimental';

export type BrandContext = {
  name?: string | null;
  description?: string | null;
  voiceTone?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  products?: string[] | null;
  /** Per-company hard rules (e.g. "não usar forno a lenha", "nunca prometer cura"). */
  artDirection?: string | null;
  niche?: string | null;
  slogan?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  /** City — lets the plan draw on recognisable local context when it helps. */
  cidade?: string | null;
  /** Real photos of the brand sent to the model as references (after the logo). */
  referenceImages?: string[] | null;
};

export type CreativeInput = {
  topic: string;
  brand?: BrandContext | null;
  format?: string;
  headline?: string;
  points?: string[];
  platform?: string;
  creativeMode?: string;
  creativeIntensity?: CreativeIntensity;
  /** false (default): no baked text — it is overlaid later. true: text may render. */
  bakeText?: boolean;
  hasUserPhoto?: boolean;
  variationSeed?: number;
  /** True when the official logo is sent to the model as a reference image. */
  hasLogoReference?: boolean;
};

export type PhotoPlacement = {
  side: 'left' | 'right' | 'center';
  heightRatio: number;
  centerX: number;
  anchor: 'bottom' | 'center';
};

export const DEFAULT_PHOTO_PLACEMENT: PhotoPlacement = {
  side: 'right',
  heightRatio: 0.65,
  centerX: 0.72,
  anchor: 'bottom',
};

export function normalizePhotoPlacement(raw: unknown): PhotoPlacement {
  const value = (raw ?? {}) as Partial<PhotoPlacement>;
  const side: PhotoPlacement['side'] =
    value.side === 'left' || value.side === 'center' || value.side === 'right' ? value.side : DEFAULT_PHOTO_PLACEMENT.side;
  const clamp = (n: unknown, min: number, max: number, fallback: number) => {
    const num = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
    return Math.min(max, Math.max(min, num));
  };
  const defaultCenter = side === 'left' ? 0.28 : side === 'center' ? 0.5 : 0.72;
  return {
    side,
    heightRatio: clamp(value.heightRatio, 0.45, 0.9, DEFAULT_PHOTO_PLACEMENT.heightRatio),
    centerX: clamp(value.centerX, 0.15, 0.85, defaultCenter),
    anchor: value.anchor === 'center' ? 'center' : 'bottom',
  };
}

export type LogoPlacement = {
  position: 'top-center' | 'top-left' | 'top-right' | 'bottom-center' | 'bottom-left' | 'bottom-right';
  /** Logo width as a fraction of the canvas width (0.16–0.30). */
  widthRatio: number;
};

export const DEFAULT_LOGO_PLACEMENT: LogoPlacement = { position: 'top-center', widthRatio: 0.22 };

const LOGO_POSITIONS: LogoPlacement['position'][] = ['top-center', 'top-left', 'top-right', 'bottom-center', 'bottom-left', 'bottom-right'];

export function normalizeLogoPlacement(raw: unknown): LogoPlacement {
  const value = (raw ?? {}) as Partial<LogoPlacement>;
  const position = LOGO_POSITIONS.includes(value.position as LogoPlacement['position'])
    ? (value.position as LogoPlacement['position'])
    : DEFAULT_LOGO_PLACEMENT.position;
  const ratio = typeof value.widthRatio === 'number' && Number.isFinite(value.widthRatio) ? value.widthRatio : DEFAULT_LOGO_PLACEMENT.widthRatio;
  return { position, widthRatio: Math.min(0.3, Math.max(0.16, ratio)) };
}

export type CreativePlan = {
  objective: string;
  audience: string;
  concept: string;
  visualHook: string;
  primarySubject: string;
  composition: string;
  palette: string;
  typographyMood: string;
  lighting: string;
  camera: string;
  environment: string;
  emotion: string;
  headline: string;
  subheadline?: string;
  cta: string;
  negativeInstructions: string;
  niche?: string;
  mode?: string;
  photoPlacement?: PhotoPlacement;
  /** Where the real logo file is stamped after generation. */
  logoPlacement?: LogoPlacement;
};

// ─────────────────────────────────────────────────────────────────────────────
// Art-direction modes
// ─────────────────────────────────────────────────────────────────────────────

export const CREATIVE_MODES = [
  'auto', 'cinematic', 'editorial', 'food', 'pop', 'luxury', 'minimal',
  'vintage', 'humor', 'viral', '3d', 'product', 'humanized', 'constructive',
] as const;

export type CreativeMode = typeof CREATIVE_MODES[number];

const STYLE_LIBRARY: Record<string, string> = {
  auto:
    'Choose the strongest art direction for this specific objective. Premium does NOT mean dark. Select colour, photography, illustration, 3D, editorial, pop or cinematic language according to the concept, not according to habit.',
  cinematic:
    'Cinematic advertising photography. Dramatic but controlled light, authentic materials, photographic depth of field, sophisticated colour grading, anamorphic feel, premium campaign finish. A film still, not a poster.',
  editorial:
    'High-end editorial art direction. Magazine-grade typography, asymmetric composition, generous deliberate negative space, tactile materials, confident colour blocking, a strong grid quietly holding it together.',
  pop:
    'Vibrant premium pop advertising. Bold colour blocking, playful scale shifts, energetic diagonal composition, intelligent graphic devices, saturated but tasteful palette, polished commercial finish. Loud, never cheap.',
  food:
    'World-class food advertising photography and food styling. The product looks freshly prepared, appetising, textural, naturally imperfect and physically believable. Hero angle chosen for appetite appeal.',
  luxury:
    'Luxury minimalism. Restraint, exquisite materials, elegant negative space, controlled specular highlights, refined typography, premium packaging cues. Expensive because of what is left out.',
  minimal:
    'Radical minimalism. One idea, one subject, vast calm negative space, a restrained two-colour palette, precise typographic placement. Swiss poster discipline applied to social media.',
  vintage:
    'Contemporary reinterpretation of classic poster and print design. Tactile paper texture, bold retro-influenced typography, warm limited palette, authentic print artefacts — modern craft, never a dated pastiche.',
  humor:
    'Premium humorous advertising built on one clever visual idea that reads in under a second. Unexpected juxtaposition or scale, high commercial polish, warm and smart. Never childish, never a meme.',
  viral:
    'Scroll-stopping social-first creative. An immediate visual hook in the first 20% of the frame, high contrast, a curiosity gap, bold readable typography sized for a thumbnail, native energy without looking amateur.',
  '3d':
    'Premium 3D render art direction. Physically based materials, soft studio HDRI lighting, realistic contact shadows and subsurface scattering, clean geometry, tasteful depth of field. Octane/Redshift campaign quality.',
  product:
    'Studio product photography. The product is the hero: correct geometry, honest materials, controlled reflections, believable contact shadow, a set built around it, packaging text kept legible.',
  humanized:
    'Human-centred premium advertising. Authentic expression, natural posture and gesture, believable environment and wardrobe, real skin texture. Avoid generic corporate stock-photo language entirely.',
  constructive:
    'Information-rich but rigorously organised graphic advertising. Clear hierarchy, modular cards only where they earn their place, one consistent icon family, a single hero idea supported — never buried — by the data.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Intensity
// ─────────────────────────────────────────────────────────────────────────────

const INTENSITY_LIBRARY: Record<CreativeIntensity, string> = {
  conservative:
    'CREATIVE INTENSITY — CONSERVATIVE: Stay close to proven advertising conventions. Centred or classic rule-of-thirds composition, familiar palette, straightforward presentation, no visual risk.',
  balanced:
    'CREATIVE INTENSITY — BALANCED: One confident creative decision on top of a solid conventional structure. An interesting angle, an unexpected accent or a strong crop — message stays instantly legible.',
  bold:
    'CREATIVE INTENSITY — BOLD: Lead with the idea. Dramatic scale, unexpected cropping, striking colour, strong diagonal or negative-space composition, editorial confidence. Clarity kept, safety not.',
  experimental:
    'CREATIVE INTENSITY — EXPERIMENTAL: Award-show territory. Surreal juxtaposition, conceptual metaphor, extreme scale play, unconventional materials or perspective. The craft must be flawless and the brand unmistakable.',
};

export function intensityGuidance(intensity: CreativeIntensity = 'balanced'): string {
  return INTENSITY_LIBRARY[intensity] || INTENSITY_LIBRARY.balanced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Niche intelligence
// ─────────────────────────────────────────────────────────────────────────────

const NICHE_KEYWORDS: Record<string, string[]> = {
  food: ['pizza', 'pizzaria', 'hamburguer', 'hambúrguer', 'burger', 'lanche', 'restaurante', 'comida', 'gastronomia', 'delivery', 'açaí', 'acai', 'sorvete', 'padaria', 'confeitaria', 'bolo', 'doce', 'churrasco', 'espetinho', 'sushi', 'japonesa', 'marmita', 'cafeteria', 'café', 'cafe', 'bar', 'drink', 'cerveja', 'chopp', 'esfiha', 'pastel', 'salgado', 'food', 'menu', 'cardápio', 'cardapio'],
  beauty: ['salão', 'salao', 'cabelo', 'cabeleireiro', 'beleza', 'estética', 'estetica', 'manicure', 'unha', 'maquiagem', 'make', 'sobrancelha', 'cílios', 'cilios', 'barbearia', 'barber', 'spa', 'massagem', 'depilação', 'depilacao', 'skincare', 'cosmético', 'cosmetico', 'perfume'],
  realestate: ['imobiliária', 'imobiliaria', 'imóvel', 'imovel', 'apartamento', 'casa', 'terreno', 'lote', 'condomínio', 'condominio', 'aluguel', 'corretor', 'loteamento', 'construtora', 'empreendimento', 'cobertura', 'studio'],
  fashion: ['moda', 'roupa', 'boutique', 'vestido', 'calçado', 'calcado', 'sapato', 'tênis', 'tenis', 'bolsa', 'acessório', 'acessorio', 'coleção', 'colecao', 'look', 'outfit', 'jeans', 'lingerie', 'biquíni', 'biquini'],
  tech: ['tecnologia', 'software', 'saas', 'aplicativo', 'app', 'sistema', 'startup', 'digital', 'inteligência artificial', 'inteligencia artificial', 'automação', 'automacao', 'crm', 'erp', 'dashboard', 'plataforma', 'api', 'cloud', 'dados', 'programação', 'programacao'],
  health: ['clínica', 'clinica', 'médico', 'medico', 'dentista', 'odontológica', 'odontologica', 'odonto', 'saúde', 'saude', 'consultório', 'consultorio', 'exame', 'psicólogo', 'psicologo', 'terapia', 'fisioterapia', 'nutricionista', 'veterinário', 'veterinario', 'farmácia', 'farmacia', 'laboratório', 'laboratorio', 'hospital', 'vacina'],
  automotive: ['carro', 'veículo', 'veiculo', 'automotivo', 'oficina', 'mecânica', 'mecanica', 'concessionária', 'concessionaria', 'seminovo', 'pneu', 'funilaria', 'lava jato', 'moto', 'caminhão', 'caminhao', 'auto peças', 'auto pecas'],
  fitness: ['academia', 'fitness', 'treino', 'personal', 'musculação', 'musculacao', 'crossfit', 'pilates', 'yoga', 'corrida', 'esporte', 'atleta', 'suplemento', 'emagrecimento'],
  education: ['escola', 'colégio', 'colegio', 'curso', 'aula', 'professor', 'educação', 'educacao', 'matrícula', 'matricula', 'vestibular', 'faculdade', 'universidade', 'treinamento', 'workshop', 'mentoria', 'idiomas', 'inglês', 'ingles'],
  energy: ['energia solar', 'solar', 'fotovoltaic', 'painel solar', 'sustentável', 'sustentavel', 'energia renovável', 'energia renovavel'],
  services: ['advocacia', 'advogado', 'contabilidade', 'contador', 'consultoria', 'arquitetura', 'arquiteto', 'engenharia', 'engenheiro', 'seguro', 'financeira', 'crédito', 'credito', 'despachante', 'limpeza', 'dedetização', 'dedetizacao', 'reforma', 'pintura', 'marcenaria'],
  retail: ['loja', 'varejo', 'promoção', 'promocao', 'liquidação', 'liquidacao', 'desconto', 'black friday', 'atacado', 'distribuidora', 'mercado', 'supermercado', 'papelaria', 'pet shop', 'petshop'],
};

const NICHE_RULES: Record<string, string> = {
  food: `FOOD & BEVERAGE DIRECTION:\n- Real food photography standards: authentic texture, natural irregularity, honest colour.\n- Appetite-first hero angle — 45° or low hero for volume, straight-down only for spreads.\n- Believable gloss and moisture; steam only where physics allows it.\n- Fresh garnish placed as a stylist would: asymmetric, purposeful, never scattered.\n- 50mm or 85mm food photography, shallow depth of field, soft directional key with a bounce fill.\n- Never plastic, never over-rendered, never perfectly symmetric.`,
  beauty: `BEAUTY DIRECTION:\n- Real skin: visible pores, natural texture, honest undertone. No plastic smoothing.\n- Beauty lighting — soft frontal key with a subtle rim, catchlights correctly placed.\n- Hair and lashes rendered strand-level. Inclusive, natural expression.`,
  realestate: `REAL ESTATE & ARCHITECTURE DIRECTION:\n- Verticals stay vertical, perspective corrected as an architectural photographer would.\n- Natural light dominant — golden-hour exterior, bright diffused interior.\n- Honest materials: real stone, wood grain, glass reflections. 16-24mm interiors without fisheye.`,
  fashion: `FASHION DIRECTION:\n- Editorial fashion photography. Considered pose, real posture, natural hands.\n- Fabric behaves like fabric: drape, weight, weave. Styling coherent head to toe. 85mm/105mm.`,
  tech: `TECHNOLOGY DIRECTION:\n- Sophisticated credible interfaces — plausible layouts, legible type, no gibberish UI.\n- Cool premium light or clean bright studio; avoid the blue-neon-circuit cliché.\n- Minimal or futuristic composition with real depth.`,
  health: `HEALTH & CARE DIRECTION:\n- Human warmth plus clinical credibility. Clean, calm, contemporary.\n- Real practitioners and patients, natural interaction. Bright, even, trustworthy light.\n- No sensationalism, no fear appeal, no stock stethoscope poses.`,
  automotive: `AUTOMOTIVE DIRECTION:\n- Correct body-line reflections, believable paint depth. Dramatic directional light or golden hour.\n- Environment coherent with positioning. 35mm three-quarter hero or 85mm detail.`,
  fitness: `FITNESS DIRECTION:\n- Real athletic bodies, honest definition, visible effort. Dynamic frozen motion, sweat and texture.\n- High-energy directional light. Empowering rather than objectifying framing.`,
  education: `EDUCATION DIRECTION:\n- Genuine engagement — students and teachers actually doing something.\n- Bright optimistic natural light. Diverse, unposed-feeling groupings. Avoid clip-art academia.`,
  energy: `ENERGY & SUSTAINABILITY DIRECTION:\n- Real installations, correct panel geometry, realistic sky reflections. Bright daylight, clear sky.\n- Palette from sun, sky and landscape. Avoid generic globe-and-leaf iconography.`,
  services: `PROFESSIONAL SERVICES DIRECTION:\n- Credibility through craft: considered composition, restrained palette, excellent typography.\n- Real workspaces over handshake stock. Confident, calm, contemporary.`,
  retail: `RETAIL & PROMOTION DIRECTION:\n- Offer hierarchy immediate and unmissable, but never invent a price, discount or deadline.\n- Product presented honestly. Clean, bright, high-contrast; the eye lands on the offer in one second.`,
  general: `GENERAL DIRECTION:\n- Find the single most interesting truth in the brief and build the frame around it.\n- Choose photography, illustration or 3D by the idea, not by default.`,
};

const AUTO_MODE_BY_NICHE: Record<string, CreativeMode> = {
  food: 'food', beauty: 'editorial', realestate: 'luxury', fashion: 'editorial',
  tech: 'minimal', health: 'humanized', automotive: 'cinematic', fitness: 'cinematic',
  education: 'humanized', energy: 'cinematic', services: 'editorial', retail: 'pop', general: 'editorial',
};

export function detectNiche(text: string, brand?: BrandContext | null): string {
  const haystack = [text, brand?.niche, brand?.name, brand?.description, brand?.slogan, brand?.products?.join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let bestNiche = 'general';
  let bestScore = 0;
  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) if (haystack.includes(keyword)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestNiche = niche;
    }
  }
  return bestNiche;
}

export function nicheRules(niche: string): string {
  return NICHE_RULES[niche] || NICHE_RULES.general;
}

export function resolveCreativeMode(mode: string | undefined, niche: string): CreativeMode {
  const requested = (mode || 'auto').toLowerCase();
  if (requested !== 'auto' && requested in STYLE_LIBRARY) return requested as CreativeMode;
  return AUTO_MODE_BY_NICHE[niche] || 'editorial';
}

export function styleDirective(mode: string): string {
  return STYLE_LIBRARY[mode] || STYLE_LIBRARY.auto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette + diversity
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE_FAMILIES = [
  'warm cream and terracotta with a deep accent',
  'bright coral and off-white with a saturated support tone',
  'deep saturated red with warm neutrals',
  'fresh green and natural wood tones on light ground',
  'sunlit yellow and clean white with a grounding dark accent',
  'confident blue and crisp white with a warm highlight',
  'burnt orange and soft sand',
  'earthy terracotta, clay and olive',
  'clean high-key white with two strong accent colours',
  'rich plum and blush with metallic restraint',
  'pastel palette with one high-saturation focal colour',
  'vivid high-contrast pop palette',
  'monochrome with a single vivid accent',
  'dark cinematic palette with warm practicals',
];

const COMPOSITION_VARIANTS = [
  'subject hard left, headline occupying the right two-thirds',
  'centred hero with symmetrical breathing room',
  'extreme close-up crop with the headline overlaid on a calm area',
  'diagonal composition running from lower left to upper right',
  'subject low in the frame with a dominant sky or ground plane above',
  'rule-of-thirds placement with deep layered background',
  'flat-lay top-down arrangement with generous margins',
  'wide environmental shot with the subject small but unmistakable',
  'split frame: product on one side, typography block on the other',
  'subject breaking out of a graphic shape or frame',
];

const CAMERA_VARIANTS = [
  '35mm environmental, eye level',
  '50mm natural perspective, slightly low angle',
  '85mm compression, shallow depth of field',
  '24mm wide with controlled distortion, low hero angle',
  '100mm macro detail',
  'top-down 50mm flat lay',
  '85mm portrait with strong background separation',
];

const LIGHT_VARIANTS = [
  'soft directional window light with a gentle bounce fill',
  'hard sunlight with crisp defined shadows',
  'golden hour backlight with warm rim separation',
  'clean high-key studio light, near shadowless',
  'dramatic single-source key with deep controlled falloff',
  'overcast diffused daylight, even and honest',
  'warm practical lights inside a cool ambient scene',
];

function seedOf(input: CreativeInput): number {
  return input.variationSeed ?? Math.floor(Math.random() * 100000);
}

export function paletteGuidance(input: CreativeInput): string {
  const family = PALETTE_FAMILIES[seedOf(input) % PALETTE_FAMILIES.length];
  const primary = input.brand?.primaryColor || '#2563EB';
  const secondary = input.brand?.secondaryColor || '#1E40AF';
  return `PALETTE DIRECTION:\n- Brand anchors: ${primary} (primary) and ${secondary} (support). Treat them as anchors, not a cage — extend the palette when the concept is better for it.\n- Suggested direction for this piece: ${family}. Override only if the concept demands something stronger.\n- A dark or black background is a deliberate creative choice, never a default and never a shortcut to looking "premium".\n- Whatever the ground tone, hold high contrast and full legibility on a phone screen.`;
}

export function diversityGuidance(input: CreativeInput): string {
  const seed = seedOf(input);
  return `VARIATION DIRECTIVE (this generation must not look like the previous ones):\n- Composition to explore: ${COMPOSITION_VARIANTS[seed % COMPOSITION_VARIANTS.length]}\n- Camera to explore: ${CAMERA_VARIANTS[(seed >> 2) % CAMERA_VARIANTS.length]}\n- Light to explore: ${LIGHT_VARIANTS[(seed >> 4) % LIGHT_VARIANTS.length]}\nDepart from these only for a stronger idea — never to return to a generic centred layout.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared rule blocks
// ─────────────────────────────────────────────────────────────────────────────

const REALISM_ENFORCEMENT = `PHOTOREALISM (non-negotiable when the piece is photographic):
- This must look like a real photograph shot by a professional advertising crew, NOT an AI render or a 3D illustration.
- Full-frame DSLR/mirrorless aesthetic, real optics, real depth of field, real film-like grain.
- Absolutely avoid: plastic or waxy surfaces, over-smooth CGI look, over-HDR glow, fake specular highlights, repeated/duplicated ingredients, floating objects, warped anatomy, extra fingers, impossible perspective — every tell of AI generation.
- Real human skin with pores and micro-imperfection; real food with natural irregularity.`;

const FOOD_HERO_ENFORCEMENT = `FOOD HERO (when food is present):
- The food is the desire object: render it large, fresh and irresistible, styled by a real food stylist.
- For pizza: authentic Neapolitan-style crust with natural leopard-spotting and airy bubbles, real melted mozzarella with believable cheese pull and gravity, vibrant red sauce with natural sheen, fresh basil and real toppings with natural imperfection, thin believable steam, warm side light, shallow depth of field.
- If a pizza box appears, use a modern premium octagonal (eight-sided) box — never a plain rectangular one.
- Never show a wood-fired oven, firewood or rustic stove. Kitchens, when shown, are modern and professional.
- No plastic food, no frozen/cold look, no fake cheese, no duplicated slices.`;

/**
 * Device screens are where diffusion models produce garbled micro-text. Keep
 * any phone/app UI suggested with blocks, icons and at most one short label.
 */
const DEVICE_SCREEN_RULE = `DEVICE SCREENS: If a phone, tablet or app interface appears, keep the on-screen UI simple and suggested — colour blocks, a few clean icons, and AT MOST ONE short label, in Brazilian Portuguese, taken from the brief. Absolutely NO numbers, prices, currency symbols, balances, English words, menus, lists or paragraphs inside a screen — small in-screen text always garbles and invented figures become false claims. The screen should read as a polished app at a glance, not a readable document.`;

const PHOTOGRAPHY_STANDARD = `PHOTOGRAPHY STANDARD:\n- Full-frame commercial realism whenever photographic.\n- Lens chosen on purpose: 35mm environmental, 50mm natural hero, 85mm premium compression, macro only when justified.\n- Physically coherent key, fill, rim and practical lights. Realistic contact shadows and reflections.\n- Layered depth: foreground, subject, background. Natural microtexture; no plastic skin, no synthetic food.\n- Cinematic grading without crushed blacks or blown highlights.`;

const TYPOGRAPHY_STANDARD = `TYPOGRAPHY & COPY PLANNING:\n- Headline ideally 2 to 7 words. Never break a word awkwardly.\n- Maximum two type families; three sizes is usually enough. High contrast, sized for a phone at arm's length.\n- Typography is designed hierarchy, not scattered labels. No paragraphs inside the image.`;

const TRUTH_RULES = `FACTUAL INTEGRITY (absolute):\n- Never invent a price, discount, percentage, cashback, gift, "free", "on us" / "por nossa conta", loyalty programme, date, deadline, phone number, address, website or any commercial claim or promise.\n- Use only the facts supplied in the brief and brand context. If a fact is absent, design without it.\n- Never fabricate awards, ratings, certifications or testimonials.\n- A headline or CTA that promises something the brief did not state is a rejected piece, however beautiful.`;

const BRIEF_FIDELITY = `BRIEF FIDELITY (outranks your creativity):\n- Everything the client states EXPLICITLY is mandatory and verbatim: exact headline, support text, CTA, scene, people, objects, micro-elements, format. You do not "improve" it — you execute it with excellence.\n- Your creative freedom applies ONLY to what the brief leaves open (light, camera, palette details, styling, composition within the requested scene).\n- If the brief dictates text ("escreva exatamente", "HEADLINE:", "TEXTO OBRIGATÓRIO", quoted copy), copy it character by character into the corresponding JSON fields. Do not paraphrase, do not translate, do not add words.\n- If the brief describes a scene (e.g. a person on a sofa ordering on the app), that scene IS the concept. Do not replace it with a product-only hero.\n- Only when the brief is a short idea with no explicit copy or scene do you invent headline, scene and concept.`;

const NEGATIVE_STANDARD = 'NEGATIVE CONSTRAINTS: no Canva-template look, no stock-photo cliché, no cheap bevels or drop shadows, no WordArt, no gibberish or misspelled text, no watermarks, no malformed hands or extra fingers, no duplicated objects, no fabricated logos, no clutter, no purposeless floating particles, no excessive HDR, no oversaturation, no crushed shadows, no plastic food, no anatomy errors, no inconsistent perspective, no multiple competing focal points, no default dark gradient background.';

export function brandConstraints(brand?: BrandContext | null): string {
  if (!brand) return '';
  const lines: string[] = [];
  const push = (label: string, value?: string | null) => {
    if (value && String(value).trim()) lines.push(`- ${label}: ${String(value).trim().slice(0, 400)}`);
  };
  push('Slogan (use verbatim or not at all)', brand.slogan);
  push('MANDATORY per-brand art rules', brand.artDirection);
  push('Real phone (only usable value — never invent another)', brand.phone);
  push('Real address (only usable value — never invent another)', brand.address);
  push('Website', brand.website);
  push('Tone of voice', brand.voiceTone);
  if (brand.products && brand.products.length) lines.push(`- Products: ${brand.products.slice(0, 6).join(', ')}`);
  if (!lines.length) return '';
  return `\nBRAND CONSTRAINTS (these outrank art direction):\n${lines.join('\n')}`;
}

function photoRule(hasUserPhoto: boolean | undefined, placement?: PhotoPlacement): string {
  if (!hasUserPhoto) {
    return 'PEOPLE: Include people only when they strengthen the idea. When present they must have correct anatomy, natural hands, real skin texture, spontaneous expression and lighting consistent with the scene.';
  }
  const side = placement?.side ?? DEFAULT_PHOTO_PLACEMENT.side;
  const where = side === 'center' ? 'centre' : side;
  const heightPct = Math.round((placement?.heightRatio ?? DEFAULT_PHOTO_PLACEMENT.heightRatio) * 100);
  return `REAL PHOTO COMPOSITE: A real photograph of a real person will be composited into this design after generation. Generate NO human figure, face, body or silhouette. Reserve a clean, uncluttered area on the ${where}, roughly 35-45% of the width and ${heightPct}% of the height, filled with a simple tone or soft gradient so a cut-out subject reads cleanly. Arrange every other element so the layout already looks finished — the reserved area must read as intentional negative space, not a hole.`;
}

/**
 * When the official logo is provided to the model as a reference image, tell it
 * to reproduce that exact mark. Otherwise fall back to reserving a clean area so
 * the real logo can be composited later — and forbid inventing one.
 */
function logoRule(brandName?: string | null, hasLogoReference?: boolean, placement?: LogoPlacement): string {
  const name = brandName || 'the brand';
  if (hasLogoReference) {
    const p = placement ?? DEFAULT_LOGO_PLACEMENT;
    const where = p.position.replace('-', ' ');
    const pct = Math.round(p.widthRatio * 100);
    const band = p.position.startsWith('top') ? 'top' : 'bottom';
    const bandPct = Math.round(p.widthRatio * 100) + 8;
    return `BRAND & LOGO — RESERVED AREA (critical):
The system stamps the REAL ${name} logo file onto the finished image afterwards, at the ${where}, about ${pct}% of the width. Therefore:
- DO NOT draw, paint, letter or illustrate any logo, emblem, badge, monogram, icon-plus-name lock-up or brand word-mark anywhere in the layout — not even a placeholder. A drawn logo becomes a DUPLICATE beside the real one and ruins the piece.
- DO NOT write the brand name as text — not as a title, not as a small signature, not as a caption, not in a corner, not on a strip. Zero occurrences.
- THE BRAND APPEARS EXACTLY ONCE in the finished piece: the stamped logo. If you render the name or a mark anywhere, the piece has the brand twice and is rejected.
- Leave the ${band} band of the canvas (roughly the ${band} ${bandPct}% of the height, full width) as CLEAN EMPTY SPACE: flat colour, soft gradient or gently out-of-focus background only. No text, no graphics, no product edges intruding.
- Compose as if the logo were already sitting in that band, and keep headline, support line and CTA well clear of it.
- The logo MAY appear only where it physically exists in the scene — printed on real packaging or signage from the reference photos — reproduced faithfully there.`;
  }
  return `BRAND & LOGO: Do not draw, letter or invent a logo, and do not write the brand name as text — the real ${name} logo is composited afterwards as an official asset. Reserve a clean, low-contrast, unobstructed logo area (~20% of the width) in one corner, free of texture, text and busy detail.`;
}

/**
 * Real photos of the brand (storefront, packaging, products) come after the
 * logo in the reference list. Tell the model what they are and to reproduce
 * them, not to reinterpret them.
 */
function referenceAssetsRule(brand?: BrandContext | null): string {
  const count = brand?.referenceImages?.length || 0;
  if (!count) return '';
  return `\n\nREAL BRAND REFERENCES: reference images 2 to ${count + 1} are REAL photographs of this brand (its storefront, its packaging, its products). When the piece shows a shop front, a pizza box, a package or a product, reproduce the one in the references — same colours, materials, shape, signage and details. Do not invent a generic substitute. You may photograph them from a new angle or in new light, but they must be recognisably the same real objects.`;
}

/** Local flavour — used only when the plan judges it strengthens the piece. */
function localContextRule(brand?: BrandContext | null): string {
  const city = brand?.cidade?.trim();
  if (!city) return '';
  return `\n\nLOCAL CONTEXT: the brand is in ${city}. When it strengthens the concept (launches, "we have arrived", community, pride), you may reference the city subtly and authentically — a recognisable landmark in soft focus, the local light, the regional atmosphere. Only real, recognisable references; never invent a landmark. Never let the city upstage the product.`;
}

function textToRender(input: CreativeInput, plan?: CreativePlan): string {
  if (!input.bakeText) {
    return "TEXT: Render NO text, letters, numbers or logo in the image — copy is overlaid later. Leave clean negative space where the headline and CTA will go.";
  }
  const headline = plan?.headline || input.headline || '';
  const sub = plan?.subheadline;
  const cta = plan?.cta;
  const lines = [`- Headline: "${headline}"`];
  if (sub) lines.push(`- Support line: "${sub}"`);
  if (cta) lines.push(`- Call to action: "${cta}"`);
  return `TEXT TO RENDER — EXHAUSTIVE LIST (Brazilian Portuguese, exact, perfectly spelled):
${lines.join('\n')}

THIS LIST IS CLOSED. Render these strings and NOTHING else:
- No extra tagline, slogan, kicker, badge, sticker, date, city line or closing phrase. Adding even one unrequested phrase is a defect that fails the piece.
- Do NOT write the brand name as text or as a word-mark anywhere. The brand is represented only by its real logo, which the system stamps in afterwards.
- No invented words, no lorem ipsum, no decorative pseudo-text, no small print.
- Text must never overlap other text, and never intrude into the reserved logo area.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — creative plan (structured JSON brief)
// ─────────────────────────────────────────────────────────────────────────────

export function buildCreativePlanSystemPrompt(input: CreativeInput): string {
  const spec = getFormatSpec(input.format);
  const safe = safeAreaPx(spec);
  const niche = detectNiche(input.topic, input.brand);
  const mode = resolveCreativeMode(input.creativeMode, niche);

  return `You are the creative department of a top-tier advertising agency, working as one mind: creative director, art director, copywriter, advertising photographer and brand designer. Turn a plain client brief into a real campaign concept — the kind that wins the pitch.

OUTPUT: a single JSON object. No prose, no markdown fence, no commentary.

{
  "objective": "the commercial job this piece has to do, one sentence",
  "audience": "who this speaks to and what they care about",
  "concept": "the central creative idea in 1-2 sentences — the thought, not the layout",
  "visualHook": "the one thing that stops the scroll, concretely",
  "primarySubject": "exactly what is in frame and how it is treated",
  "composition": "framing, placement, hierarchy, negative space, where the eye travels",
  "palette": "specific colours and how they are distributed",
  "typographyMood": "type personality, weight, scale relationships, placement",
  "lighting": "light setup as a photographer would specify it",
  "camera": "lens, angle, distance, depth of field",
  "environment": "setting, surfaces, props, atmosphere",
  "emotion": "what the viewer should feel in the first second",
  "headline": "final Brazilian Portuguese headline, 2-7 words",
  "subheadline": "optional short support line in Brazilian Portuguese, or empty string",
  "cta": "short Brazilian Portuguese call to action, or empty string",
  "negativeInstructions": "what must not appear, specific to this concept"${input.hasUserPhoto ? ',\n  "photoPlacement": { "side": "left"|"right"|"center", "heightRatio": 0.45-0.9, "centerX": 0.15-0.85, "anchor": "bottom"|"center" }' : ''}${input.hasLogoReference ? ',\n  "logoPlacement": { "position": "top-center"|"top-left"|"top-right"|"bottom-center"|"bottom-left"|"bottom-right", "widthRatio": 0.16-0.30 }' : ''}
}

ART DIRECTION MODE — ${mode}:\n${styleDirective(mode)}
${input.hasLogoReference ? `
LOGO PLACEMENT: the official logo FILE will be stamped onto the finished image by the system (pixel-perfect). Decide where it belongs for THIS composition and how large (16-30% of the width). Plan the layout so that area stays clean — the image model must NOT draw a standalone logo there.` : ''}

${intensityGuidance(input.creativeIntensity)}

${nicheRules(niche)}

${paletteGuidance(input)}

${diversityGuidance(input)}

CANVAS: ${spec.label}, aspect ratio ${spec.ratio}. Plan natively for this shape — never plan a square and crop it.${safe.top ? ` Stories safe area: keep critical text and logo at least ${safe.top}px from top and ${safe.bottom}px from bottom.` : ''}

${TRUTH_RULES}

${BRIEF_FIDELITY}
${referenceAssetsRule(input.brand)}${localContextRule(input.brand)}

HEADLINE RULES: If the brief dictates the headline, use it verbatim. Otherwise write one in Brazilian Portuguese, perfect spelling, 2-7 words, specific to this concept — a headline that would fit any brand has failed. Never a headline that promises an offer the brief did not state.

Return only the JSON object.`;
}

export function buildCreativePlanUserPrompt(input: CreativeInput): string {
  const spec = getFormatSpec(input.format);
  const brand = input.brand;
  const brandBlock = brand
    ? [
        brand.name ? `- Marca: ${brand.name}` : '',
        brand.description ? `- Sobre: ${brand.description}` : '',
        brand.voiceTone ? `- Tom: ${brand.voiceTone}` : '',
        brand.products?.length ? `- Produtos: ${brand.products.slice(0, 6).join(', ')}` : '',
        brand.artDirection ? `- Regras de arte obrigatórias: ${brand.artDirection}` : '',
        `- Cores: ${brand.primaryColor || '-'}, ${brand.secondaryColor || '-'}`,
      ].filter(Boolean).join('\n')
    : 'not provided';

  return `CLIENT BRIEF: ${input.topic.slice(0, 1800)}
BRAND (facts you may use — and the only facts you may use):
${brandBlock}
HEADLINE FIELD: ${input.headline || '(none — if the brief above dictates copy, that copy is mandatory and verbatim; if it does not, write one)'}
SUPPORT POINTS: ${(input.points || []).slice(0, 4).join(' | ') || 'none'}
PLATFORM: ${input.platform || 'instagram'}
CANVAS: ${spec.label} (${spec.ratio})
${input.hasUserPhoto ? 'A real user photograph will be composited later — plan around a reserved area and put no invented person in it.' : ''}

Give me one concept a real agency would present. Return the JSON only.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — render the plan (or a fallback) into the final image prompt
// ─────────────────────────────────────────────────────────────────────────────

export function planToImagePrompt(plan: CreativePlan, input: CreativeInput): string {
  const spec = getFormatSpec(input.format);
  const safe = safeAreaPx(spec);
  const niche = plan.niche || detectNiche(input.topic, input.brand);
  const mode = plan.mode || resolveCreativeMode(input.creativeMode, niche);

  return `Premium advertising campaign image, ${spec.label}, aspect ratio ${spec.ratio}. Composed natively for this canvas.

CONCEPT: ${plan.concept}
VISUAL HOOK: ${plan.visualHook}
SUBJECT: ${plan.primarySubject}
COMPOSITION: ${plan.composition}
ENVIRONMENT: ${plan.environment}
LIGHTING: ${plan.lighting}
CAMERA: ${plan.camera}
PALETTE: ${plan.palette}
TYPOGRAPHY: ${plan.typographyMood}
EMOTION: ${plan.emotion}

ART DIRECTION — ${mode}:\n${styleDirective(mode)}

${nicheRules(niche)}

${REALISM_ENFORCEMENT}

${niche === 'food' ? FOOD_HERO_ENFORCEMENT + '\n\n' : ''}${PHOTOGRAPHY_STANDARD}

${DEVICE_SCREEN_RULE}

${TYPOGRAPHY_STANDARD}

${textToRender(input, plan)}

${photoRule(input.hasUserPhoto, plan.photoPlacement)}

${logoRule(input.brand?.name, input.hasLogoReference, plan.logoPlacement)}${referenceAssetsRule(input.brand)}${localContextRule(input.brand)}${safe.top ? `\n\nSAFE AREA: keep all critical text and the logo at least ${safe.top}px from the top and ${safe.bottom}px from the bottom.` : ''}

${TRUTH_RULES}
${brandConstraints(input.brand)}

${NEGATIVE_STANDARD}
Concept-specific exclusions: ${plan.negativeInstructions}`;
}

export function buildFallbackImagePrompt(input: CreativeInput): string {
  const spec = getFormatSpec(input.format);
  const safe = safeAreaPx(spec);
  const niche = detectNiche(input.topic, input.brand);
  const mode = resolveCreativeMode(input.creativeMode, niche);

  return `Premium advertising campaign image, ${spec.label}, aspect ratio ${spec.ratio}, composed natively for this canvas.

BRIEF: ${input.topic.slice(0, 900)}
${(input.points || []).slice(0, 3).map((p) => `- ${p.slice(0, 120)}`).join('\n')}

ART DIRECTION — ${mode}:\n${styleDirective(mode)}

${nicheRules(niche)}

${paletteGuidance(input)}

${diversityGuidance(input)}

${intensityGuidance(input.creativeIntensity)}

${REALISM_ENFORCEMENT}

${niche === 'food' ? FOOD_HERO_ENFORCEMENT + '\n\n' : ''}${PHOTOGRAPHY_STANDARD}

${DEVICE_SCREEN_RULE}

${TYPOGRAPHY_STANDARD}

${textToRender(input)}

${photoRule(input.hasUserPhoto)}

${logoRule(input.brand?.name, input.hasLogoReference)}${referenceAssetsRule(input.brand)}${localContextRule(input.brand)}${safe.top ? `\n\nSAFE AREA: keep critical text and the logo at least ${safe.top}px from the top and ${safe.bottom}px from the bottom.` : ''}

${TRUTH_RULES}
${brandConstraints(input.brand)}

${NEGATIVE_STANDARD}`;
}

/** Concept-negative for providers that take a separate negative prompt. */
export function buildNegativePrompt(plan?: CreativePlan | null): string {
  const base = 'duplicate logo, second logo, repeated logo, drawn brand logo, brand name as text, word-mark, overlapping text, text over logo, extra tagline, unrequested slogan, text, letters, words, numbers, watermark, logo, signature, low quality, blurry, out of focus, pixelated, jpeg artifacts, deformed, ugly, extra fingers, mutated hands, poorly drawn, amateur, generic stock photo, canva template, clipart, oversaturated, harsh flash, cluttered, busy layout, messy composition, plastic food, default dark gradient background';
  const extra = plan?.negativeInstructions?.trim();
  return extra ? `${extra}, ${base}` : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Three concepts (Creative Director mode)
// ─────────────────────────────────────────────────────────────────────────────

export function conceptModeTriplet(niche: string): [CreativeMode, CreativeMode, CreativeMode] {
  const primary = AUTO_MODE_BY_NICHE[niche] || 'editorial';
  const alternatives: CreativeMode[] = ['cinematic', 'editorial', 'pop', 'minimal', 'luxury', 'humor', '3d'];
  const rest = alternatives.filter((m) => m !== primary);
  return [primary, rest[0], rest[1]];
}

export function buildConceptSetSystemPrompt(input: CreativeInput): string {
  const niche = detectNiche(input.topic, input.brand);
  const [a, b, c] = conceptModeTriplet(niche);
  const spec = getFormatSpec(input.format);
  return `You are the creative department of a top-tier agency presenting three genuinely different routes for the same brief.

OUTPUT: a JSON array of exactly three objects, nothing else.

[
  { "id": "A", "mode": "${a}", "title": "short route name in Brazilian Portuguese", "concept": "the idea in 1-2 sentences", "visualHook": "what stops the scroll", "headline": "2-7 words, Brazilian Portuguese", "palette": "specific colours", "whyItWorks": "one sentence in Brazilian Portuguese for the client" },
  { "id": "B", "mode": "${b}", ... },
  { "id": "C", "mode": "${c}", ... }
]

THE THREE ROUTES MUST BE GENUINELY DIFFERENT — different idea, palette, composition, emotional register. Three variations of one layout is a failure.

Route A — ${a}: ${styleDirective(a)}
Route B — ${b}: ${styleDirective(b)}
Route C — ${c}: ${styleDirective(c)}

${nicheRules(niche)}

CANVAS: ${spec.label} (${spec.ratio}).

${TRUTH_RULES}

${BRIEF_FIDELITY}
When the brief dictates copy or a scene, all three routes keep that copy verbatim and that scene — they differ in art direction, not in what the client asked for.

At least two of the three routes must use a light, bright or colourful ground. Never present three dark routes. Return only the JSON array.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// QA
// ─────────────────────────────────────────────────────────────────────────────

export type QAIssue = { severity: 'critical' | 'major' | 'minor'; check: string; detail: string };
export type QAReport = { passed: boolean; score: number; issues: QAIssue[]; summary: string };

export function buildQASystemPrompt(input: CreativeInput, plan: CreativePlan | null): string {
  const spec = getFormatSpec(input.format);
  const safe = safeAreaPx(spec);
  const headline = plan?.headline || input.headline || '';
  return `You are a demanding art director reviewing a generated campaign image before it reaches the client. You are looking for reasons to reject it.

OUTPUT: a single JSON object, no prose.
{ "passed": boolean, "score": 0-100, "issues": [ { "severity": "critical"|"major"|"minor", "check": "short name", "detail": "what is wrong, concretely" } ], "summary": "one sentence in Brazilian Portuguese" }

CHECKLIST:
1. Text spelling in Brazilian Portuguese; any gibberish/broken/duplicated letters? (critical)${input.bakeText ? `\n2. Is the headline exactly "${headline}"? Invented extra text? (critical)` : '\n2. Any text at all? There must be none — text is overlaid later. (major)'}
3. Invented facts: price, %, date, phone, address or claim not in the brief? (critical)
4. Anatomy: hands, fingers, eyes, limbs malformed? (critical)
5. A standalone drawn or lettered brand logo / brand-name lock-up in the layout? The real logo file is stamped afterwards, so a drawn one (other than printed on real packaging or signage) is a duplicate or a fake. (critical)
6. Is the reserved logo area clean and unobstructed? (major)
${input.hasUserPhoto ? '7. ~35-45% width clean and free of any generated person, ready for a real photo composite? (critical)' : '7. People, if present: real skin texture, natural expression, no plastic rendering? (major)'}
8. Legibility of any text against its background at phone size. (major)
9. One clear focal point and obvious reading order. (major)
10. Clutter / purposeless floating shapes. (major)
11. Dark background without the concept justifying it. (major)
12. Reads as a Canva template or generic stock rather than an agency campaign. (major)
13. Product fidelity — food appetising and real, product geometry correct. (major)
14. Cheap bevels, harsh shadows, banding, oversaturation, crushed blacks. (minor)
15. Composition reads as designed for ${spec.ratio}, not a stretched or cropped square. (major)${safe.top ? `\n16. Critical content clear of top ${Math.round((spec.safeTopPct || 0) * 100)}% and bottom ${Math.round((spec.safeBottomPct || 0) * 100)}%. (major)` : ''}

SCORING: start at 100, minus 25 per critical, 10 per major, 3 per minor. "passed" is true only with zero critical and score >= 70. Be specific.`;
}

export function buildRetryGuidance(report: QAReport): string {
  const blocking = report.issues.filter((i) => i.severity === 'critical' || i.severity === 'major');
  if (!blocking.length) return '';
  return `\n\nPREVIOUS ATTEMPT WAS REJECTED. Fix these specific problems and change the approach accordingly:\n${blocking.map((i) => `- [${i.severity}] ${i.check}: ${i.detail}`).join('\n')}\nDo not repeat the previous composition.`;
}
