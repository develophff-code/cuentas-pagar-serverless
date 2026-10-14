# Reglas del proyecto — Cuentas a Pagar Serverless

## Plan rector

- El **plan maestro de arquitectura** es
  [PLAN_ARQUITECTURA_AWS_SERVERLESS_CUENTAS_A_PAGAR.md](PLAN_ARQUITECTURA_AWS_SERVERLESS_CUENTAS_A_PAGAR.md).
  Toda decisión de arquitectura debe alinearse con él.
- El estado actual y las restricciones vigentes se toman de:
  - [README.md](README.md)
  - [docs/MVP_DOS_TENANTS.md](docs/MVP_DOS_TENANTS.md)
  - [docs/DESPLIEGUE_FASE_C.md](docs/DESPLIEGUE_FASE_C.md)
  - [docs/COSTOS_MVP_FASE_C.md](docs/COSTOS_MVP_FASE_C.md)
- Si el plan y el estado actual difieren, no improvisar: señalar la diferencia
  y pedir una decisión al dueño.

## Perfil de infraestructura MVP (obligatorio)

CDK usa por defecto `infrastructureProfile=mvp`. Respetar siempre:

- Aurora PostgreSQL Serverless v2 **16.15**, capacidad **0–1 ACU**, pausa
  automática tras cinco minutos, acceso por **Data API**.
- **Sin RDS Proxy** y **sin NAT Gateway** (tampoco endpoints de interfaz ni
  nueva clave KMS de costo fijo). Lambdas **fuera de la VPC**.
- **Tope objetivo de USD 20/mes en AWS** para el proyecto dev, incluida su
  fundación. El legado de Ohio y YCloud/WhatsApp se presupuestan aparte.
  El presupuesto alerta; no corta el gasto.
- Sin polling de base cada minuto: usar eventos, SQS y ejecuciones puntuales.
- Un único ambiente de demostración con dos tenants aislados; no duplicar
  infraestructura por tenant. Mercado Pago de prueba en la demo.
- `infrastructureProfile=expanded` (Aurora permanente, RDS Proxy, NAT) solo con
  selección explícita y aprobación del dueño; no forma parte del MVP.
- No asumir créditos ni free tier en las estimaciones de costo.

## Despliegues y costos

- **Nunca desplegar ni crear recursos AWS con costo sin confirmación explícita
  previa del dueño.** Confirmar el objetivo de USD 20 no autoriza un despliegue.
- Antes de proponer un despliegue: verificar identidad AWS, ejecutar
  `cdk diff`, presentar el costo concreto y el impacto externo, y esperar
  aprobación.
- Prohibido `cdk deploy --all`; desplegar stacks puntuales y aprobados.
- `cdk synth`, pruebas locales y `npm run db:migrations:plan` son seguros
  (no crean recursos).
- No modificar el servicio legado de `averiq.cloud` ni el webhook YCloud
  existente hasta la migración aprobada.
- La cuenta AWS actual es solo `dev` (`us-east-1`).

## Seguridad y flujo de trabajo

- No guardar contraseñas, URLs de base, credenciales AWS ni secretos de YCloud
  o Mercado Pago en archivos ni en Git.
- **Git es siempre manual:** `git add`, `git commit` y `git push` los ejecuta
  únicamente el dueño. Nunca correrlos, ni siquiera "para ayudar". Al terminar
  un cambio, solo proponer el texto del commit.
- Mantener actualizada la documentación cuando cambie el alcance o el costo.
