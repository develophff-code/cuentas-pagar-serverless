# API HTTP — Fase B

La primera versión del backend expone comandos mutables versionados bajo `/v1`.
El contrato se prueba localmente antes de integrar Cognito y de desplegar una base
administrada.

## Autenticación y aislamiento

Las rutas operativas requieren un JWT de Cognito validado por API Gateway. El
Lambda recibe los claims `sub`, `email` y opcionalmente `name`; nunca acepta un
usuario, rol ni `tenant_id` desde el cuerpo. El tenant se toma exclusivamente
del parámetro de ruta y se vuelve a autorizar contra `tenant_memberships` antes
de ejecutar el comando. Esto impide que cambiar un identificador en el cuerpo
permita operar sobre otro tenant.

Las rutas mutables por tenant requieren el encabezado `Idempotency-Key`. Una
repetición con la misma clave y el mismo comando devuelve el resultado previo;
una clave reutilizada con contenido diferente se rechaza. El alta web crea el
tenant y su administrador en una única transacción y queda como excepción
temporal: recibirá su recibo de idempotencia cuando se incorpore la tabla de
comandos HTTP de onboarding.

Cada alta de proveedor o factura y cada propuesta/registro de pago deja un
evento de auditoría transaccional con tenant, actor, acción, entidad y canal
`WEB`. La migración `003` agrega la huella de contenido a los pagos, por lo que
también rechaza una reutilización de clave con otra selección de facturas.

## Comandos iniciales

| Método y ruta | Roles | Resultado |
| --- | --- | --- |
| `POST /v1/onboarding/web` | usuario Cognito | tenant Profesional/Ultra y ADMIN en prueba |
| `POST /v1/tenants/{tenantId}/suppliers` | ADMIN, OPERATOR_UPLOAD | proveedor |
| `POST /v1/tenants/{tenantId}/invoices` | ADMIN, OPERATOR_UPLOAD | factura en revisión o grilla |
| `POST /v1/tenants/{tenantId}/payment-batches` | ADMIN, OPERATOR_PAYMENTS | pago registrado o propuesta |
| `GET /v1/tenants/{tenantId}/payment-grid` | ADMIN, OPERATOR_PAYMENTS | facturas disponibles para pago |
| `PUT /v1/tenants/{tenantId}/payment-grid/configuration` | ADMIN | horario, ventana y destinatarios de alertas |

Los importes se reciben como `amountInCents` entero para evitar errores de
redondeo. Una respuesta nueva devuelve `201`; una repetición idempotente,
`200`. Los errores de autenticación/autorización se mapearán a `401`/`403` al
conectar el authorizer de Cognito; por ahora el manejador devuelve `400` para
las violaciones de dominio y un contrato de request incompleto.

La configuración de alertas recibe `timezone` IANA, `notificationTime` en
formato `HH:mm`, `lookAheadHours` de 1 a 168 y una lista de memberships activas
del mismo tenant. Es un comando idempotente y sólo está disponible en planes
con alertas habilitadas; no envía todavía mensajes, que se incorporarán con el
worker de notificaciones.

## Ingress YCloud

La stack de aplicación define `POST /api/webhook/ycloud` en API Gateway REST.
Es el path compatible con el endpoint legado
`https://apagar.averiq.cloud/api/webhook/ycloud`, pero no configura ni reclama
ese dominio: su URL administrada se usa primero para pruebas de `dev`.

El handler verifica `YCloud-Signature` sobre el cuerpo original mediante
HMAC-SHA256 y el timestamp del proveedor, con una ventana máxima de cinco
minutos. El secreto vive como `ycloudWebhookSecret` dentro del secreto de
runtime de Secrets Manager y Lambda sólo tiene permiso de lectura sobre ese
secreto y de escritura sobre `InboundEvents`. DynamoDB guarda el evento con la
clave `YCLOUD#{event.id}` y una escritura condicional, de modo que los
reintentos de YCloud devuelven `200` sin duplicarlo. La retención automática es
de 30 días. DynamoDB Streams relaya cada inserción a `ConversationQueue.fifo`.
El grupo FIFO se deriva mediante SHA-256 de la identidad WhatsApp, conservando
el orden de una conversación sin exponer teléfono o BSUID en el identificador.
La cola mantiene una DLQ y el worker consume de a un mensaje; aún no descarga
archivos ni envía respuestas, que pertenecen al hito de S3/OCR y mensajería.
