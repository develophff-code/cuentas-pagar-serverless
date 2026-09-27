import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { MercadoPagoHttpClient, type MercadoPagoGateway, type MercadoPagoPayment, type MercadoPagoPreference, type MercadoPagoPreferenceInput } from './mercado-pago-client.js';

const secrets = new SecretsManagerClient({});
let accessToken: Promise<string> | undefined;

async function getAccessToken(): Promise<string> {
  if (accessToken === undefined) {
    accessToken = (async () => {
      const secretId = process.env.RUNTIME_CONFIG_SECRET_ARN;
      if (!secretId) throw new Error('RUNTIME_CONFIG_SECRET_ARN no está configurada.');
      const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (!response.SecretString) throw new Error('El secreto de runtime no contiene texto JSON.');
      const parsed: unknown = JSON.parse(response.SecretString);
      const value = typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>).mercadoPagoAccessToken
        : undefined;
      if (typeof value !== 'string' || !value.trim()) throw new Error('mercadoPagoAccessToken no está configurado.');
      return value;
    })();
  }
  return accessToken;
}

/** Resuelve el token desde Secrets Manager sólo al usar Mercado Pago. */
export class MercadoPagoRuntimeGateway implements MercadoPagoGateway {
  async createPreference(input: MercadoPagoPreferenceInput): Promise<MercadoPagoPreference> {
    return new MercadoPagoHttpClient(await getAccessToken()).createPreference(input);
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    return new MercadoPagoHttpClient(await getAccessToken()).getPayment(paymentId);
  }
}
