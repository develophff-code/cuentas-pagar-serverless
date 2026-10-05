# Preparación del backend de Fase C

Estado al 2026-10-05: implementación local, **sin despliegue ni cambios DNS**.
Se conserva `develop`; los commits y el push corresponden al dueño.

**Cambio de alcance del dueño:** el primer despliegue será un MVP para dos
tenants testigos, con presupuesto más económico. La arquitectura Proxy + NAT
de este documento no está aprobada para ese MVP. El presupuesto objetivo
confirmado es USD 20/mes AWS. La alternativa recomendada,
su estimación y las adaptaciones pendientes están en
[MVP_DOS_TENANTS.md](MVP_DOS_TENANTS.md).

## Componentes preparados

- `NotificationDispatcher` consume las tres intenciones de suscripción y crea
  un único `outbound_messages` por tenant/intención. La migración `008` agrega
  estados de despacho, reserva y próxima fecha de intento.
- La reserva usa PostgreSQL `FOR UPDATE SKIP LOCKED`; distintas invocaciones
  pueden trabajar sin enviar simultáneamente el mismo mensaje. El administrador
  debe seguir activo y tener una identidad YCloud verificada del mismo tenant.
- Un HTTP 429 se reintenta con backoff, hasta cinco intentos. Otros rechazos
  definitivos quedan `BLOCKED`. Timeouts, errores de red, 5xx o respuesta sin ID
  quedan `UNKNOWN`. Una reserva vencida también queda `UNKNOWN`.
- `externalId` es el ID de la fila outbound y permite conciliación con YCloud.
  **No se asume que YCloud deduplica ese campo**. Antes de liberar un estado
  ambiguo se debe consultar el proveedor; no resetear masivamente la cola.
- `SENT` significa aceptado por la cola de YCloud; `DELIVERED` y `READ` requieren
  conectar posteriormente los eventos de estado del proveedor.
- La Lambda de negocio, el webhook Mercado Pago, `/p/{token}`, el job diario y
  el dispatcher tienen entradas de runtime. Sólo las Lambdas leen secretos.
  En `expanded`, PostgreSQL usa TLS, pool de dos conexiones y Proxy. En `mvp`,
  Prisma usa Data API por HTTPS con ARNs; la Lambda no obtiene la contraseña.
- El perfil MVP prepara Aurora privada de 0 a 1 ACU con pausa tras cinco minutos,
  sin Proxy/NAT. SQS activa el dispatcher por pagos y ciclo diario; programa
  reintentos acotados y continuación de lotes. No hay polling cada minuto.
  Las transacciones y conversiones SQL tienen pruebas locales; su validación
  contra Aurora sigue pendiente. El runner manual de migraciones incluye plan
  offline, recibos y bloqueo concurrente; todavía no se ejecutó en AWS.
- La stack optativa `CuentasPagarBusiness-dev` agrega Cognito para `/v1`, rutas
  públicas de pago/webhook, jobs inicialmente **desactivados**, alarmas de errores
  y, si se indica dominio, CloudFront sin caché y ACM validado por DNS.
- `/subscription/payment/{success,failure,pending}` sólo informa al usuario:
  nunca activa suscripciones ni confía en parámetros del retorno.
- En el perfil `expanded`, `enableBusiness=true` prepara NAT y subredes privadas
  de aplicación
  con salida HTTPS; Aurora y Proxy siguen aislados. Sin ese contexto, la stack
  de datos conserva la configuración previa sin NAT.

El artefacto Lambda se construye desde `dist/src`, `dist/packages` y dependencias
de producción del lockfile. No incluye `.env`, perfiles AWS ni la copia completa
del workspace. No se modifica la infraestructura del ingress YCloud anterior.

## Contrato de plantillas pendiente

El idioma confirmado es Spanish (ARG), código `es_AR`. Los cuerpos y el mapeo
de negocio fueron informados por el dueño: ver [PLANTILLAS_YCLOUD_FASE_C.md](PLANTILLAS_YCLOUD_FASE_C.md).
Las variables nombradas `plan` y `fvto` están confirmadas y soportadas por el
cliente. Falta la URL exacta del botón «Pagar Renovación». El dispatcher
exige `YCLOUD_SUBSCRIPTION_TEMPLATE_BINDINGS`; no inventa parámetros ni envía
con configuración ausente. Los contratos de tests son fixtures.

| Tipo | Plantilla activa |
|---|---|
| `SUBSCRIPTION_RENEWAL_REMINDER` | `subscription_renewal_reminder` |
| `SUBSCRIPTION_PAYMENT_LINK` | `subscription_payment_link_v2` |
| `SUBSCRIPTION_PAYMENT_CONFIRMED` | `subscription_payment_confirmed` |

Cada entrada contiene `languageCode` y `body`, una lista ordenada de valores
`businessName`, `planName`, `endsAt`, `amount` o `expiresAt` para contratos
posicionales. Para los cuerpos nombrados confirmados, usar objetos como
`{ value: "planName", parameterName: "plan" }` y
`{ value: "endsAt", parameterName: "fvto" }`; no mezclar formatos en un cuerpo.
Reminder y confirmed requieren ambos; payment_link sólo `plan`. El enlace exige
`button: { index: 0, prefix: "" }` si la URL aprobada es
`https://apagar.averiqsj.app/p/{{1}}`; si es
`https://apagar.averiqsj.app/{{1}}`, el prefijo es `p/`.
Otros contratos necesitan adaptación explícita antes de activar.
El emisor se resuelve de runtime-config y debe ser `+5492646276709`.
La API key se conserva exclusivamente en Secrets Manager.

## Costos: autorización pendiente

Mes de referencia: 730 horas; región `us-east-1`; precios On-Demand, sin créditos
ni impuestos. El catálogo público consultado el 2026-10-01 confirma Aurora
PostgreSQL Standard a USD 0,12/ACU-h y Proxy a USD 0,015/ACU-h:
[catálogo AmazonRDS us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json).
La tabla de [precios de Proxy](https://aws.amazon.com/rds/proxy/pricing/)
establece un mínimo facturable de 8 ACU para Serverless v2.

| Componente | Supuesto | USD/mes |
|---|---|---:|
| Aurora cómputo | 0,5 ACU continuas | 43,80 |
| RDS Proxy | mínimo facturable de 8 ACU | 87,60 |
| NAT Gateway | 1 × 730 h × 0,045 | 32,85 |
| IPv4 pública del NAT | 1 × 730 h × 0,005 | 3,65 |
| **Subtotal** | sin almacenamiento ni consumo variable | **167,90** |

Fuentes: [Aurora](https://aws.amazon.com/rds/aurora/pricing/),
[Proxy](https://aws.amazon.com/rds/proxy/pricing/) y
[VPC/NAT/IPv4](https://aws.amazon.com/vpc/pricing/). Las tarifas NAT e IPv4
son referencia pública; reconfirmar región e importe en AWS Pricing Calculator
al aprobar el despliegue.

Sumar almacenamiento Aurora e I/O, backups excedentes, KMS, Secrets Manager,
S3, logs, alarmas, API Gateway, Lambda, EventBridge, Cognito, CloudFront y
transferencias entre AZ/Internet. YCloud/WhatsApp tiene cargos separados.
Con Aurora sostenida en el máximo de 2 ACU, su cómputo aumenta a USD 175,20
y el subtotal anterior a USD 299,30.

El presupuesto vigente de USD 20 no alcanza para esta arquitectura expandida.
No se cambia automáticamente:
se necesita autorización del dueño sobre recursos, costos y presupuesto.
Un presupuesto alerta, pero no limita el gasto. Una alternativa de menor costo
mediante Data API ya está preparada en el perfil MVP, con validación real y
cotización final pendientes; ver el documento de los dos tenants.

## Verificación y orden de activación

Preparación local sin leer Secrets Manager ni crear recursos:

```powershell
npm run typecheck
npm test
npm run lambda:package
# Preparación MVP local; no crea recursos:
node ./node_modules/aws-cdk/bin/cdk synth CuentasPagarBusiness-dev --context infrastructureProfile=mvp --context enableBusiness=true --context publicDomain=apagar.averiqsj.app --output cdk.out --quiet
```

No usar `cdk deploy --all`. Antes del despliegue:

1. Confirmar las plantillas y aprobar recursos/costos. Confirmar disponibilidad
   regional de Aurora 16.6 y cotización final con AWS Pricing Calculator.
2. Revisar el diff remoto con el perfil autorizado, sin consultar valores de
   secretos; desplegar datos y negocio con jobs desactivados.
3. Aplicar una sola vez `001`–`008`, en orden, desde un runner controlado con
   acceso por Data API en el MVP. Usar el [runner documentado](MIGRACIONES_DATA_API.md)
   después de la aprobación; no ejecutar migraciones al inicializar Lambdas.
4. Validar ACM mediante el CNAME entregado por AWS en Hostinger y luego apuntar
   `.app` a CloudFront. La stack puede quedar esperando validación ACM.
5. Cargar credenciales de prueba de Mercado Pago directamente en Secrets Manager,
   configurar el webhook HTTPS `payment` y verificar una compra de prueba.
6. Validar `/p/{token}` y retornos, configurar el contrato confirmado de YCloud
   y probar las tres plantillas con un destinatario autorizado.
7. Activar jobs después de esas verificaciones. No se borran datos automáticamente.

La integración PostgreSQL de concurrencia exige una `DATABASE_URL` temporal y
migraciones aplicadas. Los datos y el despacho del test se limitan a su tenant
temporal. No se obtiene URL ni contraseña desde AWS durante verificaciones locales.
