# Ambientes y despliegue

## Estado actual

| Ambiente | Cuenta AWS | Estado | Uso permitido |
|---|---|---|---|
| `dev` | Cuenta actual, configurada por SSO | Activo | Desarrollo, pruebas técnicas y fundaciones compartidas de desarrollo. |
| `staging` | Cuenta independiente pendiente | No creado | Validación integrada previa a producción. |
| `prod` | Cuenta independiente pendiente | No creado | Datos reales y operación de clientes. |

La cuenta actual se considera exclusivamente `dev`. No se deben cargar datos reales de clientes, credenciales productivas ni habilitar cobros reales en ella.

## Aislamiento obligatorio

- Cada ambiente tendrá cuenta AWS, base de datos, buckets, claves KMS, secretos, colas, logs y presupuesto propios.
- Ninguna Lambda, rol IAM, secreto ni bucket se comparte entre ambientes.
- `develop` se despliega únicamente a `dev`.
- `main` se promueve primero a `staging` y luego a `prod`, con el mismo artefacto validado.
- El Account ID nunca se codifica en el repositorio; se inyecta sólo durante el comando de CDK.

## Dominios

- Producción web: `https://apagar.averiqsj.app`.
- Producción webhook YCloud: `https://apagar.averiqsj.com`.
- El webhook actual `https://apagar.averiq.cloud` se conserva hasta completar la migración y validación de YCloud.
- `dev` y `staging` no recibirán dominio público hasta que exista una API/web a probar. Se usarán inicialmente las URLs administradas por AWS o subdominios explícitamente aprobados.

## Perfil local y CDK

El acceso humano utiliza AWS IAM Identity Center (SSO), nunca access keys persistentes. La configuración local no se versiona. Usar `infra/deployment.env.example` como referencia.

Antes de un `cdk deploy` se deben cumplir todas estas condiciones:

1. `aws sso login --profile <perfil-del-ambiente>` exitoso.
2. `aws sts get-caller-identity --profile <perfil-del-ambiente>` confirma la cuenta esperada.
3. `cdk diff` revisado.
4. Para recursos con costo o impacto externo, aprobación explícita antes del despliegue.
5. Para producción, migraciones compatibles expand/contract, rollback de código definido y respaldo/PITR verificados.

## Costos de dev

`dev` tiene presupuesto mensual de USD 20, con alerta de gasto real al 80% y de proyección al 100%. Es una alarma, no un mecanismo que corta automáticamente el gasto.

Antes de crear Aurora, NAT Gateway, RDS Proxy, WAF o recursos de carga se revisará el costo estimado y se ajustará el presupuesto si corresponde.
