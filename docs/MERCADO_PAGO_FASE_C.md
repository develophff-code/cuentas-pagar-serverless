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
