# Plantillas YCloud de suscripción

Datos informados por el dueño el 2026-10-05. Las tres plantillas Utility están
activas en YCloud, idioma Spanish (ARG), código `es_AR`. Emisor de dev:
`+5492646276709`. Este registro no activa el dispatcher ni modifica plantillas
en YCloud; no contiene credenciales.

## Textos recibidos

### subscription_renewal_reminder

Marca informada: `A PAGAR SaaS`.

```text
Recordatorio: tu plan {{plan}} vence el {{fvto}}. Podrás renovarlo antes de esa fecha para mantener el servicio activo.
```

### subscription_payment_link_v2

Marca informada: `A Pagar SaaS`.

```text
Tu renovación del plan {{plan}}vence hoy. Tenés 48 horas de gracia para realizar el pago.
```

Botón confirmado: **Pagar Renovación**. URL y marcador variable: pendientes.
Se conserva la falta de espacio entre `{{plan}}` y `vence` tal como se recibió;
no se corrige ni se cambia una plantilla aprobada desde este repositorio.

### subscription_payment_confirmed

Marca informada: `A Pagar SaaS`.

```text
Confirmamos el pago de tu renovación. Tu plan {{plan}} estará activo hasta el {{fvto}} .
```

Los bloques registran el texto recibido sin las comillas usadas para delimitarlo
en el mensaje. La marca se registra por separado: falta comprobar si figura como
header estático, footer o parte del cuerpo en la plantilla aprobada. No se
inyecta como variable `businessName`.

## Mapeo de negocio

| Intención | Variables recibidas, en orden | Valores del dispatcher |
|---|---|---|
| `SUBSCRIPTION_RENEWAL_REMINDER` | `plan`, `fvto` | `planName`, `endsAt` |
| `SUBSCRIPTION_PAYMENT_LINK` | `plan` | `planName` |
| `SUBSCRIPTION_PAYMENT_CONFIRMED` | `plan`, `fvto` | `planName`, `endsAt` |

`planName` corresponde a Básico, Profesional o Ultra. En el recordatorio,
`endsAt` es el vencimiento de la suscripción vigente. En la confirmación,
es el nuevo vencimiento generado por la conciliación del pago, nunca la fecha
de caducidad del Checkout. Las fechas se muestran con formato `es-AR` y zona
`America/Argentina/Buenos_Aires`. Los cuerpos informados no requieren importe,
nombre del tenant ni vencimiento del enlace.

El dueño confirmó que `{{plan}}` y `{{fvto}}` son los nombres literales de las
variables. En reminder, `fvto` es el vencimiento del mes vigente; en confirmed,
el vencimiento del mes renovado. El cliente ya genera `parameter_name: "plan"`
y `parameter_name: "fvto"`, con sus valores, para los parámetros del cuerpo.
El valor del botón se envía por separado y no lleva estos nombres.

Los cuerpos reutilizables están en `confirmedSubscriptionBodyBindings`. Se
conserva el soporte de contratos posicionales existentes, pero un mismo cuerpo
no puede mezclar formatos ni repetir nombres. Todavía no se instala el contrato
completo del dispatcher porque la URL aprobada del botón está pendiente.

## Datos pendientes para configurar envíos

1. URL **exacta aprobada** del botón, incluido su marcador variable. No inferir
   el prefijo a partir del texto «Pagar Renovación». El contrato actual admite
   un botón URL dinámico en índice 0, cuyo parámetro sea sólo el token opaco
   o `p/` seguido del token.

No se creó un `YCLOUD_SUBSCRIPTION_TEMPLATE_BINDINGS` operativo con estos datos
incompletos. El idioma y el mapeo semántico están confirmados; el transporte
completo sigue pendiente. No enviar mensajes de prueba hasta completar el
contrato y tener el backend, dominio y destinatario autorizado preparados.

Referencias del proveedor: [parámetros nombrados y posicionales](https://www.ycloud.com/es/blog/whatsapp-api-message-template-mechanics)
y [componentes y botones URL](https://docs.ycloud.com/reference/whatsapp-messaging-examples).
