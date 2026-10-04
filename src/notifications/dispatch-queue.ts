import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

/** Mensaje de activación: sin token, destinatario, credenciales ni payload del aviso. */
export async function enqueueNotificationDispatch(reason: 'LIFECYCLE' | 'PAYMENT' | 'RETRY' | 'CONTINUE', delaySeconds = 0): Promise<void> {
  const queueUrl = process.env.NOTIFICATION_DISPATCH_QUEUE_URL;
  if (!queueUrl) return; // Perfil expandido mantiene su scheduler anterior.
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 900) throw new Error('DISPATCH_DELAY_INVALID');
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ reason }), DelaySeconds: delaySeconds }));
}

export function dispatchRetryDelay(nextAttemptAt: Date, now = new Date()): number {
  return Math.max(0, Math.min(900, Math.ceil((nextAttemptAt.getTime() - now.getTime()) / 1000)));
}
