# MVP con dos tenants testigos

Actualización de alcance: 2026-10-01. El dueño quiere mostrar un MVP a los dos
tenants relevados y necesita un presupuesto más económico. La propuesta de
Aurora permanente + RDS Proxy + NAT **no está aprobada para este MVP**.
No se desplegaron recursos, no se cambiaron secretos y no se hicieron commits.

**Decisión confirmada por el dueño:** objetivo de **USD 20/mes en AWS**, para
el conjunto del ambiente, incluidos los recursos existentes. YCloud/WhatsApp
queda fuera de ese monto. Confirmar este objetivo no autoriza un despliegue:
se revisará la propuesta implementada y su costo antes de crear recursos.

## Propuesta recomendada para evaluar

Mantener AWS, PostgreSQL y las reglas de dominio existentes, con:

- Aurora PostgreSQL Serverless v2 con mínimo **0 ACU**, máximo acotado y pausa
  automática tras cinco minutos sin actividad, en una versión/región compatibles.
- **Data API** para acceder por HTTPS desde Lambdas fuera de la VPC. La base
  permanece privada. Sin RDS Proxy, NAT ni endpoints privados de interfaz para
  esas Lambdas.
- Notificaciones disparadas por eventos y ejecuciones programadas puntuales.
  Eliminar el polling de base cada minuto; una consulta frecuente la mantendría
  despierta. Conservar reservas/idempotencia, y programar reintentos acotados.
- Un único ambiente de demostración, dos tenants aislados y sus administradores;
  no duplicar infraestructura por tenant. Conservar precios por servidor y
  conciliación verificada; usar Mercado Pago de prueba durante la demostración.
- S3 privado, retención de logs breve y las alarmas necesarias para el piloto.
  Revisar límites de concurrencia y almacenamiento antes de habilitar tráfico.

## Estimación preliminar, no cotización ni tope de gasto

La cantidad de tenants no determina por sí sola el costo: cuentan las horas
activas y la capacidad media. Con Aurora Standard a USD 0,12/ACU-h en
`us-east-1`, para 30 días:

| Horas activas diarias | Capacidad media mientras está activa | Cómputo USD/mes |
|---|---|---:|
| 2 | 0,5 ACU | 3,60 |
| 2 | 1 ACU | 7,20 |
| 4 | 1 ACU | 14,40 |
| 8 | 1 ACU | 28,80 |

Son escenarios de cálculo, no predicciones de escalado. Incluyen en las horas
activas el uso, la reanudación, jobs y la espera antes de pausar. Durante la pausa
no se factura cómputo, pero siguen almacenamiento y otros recursos.

El objetivo confirmado es **USD 20/mes AWS**. Los escenarios anteriores deben
evaluarse junto con el resto de cargos para comprobar si caben en ese monto.
Sumar almacenamiento, I/O, KMS, secretos, logs/alarmas, solicitudes y transferencias.
Los recursos ya existentes también cuentan. No asumir créditos ni free tier.
YCloud/WhatsApp se cotiza por separado; el presupuesto AWS no los cubre.
Con uso prolongado o consultas continuas, el objetivo puede excederse.

Data API cobra por solicitudes y volumen del payload; la referencia publicada
para el primer escalón es USD 0,35 por millón de unidades de solicitud. No es el
principal costo esperado para dos tenants, pero hay que medirlo.

Fuentes consultadas:

- [Pausa automática y requisitos de Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html).
- [Acceso por Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html).
- [Precios Aurora y Data API](https://aws.amazon.com/rds/aurora/pricing/).
- [Catálogo regional AmazonRDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json).

## Impacto sobre lo ya implementado

La configuración preparada de negocio usa PrismaPg, conexión TCP y Proxy.
**Todavía no implementa esta alternativa económica.** Cambiar sólo la capacidad
de Aurora o eliminar el Proxy no alcanza: hay que adaptar el acceso a datos y
las transacciones a Data API y verificar todas las garantías de idempotencia.
Se conservan el esquema PostgreSQL, las migraciones y las reglas de dominio.

También hay que adaptar el transporte del dispatcher a eventos, el runner de
migraciones y los permisos IAM de las Lambdas. La pausa exige reintentos:
AWS indica una reanudación típica de aproximadamente 15 segundos, y a veces más.
Para demostrar sin espera inicial, abrir/probar la aplicación antes de la reunión;
esa preparación también genera consumo normal.

Antes de desplegar: terminar y probar la adaptación,
revisar una cotización concreta y obtener la autorización explícita del dueño.
La aprobación de costos anterior sigue pendiente; este documento no autoriza
provisionamiento ni aumenta el presupuesto de AWS.

## Protección de la configuración local

El punto de entrada CDK usa por defecto `infrastructureProfile=mvp`. Por ahora
ese perfil sólo sintetiza fundación e ingress existente: **no crea ni representa
un backend MVP terminado**. Mientras Data API no esté conectado, solicitar
`enableBusiness=true` falla con una explicación; no agrega Proxy o NAT como
reemplazo automático.

La configuración expandida se conserva para referencia y pruebas, pero exige
`infrastructureProfile=expanded`. Seleccionarla no concede aprobación de costos.
Esta protección modifica la selección local de stacks y no elimina stacks ni
recursos que ya existan en AWS. El presupuesto de USD 20 alerta; no corta el gasto.
