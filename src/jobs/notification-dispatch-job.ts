import { getRuntimePrismaClient } from '../persistence/runtime-prisma-client.js';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.js';
import { parseTemplateBindings } from '../notifications/subscription-template.js';
import { YCloudRuntimeGateway } from '../notifications/ycloud-runtime-gateway.js';

export async function handler() {
  // Validar configuración antes de reservar mensajes; no registrar payloads ni secretos.
  const bindings = parseTemplateBindings(process.env.YCLOUD_SUBSCRIPTION_TEMPLATE_BINDINGS);
  const { gateway, senderPhone } = await new YCloudRuntimeGateway().client();
  const prisma = await getRuntimePrismaClient();
  const summary = await new NotificationDispatcher(prisma, gateway, senderPhone, bindings).dispatch();
  console.info('Subscription notification dispatch', summary);
  return summary;
}
