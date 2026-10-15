# Revisión de costos del MVP — Fase C

Fecha: 2026-10-13. Región prevista: `us-east-1`. Objetivo acordado:
**USD 20/mes AWS para Cuentas a Pagar dev**, incluida su fundación existente.
El dueño confirmó el 2026-10-13 que el legado de Ohio se presupuesta aparte.
YCloud/WhatsApp también aparte.
Revisión local con tarifas públicas; **no es aprobación de despliegue**, factura
proyectada ni garantía de tope. Sin créditos, free tier, descuentos o impuestos.

## Alcance de la propuesta

Un ambiente dev para dos tenants, con fundación existente, ingress YCloud y
backend de negocio. El perfil `mvp` prepara:

- Aurora PostgreSQL Standard: un writer Serverless v2, 0–1 ACU, pausa tras cinco
  minutos, Data API y siete días de backup. Sin replica, Proxy ni NAT.
- VPC aislada sin endpoints de interfaz ni direcciones IPv4 públicas.
- Ocho Lambdas en total: tres de ingress y cinco de negocio. La concurrencia
  reservada es un límite, no Provisioned Concurrency facturable permanente.
- Dos APIs REST regionales, una tabla DynamoDB con PITR, cinco colas SQS,
  diez alarmas estándar, un scheduler diario, ocho grupos de logs y Cognito.
- Un bucket S3 privado y versionado; CloudFront/ACM al publicar `.app`.
- Una clave KMS existente y dos secretos en total: runtime existente y base nueva.

Los conteos se revisaron contra el código CDK y los templates locales, sin
consultar secretos. No incluir `CuentasPagarData-dev` expandida en este alcance.
Los archivos viejos que queden en `cdk.out` no representan recursos desplegados.

## Base mensual para planificar

| Componente | Supuesto de planificación | USD/mes |
|---|---|---:|
| KMS existente | Una clave propia, sin rotaciones anteriores | 1,00 |
| Secrets Manager | Dos secretos × 0,40 | 0,80 |
| CloudWatch | Diez alarmas estándar de una métrica × 0,10 | 1,00 |
| Almacenamiento Aurora | 10 GB promedio × 0,10/GB-mes | 1,00 |
| **Subtotal sin cómputo ni consumo variable** | | **3,80** |
| Reserva de planificación para consumo variable | Ver supuestos siguientes | **2,20** |
| **Base usada en los escenarios** | | **6,00** |

Los 10 GB son un supuesto para esta proyección, no un límite de almacenamiento
configurado. Los backups dentro de la franquicia asociada al cluster activo no
se suman dos veces; snapshots retenidos, exceso de backup, versiones S3 y
almacenamiento tras retirar recursos pueden añadir cargos.

La reserva de USD 2,20 es una **asignación de planificación**, no una tarifa ni
un cálculo exacto de todos los servicios. Supone un piloto liviano: hasta 10.000
llamadas REST, 100.000 unidades Data API, 1 millón de I/O Aurora, 1 GB de logs
ingeridos, 5 GB S3 incluyendo versiones, 1 GB de salida y dos usuarios activos.
Debe incluir también Lambda, polling SQS, DynamoDB/PITR, Streams, KMS/secretos,
EventBridge, Cognito y transferencias. Si la medición supera la reserva, hay
que recalcular; no asignarles precio cero por tener sólo dos tenants.

Como referencias para verificar órdenes de magnitud: 10.000 solicitudes REST
a USD 3,50/millón cuestan USD 0,035; 100.000 unidades Data API a USD 0,35/millón,
USD 0,035; 1 millón de I/O Aurora a USD 0,20/millón, USD 0,20. Las unidades Data
API dependen del tamaño del payload: una llamada no equivale siempre a una unidad.

Los servicios restantes requieren cotización regional completa y medición:
la reserva no sustituye esas verificaciones. Con una rotación de la clave KMS
propia, se añade USD 1/mes; las dos primeras rotaciones aumentan su cargo.

## Escenarios de uso de Aurora

Referencia de cómputo: **USD 0,12/ACU-h**, 30 días. Las horas activas incluyen
pruebas, migraciones, reanudación, jobs y espera antes de pausar, no sólo el
tiempo que un usuario tiene abierta la pantalla.

| Horas activas por día | ACU media activa | Cómputo | Base planificada | Total orientativo |
|---|---:|---:|---:|---:|
| 2 | 0,5 | 3,60 | 6,00 | **9,60** |
| 2 | 1 | 7,20 | 6,00 | **13,20** |
| 4 | 1 | 14,40 | 6,00 | **20,40** |
| 8 | 1 | 28,80 | 6,00 | **34,80** |
| 24, sin pausa efectiva | 1 | 86,40 | 6,00 | **92,40** |

Estos totales abarcan el alcance del proyecto indicado, **no otros servicios de
la cuenta aún sin inventariar**. No son predicciones de escalado. El máximo
de 1 ACU no limita el gasto a USD 20. Para un mes de 31 días el cómputo aumenta
en proporción; no extrapolar automáticamente la tabla a la factura de octubre.

Con base USD 6 y sin otros cargos, quedan USD 14 para cómputo: unas 116,7 ACU-h
al mes, equivalentes a 3,89 horas/día a 1 ACU en un mes de 30 días. Esa cifra
es el punto de equilibrio, no un objetivo operativo: conviene mantener margen.

## Gasto existente: consulta de la cuenta

SSO renovado por el dueño; identidad verificada sin guardar Account ID en Git.
Cost Explorer se consultó desde el 2026-09-01 hasta el 2026-10-13 exclusivo,
con `UnblendedCost` agrupado por servicio/tipo de registro. Octubre es provisional
y puede tener retraso de facturación. No interpretar ausencia de cargos como
ausencia de uso o una proyección exacta.

| Servicio | Septiembre: consumo antes de créditos | Octubre 1–12: consumo provisional |
|---|---:|---:|
| EC2 Compute | 22,46 | 7,46 |
| EC2 Other | 3,92 | 1,23 |
| VPC | 7,20 | 2,15 |
| KMS | 0,40 | 0,39 |
| Secrets Manager | 0,16 | 0,15 |
| S3 | <0,01 | <0,01 |
| **Total consumo** | **34,14** | **11,38** |
| Créditos observados | **−21,19** | **0,00** |
| **Neto observado** | **12,95** | **11,38** |

Los totales se calcularon con valores completos antes de redondear. Impuestos
consultados: USD 0; eso no garantiza ausencia de impuestos futuros. Los créditos
no se usan para justificar el presupuesto sostenible del piloto.

Los cargos EC2/VPC corresponden a `us-east-2` (Ohio). Allí el inventario actual
mostró `averiq-web`, una `t3.small` en ejecución, un volumen `gp3` de 30 GiB
en uso y una IP elástica asociada. El historial facturado puede incluir recursos
anteriores: no se atribuye cada dólar al inventario actual sin más detalle.
No se apagó ni modificó el servicio legado.

En `us-east-1`, las stacks completas observadas son `CuentasPagarFoundation-dev`
y `CDKToolkit`. No hay clusters Aurora/RDS ni instancias EC2 en esa región.
El presupuesto **remoto vigente** no tiene filtros por aplicación: abarca
**toda la cuenta**. El código local ahora prepara el filtro por proyecto dev.

Una extrapolación simple del parcial de octubre da unos USD 28,44 por 30 días
sin recursos nuevos; no es el forecast oficial de AWS. Sumando el incremento
orientativo de un piloto a USD 13,20 y descontando USD 1,40 de fundación ya
incluida, el orden de magnitud combinado sería **USD 40,24/mes**. No sumar dos
veces la fundación. Tanto esa extrapolación como el piloto requieren validación
con medición real; lo verificable es que septiembre consumió USD 34,14 sin créditos.

**Decisión del dueño:** USD 20 para Cuentas a Pagar, con legado aparte. Por eso
el escenario del piloto se evalúa contra USD 20 y el costo combinado no se
presenta como costo del MVP. No se cambia el importe ni se autoriza un despliegue.

## Separación del presupuesto: preparación local

La fundación CDK prepara un `FilterExpression` que requiere simultáneamente
`Application=cuentas-pagar` y `Environment=dev`. Conserva USD 20 y las alertas
80% real / 100% proyectado. Es una modificación local: no actualizó AWS Budgets.

`ListCostAllocationTags` devolvió ambas claves en estado **Inactive**. Antes de
aplicar el filtro hay que activarlas en Billing y verificar que el gasto de la
fundación aparezca atribuido al proyecto. No considerar gasto cero del filtro
como evidencia de bajo consumo mientras falta atribución. La activación y la
disponibilidad de reportes pueden demorar; no se activaron automáticamente.
Revisar cargos compartidos/no etiquetables por separado: un filtro por tags no
garantiza cubrir absolutamente todos los cargos asociados al piloto.

## Disponibilidad de Aurora para la preparación local

La API RDS no devolvió Aurora PostgreSQL estándar 16.6 entre las versiones
disponibles para creación. Sí devolvió 16.15 con capacidad mínima 0 y opciones
`db.serverless` en `us-east-1`. Se actualizó **sólo el perfil MVP local** a 16.15,
manteniendo máximo 1 ACU y pausa de cinco minutos. No hay una base existente
que actualizar. El perfil expandido histórico no está autorizado para este piloto.
Data API/pausa efectiva y la integración de la aplicación aún requieren prueba
después del despliegue aprobado.

CDK emitió una advertencia porque su catálogo local de validación aún no lista
16.15. Se contrastó con `DescribeType` de CloudFormation: `EngineVersion` es
una cadena sin esa enumeración; RDS confirmó 16.15 y `db.serverless` disponibles.
La advertencia local no se oculta ni se toma como validación de una creación real.
Antes de desplegar se reconfirma disponibilidad regional.

## Diff remoto revisado sin cambios

Se ejecutó `cdk diff` sobre `CuentasPagarFoundation-dev` y
`CuentasPagarMvpData-dev`, con perfil MVP y `--change-set=template`. No se creó
un changeset. El diff mostró el filtro del presupuesto y outputs de referencia
en fundación; la stack de datos es nueva y agrega 16 recursos: VPC/subredes
aisladas, grupo de seguridad, secreto de base y attachment, parámetros/subnet
group RDS, cluster/writer Aurora y bucket/política S3. No agrega Proxy, NAT,
endpoints de interfaz ni IP pública. No incluye desplegar negocio o dominios.

El artefacto Lambda se reconstruyó y cargó sus módulos actualizados; compilación
y tres pruebas de infraestructura afectadas pasaron. No se ejecutaron pruebas
contra Aurora. La síntesis mantiene la advertencia de catálogo local explicada
arriba; no se oculta ni se presenta como una validación de runtime.

Propuesta de siguiente etapa, pendiente de confirmación: activar ambas claves
de atribución, verificar la fundación, actualizar su presupuesto por proyecto,
crear sólo la stack de datos MVP y aplicar/validar migraciones. El backend de
negocio, los envíos reales y el dominio quedan para una etapa posterior.

## Antes de pedir autorización para desplegar

1. Obtener aprobación para activar las etiquetas de costo, verificar atribución
   y actualizar el presupuesto de la fundación al alcance confirmado.
2. Reconfirmar disponibilidad de Aurora 16.15, Data API y pausa a 0 ACU al desplegar.
3. Revisar cotización completa con el tráfico esperado y el diff de las stacks
   MVP concretas. Sin `deploy --all`, Proxy, NAT o incremento de presupuesto.
4. Solicitar confirmación explícita sobre datos/negocio dev y costo revisado.
   Desplegar con jobs y consumidor del dispatcher desactivados.
5. Aplicar migraciones y verificar aislamiento, transacciones, idempotencia y
   pausa efectiva. Las pruebas locales no prueban esos comportamientos en AWS.
6. Completar la URL aprobada del botón YCloud, publicar `/p/{token}`, probar
   Mercado Pago de prueba y recién después activar avisos.

## Actualización 2026-10-14: etapa 1 desplegada

Con aprobación explícita del dueño se activaron las etiquetas de costo
`Application` y `Environment`, y se desplegaron `CuentasPagarFoundation-dev`
(filtro del presupuesto) y `CuentasPagarMvpData-dev` (16 recursos, idénticos al
diff revisado, sin Proxy, NAT ni endpoints). Aurora 16.15 quedó disponible con
0–1 ACU, pausa de 300 s y Data API. Las migraciones `001`–`008` se aplicaron y
una segunda ejecución las reconoció como registradas. Las etiquetas pueden
tardar hasta 24 horas en reflejarse: un gasto 0 en el filtro no prueba bajo
consumo. Pausa verificada el 2026-10-14: tras la última actividad (12:40), la
capacidad bajó a 0,5 ACU a las 12:45 y a 0 ACU a las 12:50, unos 10 minutos en
total. Pendientes: medir consumo real y probar
aislamiento, idempotencia y transacciones. Negocio, dominios y envíos siguen
sin desplegar y requieren una nueva aprobación.

Hasta esta actualización, la revisión no había desplegado recursos. El alcance
del presupuesto ya está resuelto; la aprobación de provisionamiento de negocio
y de cambios remotos de facturación adicionales sigue pendiente.

## Actualización 2026-10-15: validación contra Aurora

`npm run db:validate:aurora` (manual, solo `dev`, con SSO) crea dos tenants
sintéticos, ejecuta los chequeos y borra sus datos. Pasan 10 de 10: idempotencia
de proveedor y de pago (reintento y 5 pagos concurrentes con la misma clave
generan un único lote), rechazo de la misma clave con otro contenido, aislamiento
entre tenants (A no puede pagar ni ver datos de B), pago multi-factura con
total correcto y atomicidad (un lote con una factura inválida no paga ninguna).

La validación halló tres defectos que las pruebas con transporte simulado no
detectaban, ya corregidos con pruebas de regresión:

- `bigint` seguro viajaba como texto: Aurora rechazaba `OFFSET`/`LIMIT`.
  Ahora va como `longValue`.
- Columnas `uuid` (`string` + `dbType: UUID` en Prisma 7) viajaban sin
  `typeHint`: Aurora rechazaba `INSERT` y comparaciones.
- `PaymentBatchService` creaba `payment_items` con un `create` anidado que
  Prisma rechaza por la FK compuesta (lote, tenant): el flujo de pago no
  funcionaba con ningún motor. Ahora usa `createMany` en la misma transacción.

Con Aurora pausada, la primera operación puede fallar por la reanudación;
reintentar. Pendiente: medir el consumo real de ACU/costo de esta corrida.

## Fuentes públicas consultadas

- [Aurora: cómputo, almacenamiento, I/O, backup y Data API](https://aws.amazon.com/rds/aurora/pricing/).
- [Requisitos y límites de pausa automática](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html).
- [KMS: clave propia y rotaciones](https://aws.amazon.com/kms/pricing/).
- [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/).
- [CloudWatch: alarmas y logs](https://aws.amazon.com/cloudwatch/pricing/).
- [API Gateway REST](https://aws.amazon.com/api-gateway/pricing/).
- [Filtro de presupuesto](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-expression.html)
  y [activación de etiquetas de costo](https://docs.aws.amazon.com/us_en/awsaccountbilling/latest/aboutv2/activating-tags.html).
- [Lambda](https://aws.amazon.com/lambda/pricing/), [SQS](https://aws.amazon.com/sqs/pricing/),
  [S3](https://aws.amazon.com/s3/pricing/) y [CloudFront](https://aws.amazon.com/cloudfront/pricing/).
