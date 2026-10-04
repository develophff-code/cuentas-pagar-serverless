import { getRuntimePrismaClient } from '../persistence/runtime-prisma-client.js';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.js';
import { parseTemplateBindings } from '../notifications/subscription-template.js';
import { YCloudRuntimeGateway } from '../notifications/ycloud-runtime-gateway.js';
import { dispatchRetryDelay, enqueueNotificationDispatch } from '../notifications/dispatch-queue.js';

export async function handler() {
  // Validar configuración antes de reservar mensajes; no registrar payloads ni secretos.
  const bindings = parseTemplateBindings(process.env.YCLOUD_SUBSCRIPTION_TEMPLATE_BINDINGS);
  const { gateway, senderPhone } = await new YCloudRuntimeGateway().client();
  const prisma = await getRuntimePrismaClient();
  const summary = await new NotificationDispatcher(prisma, gateway, senderPhone, bindings).dispatch();
  if (process.env.NOTIFICATION_DISPATCH_QUEUE_URL) {
    if (summary.accepted + summary.retry + summary.blocked + summary.unknown >= 10) {
      await enqueueNotificationDispatch('CONTINUE');
    } else {
      const next = await prisma.outbound_messages.findFirst({ where: {
        provider: 'YCLOUD', logical_key: { startsWith: 'SUBSCRIPTION_INTENT:' },
        dispatch_state: { in: ['READY', 'RETRY'] }, attempt_count: { lt: 5 },
      }, orderBy: { next_attempt_at: 'asc' }, select: { next_attempt_at: true } });
      if (next) await enqueueNotificationDispatch('RETRY', dispatchRetryDelay(next.next_attempt_at));
    }
  }
  console.info('Subscription notification dispatch', summary);
  return summary;
}
