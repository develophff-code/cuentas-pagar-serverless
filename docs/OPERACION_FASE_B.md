# Operación — Fase B

## Protección ante fallos

- `InboundEvents` conserva eventos YCloud deduplicados con PITR y stream.
- El relay procesa el stream en lotes de hasta diez, divide lotes fallidos y,
  tras cinco reintentos, envía el registro original a `OutboxDeadLetterQueue`.
- `ConversationQueue.fifo` conserva orden por identidad; tras cinco intentos,
  mueve el mensaje a `ConversationDeadLetterQueue.fifo`.
- El worker responde con `batchItemFailures`, por lo que un lote futuro sólo
  reintenta los mensajes que realmente fallaron.

## Alarmas y corrección

Las alarmas de `dev` cubren errores de ingress, retraso del relay mayor a cinco
minutos y mensajes visibles en cada DLQ. Antes de un replay se debe inspeccionar
la causa, corregir el código/configuración y reenviar únicamente mensajes que
continúen siendo válidos e idempotentes. No se vacía una DLQ manualmente.

## Respaldo y retención

Aurora mantiene backups automáticos siete días; DynamoDB tiene PITR; S3 conserva
versiones y no borra documentos automáticamente. Los logs Lambda se retienen 30
días. La retención legal definitiva sigue pendiente.
