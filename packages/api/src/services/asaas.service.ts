import { prisma } from '../config/database';

// Billing via Asaas (#10 white-label): o dono (owner) configura a PROPRIA chave da Asaas
// e gera cobrancas (PIX/boleto/cartao) para os clientes dele. A chave fica no Setting do
// owner e NUNCA e devolvida por nenhuma rota (só o booleano "configured").

function baseUrl(envName: string) {
  return envName === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';
}

async function getConfigRaw(userId: string) {
  const rows = await prisma.setting.findMany({ where: { userId, key: { in: ['asaas_apiKey', 'asaas_env'] } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return { apiKey: map.get('asaas_apiKey') || null, env: map.get('asaas_env') || 'sandbox' };
}

export async function getBillingConfig(userId: string) {
  const c = await getConfigRaw(userId);
  return { configured: !!c.apiKey, env: c.env }; // nunca expoe a chave
}

export async function setBillingConfig(userId: string, apiKey: string | null | undefined, env: string | undefined) {
  if (env) {
    await prisma.setting.upsert({
      where: { userId_key: { userId, key: 'asaas_env' } },
      update: { value: env },
      create: { userId, key: 'asaas_env', value: env },
    });
  }
  if (apiKey !== undefined) {
    if (!apiKey) {
      await prisma.setting.deleteMany({ where: { userId, key: 'asaas_apiKey' } });
    } else {
      await prisma.setting.upsert({
        where: { userId_key: { userId, key: 'asaas_apiKey' } },
        update: { value: apiKey },
        create: { userId, key: 'asaas_apiKey', value: apiKey },
      });
    }
  }
}

async function asaasReq(userId: string, path: string, method: string = 'GET', body?: any) {
  const c = await getConfigRaw(userId);
  if (!c.apiKey) throw new Error('Configure a chave da Asaas em Cobranca > Configuracoes.');
  const res = await fetch(`${baseUrl(c.env)}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', access_token: c.apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.errors?.[0]?.description || json?.message || `Asaas HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function testConnection(userId: string) {
  const acc = await asaasReq(userId, '/myAccount', 'GET');
  return { ok: true, account: { name: acc?.name || acc?.company || null, email: acc?.email || null } };
}

export async function createCharge(
  userId: string,
  input: { customerName: string; cpfCnpj: string; value: number; billingType: string; dueDate: string; description?: string },
) {
  const cpf = input.cpfCnpj.replace(/\D/g, '');
  // 1) acha ou cria o cliente
  let customerId: string | undefined;
  const found = await asaasReq(userId, `/customers?cpfCnpj=${encodeURIComponent(cpf)}`, 'GET');
  if (found?.data?.length) customerId = found.data[0].id;
  if (!customerId) {
    const created = await asaasReq(userId, '/customers', 'POST', { name: input.customerName, cpfCnpj: cpf });
    customerId = created.id;
  }
  // 2) cria a cobranca
  const payment = await asaasReq(userId, '/payments', 'POST', {
    customer: customerId,
    billingType: input.billingType, // PIX | BOLETO | CREDIT_CARD | UNDEFINED
    value: input.value,
    dueDate: input.dueDate,
    description: input.description || 'Assinatura',
  });
  return {
    id: payment.id,
    status: payment.status,
    value: payment.value,
    dueDate: payment.dueDate,
    invoiceUrl: payment.invoiceUrl,
    bankSlipUrl: payment.bankSlipUrl,
    billingType: payment.billingType,
  };
}

export async function listCharges(userId: string) {
  const r = await asaasReq(userId, '/payments?limit=30&order=desc', 'GET');
  return (r?.data || []).map((p: any) => ({
    id: p.id,
    status: p.status,
    value: p.value,
    dueDate: p.dueDate,
    billingType: p.billingType,
    invoiceUrl: p.invoiceUrl,
    description: p.description,
    dateCreated: p.dateCreated,
  }));
}
