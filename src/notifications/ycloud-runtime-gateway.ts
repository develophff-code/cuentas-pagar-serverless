import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { YCloudHttpClient, type YCloudMessageGateway } from './ycloud-client.js';

const secrets = new SecretsManagerClient({});
let runtimeConfig: Promise<{ apiKey: string; senderPhone: string }> | undefined;

async function loadRuntimeConfig(): Promise<{ apiKey: string; senderPhone: string }> {
  if (runtimeConfig === undefined) runtimeConfig = (async () => {
    const secretId = process.env.RUNTIME_CONFIG_SECRET_ARN;
    if (!secretId) throw new Error('RUNTIME_CONFIG_SECRET_ARN no está configurada.');
    const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
    const parsed: unknown = response.SecretString === undefined ? undefined : JSON.parse(response.SecretString);
    const config = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    if (typeof config.ycloudApiKey !== 'string' || !config.ycloudApiKey.trim()
      || typeof config.ycloudSenderPhone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(config.ycloudSenderPhone)) {
      throw new Error('ycloudApiKey o ycloudSenderPhone no están configurados correctamente.');
    }
    return { apiKey: config.ycloudApiKey, senderPhone: config.ycloudSenderPhone };
  })().catch(() => { runtimeConfig = undefined; throw new Error('YCLOUD_RUNTIME_UNAVAILABLE'); });
  return runtimeConfig;
}

export class YCloudRuntimeGateway {
  async client(): Promise<{ senderPhone: string; gateway: YCloudMessageGateway }> {
    const config = await loadRuntimeConfig();
    return { senderPhone: config.senderPhone, gateway: new YCloudHttpClient(config.apiKey) };
  }
}
