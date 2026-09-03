import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { opcoes } from '../services/niche.service';
import {
  createBrand,
  listBrands,
  getBrand,
  getDefaultBrand,
  updateBrand,
  setDefaultBrand,
  deleteBrand,
} from '../controllers/brand.controller';

const router = Router();

// Accept hex (#RRGGBB), null, or empty string (treated as null)
const hexColorOptional = z
  .union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

// Accept any short string, null, or empty string
const optionalString = (max: number) =>
  z
    .union([z.string().max(max), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

// Accept URL, null, or empty string
const optionalUrl = z
  .union([z.string().url(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

const createBrandSchema = z.object({
  name: z.string().min(1).max(100),
  logoUrl: optionalUrl,
  primaryColor: hexColorOptional,
  secondaryColor: hexColorOptional,
  accentColor: hexColorOptional,
  backgroundColor: hexColorOptional,
  textColor: hexColorOptional,
  mutedColor: hexColorOptional,
  fontFamily: optionalString(100),
  headingFont: optionalString(100),
  bodyFont: optionalString(100),
  description: optionalString(10000),
  slogan: optionalString(120),
  // Up to 6 real photos (storefront, packaging, products) used as image references.
  referenceImages: z.array(z.string().url()).max(6).optional(),
  voiceTone: optionalString(1000),
  websiteUrl: optionalUrl,
  instagramUrl: optionalUrl,
  phone: optionalString(50),
  artDirection: optionalString(2000),
  products: z.array(z.string()).optional(),
  defaultHashtags: z.array(z.string()).optional(),
  defaultPlatforms: z.array(z.string()).optional(),
  tonePrompt: optionalString(2000),
  stylePrompt: optionalString(2000),
  isDefault: z.boolean().optional(),
  // --- Venda e atribuicao ---
  // A chave PIX aceita qualquer formato (CPF, e-mail, telefone, aleatoria):
  // validar o formato aqui recusaria chaves validas que ainda nao previmos.
  // 77 e o limite que mantem o campo 26 do BR Code dentro dos 99 do EMV
  // (22 do GUI + 77). Aceitar mais gerava um codigo que o banco recusa.
  pixKey: optionalString(77),
  pixCity: optionalString(60),
  whatsappPhone: optionalString(30),
  cidade: optionalString(80),
  // Ramo da empresa. Decide termos de elogio, chamadas, contexto da IA e
  // se o gatilho de clima existe (ver niche.service.ts).
  nicho: optionalString(30),
  // Valores em CENTAVOS: reais em ponto flutuante nao fecham na soma.
  feeCentavos: z.number().int().min(0).nullable().optional(),
  cpmCentavos: z.number().int().min(1).optional(),
  // Pilares que o piloto automatico pode publicar sem aprovacao.
  autoPublicarPilares: z.array(z.string()).optional(),
});

const updateBrandSchema = createBrandSchema.partial();

router.use(authMiddleware);

/** GET /api/brands/nichos — as opcoes do seletor de ramo. */
router.get('/nichos', (_req, res) => {
  res.json({ success: true, data: { items: opcoes() } });
});

router.post('/', validate(createBrandSchema), createBrand);
router.get('/', listBrands);
router.get('/default', getDefaultBrand);
router.get('/:id', getBrand);
router.put('/:id', validate(updateBrandSchema), updateBrand);
router.put('/:id/default', setDefaultBrand);
router.delete('/:id', deleteBrand);

export default router;
