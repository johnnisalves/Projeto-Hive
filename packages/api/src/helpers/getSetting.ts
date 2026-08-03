import { prisma } from '../config/database';
import { env } from '../config/env';

const ENV_MAP: Record<string, () => string | undefined> = {
  NANO_BANANA_API_KEY: () => env.NANO_BANANA_API_KEY,
  NANO_BANANA_PROVIDER: () => env.NANO_BANANA_PROVIDER,
  OPENROUTER_API_KEY: () => env.OPENROUTER_API_KEY,
  OPENROUTER_IMAGE_MODEL: () => env.OPENROUTER_IMAGE_MODEL,
  OPENROUTER_TEXT_MODEL: () => env.OPENROUTER_TEXT_MODEL,
  INSTAGRAM_ACCESS_TOKEN: () => env.INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_USER_ID: () => env.INSTAGRAM_USER_ID,
  TELEGRAM_BOT_TOKEN: () => env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_ALLOWED_CHAT_IDS: () => env.TELEGRAM_ALLOWED_CHAT_IDS,
  FACEBOOK_APP_ID: () => env.FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: () => env.FACEBOOK_APP_SECRET,
  MCP_AUTH_TOKEN: () => env.MCP_AUTH_TOKEN,
  INTERNAL_SERVICE_TOKEN: () => env.INTERNAL_SERVICE_TOKEN,
  CLOUDINARY_CLOUD_NAME: () => env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: () => env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: () => env.CLOUDINARY_API_SECRET,
};

/**
 * Pode ler a configuracao do banco sem saber de quem ela e?
 *
 * O HISTORICO: aqui havia um `findFirst` por chave ordenado por createdAt —
 * "a configuracao do dono mais ANTIGO". Numa instalacao com varias
 * agencias, a chave de IA da primeira que se cadastrou atendia todas: ela
 * pagava a conta de todo mundo.
 *
 * A CORRECAO ANTERIOR foi radical demais: eu bloqueei toda leitura sem
 * dono, e com isso a chave que o proprio usuario salva pela tela ficou
 * invisivel para geracao de imagem e upload — quebrei o caso comum para
 * proteger o raro.
 *
 * A REGRA CERTA e a mesma do resolvedor de contas: quando NAO HA
 * AMBIGUIDADE, usar e seguro. Instalacao com um dono so nao tem de quem
 * vazar. A partir do segundo, so leitura com dono explicito.
 */
export function podeLerSemDono(quantidadeDeDonos: number): boolean {
  return quantidadeDeDonos === 1;
}

/**
 * Cache da contagem de donos.
 *
 * Sem ele, toda leitura de configuracao viraria um COUNT — e um unico
 * upload le tres chaves do Cloudinary. O numero muda quando alguem se
 * cadastra, e cinco minutos de atraso ai nao tem consequencia: no pior
 * caso a instalacao segue por mais cinco minutos na regra de "um dono".
 */
const CACHE_MS = 5 * 60 * 1000;
let _donos: { valor: number; em: number } | null = null;

export function limparCacheDeDonos(): void { _donos = null; }

async function contarDonos(): Promise<number> {
  if (_donos && Date.now() - _donos.em < CACHE_MS) return _donos.valor;
  // Dono = usuario sem ownerId. Membros de equipe nao contam: eles
  // pertencem a um dono e usam a configuracao dele.
  const valor = await prisma.user.count({ where: { ownerId: null } });
  _donos = { valor, em: Date.now() };
  return valor;
}

/**
 * Valor de uma configuracao: banco primeiro, variavel de ambiente depois.
 *
 * Passe `userId` sempre que souber de quem e a acao — e o caminho correto e
 * o unico que continua funcionando quando a instalacao tiver mais de uma
 * agencia.
 */
export async function getSetting(key: string, userId?: string): Promise<string | undefined> {
  try {
    if (userId) {
      const setting = await prisma.setting.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (setting?.value) return setting.value;
    } else if (podeLerSemDono(await contarDonos())) {
      const setting = await prisma.setting.findFirst({ where: { key } });
      if (setting?.value) return setting.value;
    }
  } catch {
    // Banco indisponivel: cai para a variavel de ambiente.
  }

  const envGetter = ENV_MAP[key];
  return envGetter ? envGetter() : undefined;
}
