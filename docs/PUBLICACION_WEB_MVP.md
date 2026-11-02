# Publicación de la web MVP

Estado al 2026-11-02: despliegue rechazado por una restricción de verificación
de cuenta en CloudFront; rollback terminado (`UPDATE_ROLLBACK_COMPLETE`).
El DNS de validación es correcto.

## Incidente: CloudFront exige verificar la cuenta

ACM llegó a `ISSUED`, pero `PublicDistributionDA9149C2` falló al crearse a las
18:46:05 de Buenos Aires (21:46:05 UTC), con HTTP 403 / `AccessDenied`:

> Your account must be verified before you can add new CloudFront resources.

AWS indicó contactar a Support e incluir el error. Request ID:
`e1960d41-c9fa-4de8-9fdc-871b8665ff3d`.

No hay distribución creada ni destino CNAME de publicación. No reintentar
hasta que AWS confirme que levantó la restricción y CloudFormation termine
el rollback. No se modificó la arquitectura para eludir esta restricción.

Texto para un caso privado en [AWS Support](https://console.aws.amazon.com/support/home#/):

```text
Subject: CloudFront account verification blocks dev deployment

Account: 378780514951
We are deploying a small serverless accounts payable pilot for two test
businesses. We need one CloudFront distribution for a private S3-hosted SPA
and an existing API Gateway, using apagar.averiqsj.app and ACM in us-east-1.
DNS validation succeeded and ACM issued the certificate.

On 2026-11-02 at 21:46:05 UTC, CloudFormation stack CuentasPagarBusiness-dev
failed to create AWS::CloudFront::Distribution with HTTP 403 / AccessDenied:
"Your account must be verified before you can add new CloudFront resources."
Request ID: e1960d41-c9fa-4de8-9fdc-871b8665ff3d

Please review the account verification restriction for CloudFront and tell
us what verification steps are required to enable creation of this resource.
```

No se abrió ni envió un caso de soporte desde el agente.

## Registro DNS de validación

El dueño informó que agregó este registro en Hostinger; se verificó su
resolución pública mediante `1.1.1.1` y `8.8.8.8` el 2026-11-02. ACM confirmó `ISSUED`:

| Campo | Valor |
|---|---|
| Tipo | `CNAME` |
| Nombre relativo | `_4b0cec11660881ecb2728817a0e9049c.apagar` |
| Destino | `_f5fdf010e5d54aad20235f81b206a9d1.wzccmgtwzk.acm-validations.aws` |
| TTL | Predeterminado del panel |

El nombre completo entregado por AWS es
`_4b0cec11660881ecb2728817a0e9049c.apagar.averiqsj.app.`.
Certificado del intento, eliminado durante el rollback: `arn:aws:acm:us-east-1:378780514951:certificate/aae4256a-c92d-419c-af2b-efb8adc36a28`.
No modificar `@`, `www`, nameservers ni el webhook legado. El CNAME de
publicación `apagar` se obtendrá después de crear CloudFront. Conservar el
CNAME de validación también después de emitirse el certificado.

## Estado verificado y alcance

Se consultó la identidad AWS con `averiqsj-dev`: cuenta `378780514951`, región
`us-east-1`. Antes de la actualización, `CuentasPagarBusiness-dev` estaba en
`CREATE_COMPLETE`, con los outputs informados por el dueño y sin certificado
ni CloudFront. Tras confirmar nuevamente identidad y diff, se inició el
despliegue exclusivamente de esta stack con el artefacto revisado.
No se consultaron valores de secretos. El dueño cargó el CNAME de validación
en Hostinger; el agente comprobó su resolución pública sin modificar DNS.

Durante el intento se actualizaron las cinco Lambdas y el cliente Cognito,
y se crearon dominio de login, certificado y bucket privado. Luego de fallar
CloudFront, los eventos de rollback confirmaron la reversión de las Lambdas y
el cliente. La limpieza terminó a las 18:49 de Buenos Aires: se eliminaron
el certificado, el dominio de login y los auxiliares nuevos. El bucket quedó
retenido (`DELETE_SKIPPED`) por su política `RETAIN`; no borrarlo manualmente.
El User Pool existente, Aurora y la API anterior se conservaron.

Identificadores del intento (no implican publicación operativa):

- Cliente web Cognito existente: `16vuhdo67tqhng21pddieb92t1`.
- Bucket: `cuentaspagarbusiness-dev-webassets27872646-tola8v75st3c`.
- Certificado que llegó a emitirse:
  `arn:aws:acm:us-east-1:378780514951:certificate/aae4256a-c92d-419c-af2b-efb8adc36a28`.
- Antes del rollback se verificaron el job diario en `DISABLED`, el consumidor
  SQS en `Disabled` y los archivos/configuración pública de la SPA en S3.

Último estado consultado: `UPDATE_ROLLBACK_COMPLETE`. Los outputs anteriores
de API Gateway y Cognito permanecen disponibles. Antes de reintentar tras la
habilitación de AWS, revisar el diff y el bucket retenido para no perder de
vista recursos fuera de la stack. El nuevo certificado tendrá otro ARN;
consultar su validación DNS sin asumir que debe cambiar el CNAME existente.

Validación local: compilación y 97 pruebas aprobadas; artefactos de Lambda y
web generados. Se abrió la demo local en navegador sin errores de consola.
La síntesis terminó correctamente y el diff remoto se revisó sin crear
change sets. Las pruebas E2E del modo real con Cognito/API/Aurora siguen
pendientes del despliegue y del alta de identidades/membresías del piloto.

Esta actualización agrega S3 privado con OAC, CloudFront, ACM por validación
DNS y dominio Cognito alojado. Conserva el User Pool y su cliente existentes.
Actualiza el artefacto de las cinco Lambdas y `PUBLIC_APP_BASE_URL` al dominio
web. Jobs y consumidor SQS permanecen desactivados. No agrega NAT, Proxy,
Aurora, WAF ni claves KMS. La ausencia de WAF corresponde a esta preparación
del piloto y no equivale a cumplir toda la arquitectura de producción.

La SPA usa login Cognito con authorization code, PKCE, estado y nonce. Los
tokens permanecen en memoria; al recargar se vuelve a ofrecer el ingreso.
El navegador obtiene únicamente las empresas de la identidad autenticada.
La API vuelve a validar membresía, acceso y rol en cada consulta u operación.
`app-config.json` se genera desde referencias CDK: contiene datos públicos de
conexión, nunca secretos. No existe fallback a datos demo en la web publicada.

Rutas CloudFront:

| Ruta | Destino |
|---|---|
| `/`, `/src/*`, `/app-config.json` | Bucket privado de la SPA |
| `/v1/*` | API Gateway, con prefijo de origen `/dev` |
| `/api/*` | API Gateway: webhook Mercado Pago |
| `/p/*` | API Gateway: enlace opaco de pago |
| `/subscription/payment/*` | API Gateway: retornos de Checkout |

Se conservan las rutas `/v1` del contrato existente. No se agrega un prefijo
`/api` a las llamadas de negocio. Todas las rutas API pasan sin caché y
conservan Authorization y query strings. No hay una redirección global de
errores de API a `index.html`; el callback Cognito usa `/`.

## Funcionalidad disponible y límites del piloto

La conexión real incluye contexto y rol, catálogo de categorías de la base,
proveedores, listado de comprobantes en todos sus estados, alta manual de
comprobantes, grilla/configuración, listado de lotes, propuesta/aprobación y
reversa mediante los servicios existentes, consulta de miembros para ADMIN y
creación de Checkout Pro. Mercado Pago requiere completar luego sus secretos
y las pruebas con cuentas de prueba; no se ejecutó ninguna compra.

El modo local `npm run web` sigue siendo demo. En modo real se ocultan el
simulador de roles, las invitaciones sin integración Cognito, la confirmación
y cancelación de borradores sin endpoints, y el chat IA sin cuota/auditoría
persistentes. La carga de archivos está deshabilitada: el flujo anterior sólo
enviaba nombre/MIME y no subía el archivo. La vinculación WhatsApp queda
indicada como pendiente; un enlace con tenantId no constituye un desafío
seguro. Los datos bancarios permanecen deshabilitados hasta configurar su
protector. La clasificación de proveedores ya existentes requiere completar
su operación de edición; el alta permite elegir una categoría real.

Un proveedor sin categoría puede tener borradores, pero el servidor rechaza
confirmarlos. No se requieren migraciones para esta actualización.

Las Fases D/E contienen implementación local y demostraciones; estos límites
deben resolverse antes de declarar completas sus capacidades en AWS.

## Estimación incremental

Supuesto de piloto: 1 GB/mes entregado desde Sudamérica, 100.000 solicitudes
HTTPS/mes, hasta 0,1 GB de archivos estáticos y dos usuarios activos. Se usa
pago por consumo, sin descontar créditos ni niveles gratuitos.

- CloudFront: USD 0,110/GB + USD 0,022 por 10.000 HTTPS; escenario USD 0,33.
- S3: almacenamiento y lecturas de archivos pequeños, más escrituras de
  publicación: reserva aproximada USD 0,05/mes para ese escenario.
- Cognito Essentials: referencia USD 0,015 por usuario activo; dos usuarios
  USD 0,03 sin descontar franquicias. Se consultó el pool remoto y su tier es
  `ESSENTIALS`, todavía sin dominio de login.
- ACM público no exportable: sin cargo de certificado.
- Sumar consumo puntual de Lambda de publicación, almacenamiento de artefactos
  y logs. Reserva incremental orientativa total: **USD 1/mes** para el supuesto
  indicado, no una tarifa fija ni un límite automático.

No incluye el consumo adicional de API/Lambda/Aurora causado por operar la
web, YCloud, Mercado Pago ni IA. Mantener el objetivo total AWS de USD 20 exige
medir también ese uso. Sin caché de estáticos se privilegia evitar versiones
viejas durante el piloto; revisar estrategia de hashes/caché antes de ampliar.

Fuentes consultadas el 2026-11-02:
[CloudFront](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/),
[S3](https://aws.amazon.com/s3/pricing/),
[Cognito](https://aws.amazon.com/cognito/pricing/),
[ACM](https://aws.amazon.com/certificate-manager/pricing/).

## Preparación y revisión

```powershell
npm test
npm run lambda:package
node scripts/package-web.cjs
$env:CDK_DEFAULT_ACCOUNT = '378780514951'
$env:CDK_DEFAULT_REGION = 'us-east-1'
node ./node_modules/aws-cdk/bin/cdk synth CuentasPagarBusiness-dev --context stage=dev --context infrastructureProfile=mvp --context enableBusiness=true --context publicDomain=apagar.averiqsj.app --context enableSchedules=false --output cdk.out --quiet
aws sts get-caller-identity --profile averiqsj-dev --region us-east-1
node ./node_modules/aws-cdk/bin/cdk diff CuentasPagarBusiness-dev --app cdk.out --profile averiqsj-dev --no-change-set --exclusively
```

Revisar que el diff no borre/reemplace recursos existentes ni active jobs.
CDK puede advertir que su catálogo de validación no reconoce Aurora 16.15;
conservar la versión desplegada y no cambiar la base por esa advertencia.
Nunca ejecutar `cdk deploy --all`.

## Despliegue y DNS, después de aprobar el cambio concreto

```powershell
node ./node_modules/aws-cdk/bin/cdk deploy CuentasPagarBusiness-dev --app cdk.out --profile averiqsj-dev --exclusively
```

1. La actualización puede esperar la validación DNS de ACM. Desde otra sesión,
   consultar `list-stack-resources` para encontrar el ARN de `PublicCertificate`;
   luego `acm describe-certificate` para obtener
   `DomainValidationOptions[].ResourceRecord` en `us-east-1`.
2. En Hostinger, agregar solamente el CNAME de validación entregado por ACM.
   Si el panel agrega el dominio automáticamente, ingresar sólo el nombre
   relativo correspondiente. No duplicar `averiqsj.app` en el nombre.
3. Esperar certificado `ISSUED` y stack `UPDATE_COMPLETE`. Copiar el output
   `PublicDomainCnameTarget` y crear el CNAME `apagar` hacia ese nombre
   `d….cloudfront.net`, sin `https://` ni rutas. Si `apagar` ya tiene registros,
   revisarlos antes de reemplazarlos. No modificar `@`, `www` ni nameservers.
4. Conservar el CNAME de validación para la renovación automática. No publicar
   el nombre `.app` sin HTTPS válido. No cambiar el webhook legado YCloud.
5. Comprobar HTTPS, archivos JS, `app-config.json` y login Cognito. Un `/v1/*`
   sin token debe fallar como API, nunca devolver el HTML de la SPA.
6. Verificar que las identidades Cognito del piloto tienen usuarios y membresías
   activos en PostgreSQL, unidos por `cognito_sub`. No habilitar autorregistro
   público ni registrar tenants adicionales sin decisión del dueño. Si no hay
   membresías, la SPA muestra el aviso de alta pendiente.
7. Ejecutar casos de prueba con dos tenants: visibilidad aislada, acceso por
   roles, proveedor clasificado/no clasificado, alta manual, propuesta y
   aprobación, reversa y relectura tras recargar. Después completar secretos
   de prueba de Mercado Pago/YCloud y comprobar Checkout/webhooks.

Rollback: revisar el diff del artefacto anterior antes de volver a desplegarlo.
No eliminar Cognito, Aurora, secretos, ni el bucket retenido. El sitio
institucional y el webhook legado permanecen independientes.
