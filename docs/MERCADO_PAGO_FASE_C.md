# Mercado Pago — Fase C

La Fase C integra renovaciones mensuales manuales mediante **Checkout Pro**.
No guarda tarjetas, CVV ni tokens de medios de pago: el navegador sólo es
redirigido al `init_point` emitido por Mercado Pago.

## Configuración segura por ambiente

El secreto de runtime ya existente en AWS Secrets Manager
(`cuentas-pagar/<ambiente>/runtime-config`) tendrá estos campos cuando se vaya a
probar la integración:

```json
{
  "mercadoPagoAccessToken": "<valor-secreto>",
  "mercadoPagoWebhookSecret": "<valor-secreto>"
}
```

Los valores reales se cargan directamente en Secrets Manager, nunca en Git,
`.env`, CDK ni mensajes de chat. Primero se usan credenciales de prueba y luego
las productivas, cada una en su ambiente correspondiente. La **Public Key** no
es necesaria para este flujo inicial de Checkout Pro: sólo sería necesaria en
un frontend que integre Bricks o tokenización, algo que no está contemplado en
esta etapa.

Para los avisos de WhatsApp se agregan `ycloudApiKey` y `ycloudSenderPhone` al
mismo secreto. El emisor de `dev` es `+5492646276709`. Las plantillas Utility
activas son `subscription_renewal_reminder`, `subscription_payment_link_v2` y
`subscription_payment_confirmed`.

## Contrato implementado

- `src/subscriptions/mercado-pago-client.ts` crea preferencias mediante
  `POST /checkout/preferences` y consulta el pago mediante
  `GET /v1/payments/{id}`. El Access Token se usa exclusivamente en servidor.
- La preferencia incorpora referencia externa, importe y plan calculados por el
  servidor, una URL de notificación y las tres URLs de retorno. Su vigencia se
  limita explícitamente.
- `src/subscriptions/mercado-pago-signature.ts` valida `x-signature` y
  `x-request-id` mediante HMAC-SHA256. El webhook no confiará en su payload para
  acreditar una orden: consultará el pago a Mercado Pago y cotejará estado,
  referencia, moneda e importe con la orden local.
- `POST /v1/tenants/{tenantId}/subscription-orders` exige JWT, rol `ADMIN` y
  `Idempotency-Key`. El navegador sólo envía el plan: el precio vigente se lee
  desde la base, se congela en `subscription_orders` y se crea la preferencia.
- La migración `005_subscription_checkout_idempotency.sql` protege tanto el
  reintento de una orden como que una orden acreditada genere más de una
  suscripción.

## Datos que faltan antes de activar el flujo real

1. Publicar y confirmar la base HTTPS de la web (`https://apagar.averiqsj.app`)
   para construir las rutas de retorno `success`, `failure` y `pending`.
2. Publicar una URL HTTPS del webhook de Mercado Pago y configurarla en **Tus
   integraciones**, activando el tópico `payment`.
3. Cargar el Access Token de prueba y el secreto de webhook de prueba en el
   secreto de `dev`; ejecutar compras de prueba antes de usar credenciales
   productivas.

La redirección del usuario es sólo de experiencia de usuario: la activación de
la suscripción dependerá del webhook autenticado y de la consulta servidor a
servidor del pago.

## Renovación vencida y retención

- Tras el vencimiento mensual hay **48 horas de gracia** con operatoria
  completa y sin intereses.
- Luego hay **7 días de bloqueo**: se conserva acceso a renovación y se calcula
  interés simple diario sobre la última cuota, con una tasa mensual editable y
  versionada.
- Al terminar el bloqueo el tenant queda `ACCESS_EXPIRED`; sus datos operativos
  se retienen 90 días. La reactivación suma el precio vigente del plan, el
  interés histórico y un recargo de conservación calculado sobre la última
  cuota. Luego se programa el borrado, condicionado a los requisitos legales de
  conservación que confirme el asesoramiento profesional.
- Durante esos 90 días, sólo el `ADMIN` puede crear la orden de re-suscripción.
  Esa excepción no concede acceso operativo ni habilita otras acciones de
  facturación; el tenant vuelve a activarse únicamente al conciliar un pago
  aprobado.

La reconciliación de estados está aislada en `TenantLifecycleService` y su
entrada diaria es `src/jobs/subscription-lifecycle-job.ts`. Antes de desplegarla
se conectará a un scheduler administrado y se configurará la observabilidad.
El mismo job crea de forma idempotente una intención de recordatorio cinco días
antes y una intención con el enlace de Checkout al vencimiento. Aún no envía
WhatsApp ni correo directamente: `NotificationDispatcher` consume las tres
intenciones de suscripción mediante YCloud. Su activación requiere la migración
`008`, confirmar los parámetros de las plantillas y desplegar el backend.
Ver [DESPLIEGUE_FASE_C.md](DESPLIEGUE_FASE_C.md).
El enlace del botón usa un token opaco de vida limitada bajo `/p/{token}`; no
expone la URL de Mercado Pago y la respuesta de redirección no se almacena en
caché. La ruta pública y el dispatcher están preparados en la stack optativa de
negocio, todavía sin desplegar. Aurora, Proxy, salida de red y dominio `.app`
requieren revisión de costos y autorización antes de provisionarse.

## Dominios y certificados

Los dominios nuevos no deben apuntarse a una IP de EC2 para este backend
serverless. Cuando se publiquen los recursos, la configuración será:

- `apagar.averiqsj.app`: CNAME hacia la distribución de CloudFront que sirva la
  aplicación web, con certificado ACM administrado por AWS.
- `apagar.averiqsj.com`: dominio personalizado regional de API Gateway para
  `POST /api/webhook/ycloud` y el próximo `POST /api/webhook/mercado-pago`,
  también con certificado ACM en `us-east-1`.

Certbot y la IP de EC2 sólo corresponden al servicio legado que hoy atiende
`averiq.cloud`; no se modifica ni se redirige hasta validar el reemplazo en
AWS. ACM se valida con los CNAME que entregue AWS y renueva los certificados
automáticamente.
