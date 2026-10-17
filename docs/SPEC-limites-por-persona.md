# SPEC — Límites mensuales por persona y por categoría

Estado: **propuesta, pendiente de aprobación del usuario.** No implementar hasta que esté aprobada.
Rama sugerida: `feat/limites-por-persona`. `main` queda estable para la demo del workshop.

## 1. Problema real que resuelve

En un equipo que reembolsa gastos, el organizador hoy tiene que recordar cuánto gastó cada persona en cada rubro. Los empleados no saben cuánto les queda hasta que alguien les dice "esto no te lo puedo devolver".

Herramientas como Ramp, Brex, Pleo o Expensify resuelven esto con **límites por persona y por categoría que se renuevan por período**.

Nosotros hacemos lo mismo para **reembolsos**:
- Cada persona ve **antes de gastar** cuánto le queda este mes en cada categoría.
- El agente interpreta el comprobante.
- El código aplica el límite.
- Un humano autoriza cada pago.

**Diferencia con una tarjeta corporativa, a explicar sin exagerar:** la tarjeta bloquea el gasto en el momento. Un reembolso se evalúa **después** de que el empleado pagó. Por eso:
- Mostramos el saldo disponible antes de gastar.
- Definimos qué pasa con el excedente: pago parcial más excepción.

## 2. Decisiones tomadas (17/10/2026)

| Tema | Decisión |
|---|---|
| Excedente sobre el límite | **Pago parcial + excepción.** Se propone reembolsar hasta lo que queda. El organizador puede autorizar el excedente como excepción, con motivo obligatorio que queda registrado. |
| Período | **Mensual**, por mes calendario de la **fecha del comprobante**, en hora de Argentina. |
| Límites | **Iguales para todo el equipo por categoría**, con **ajuste por persona** (override) que define el organizador. |

Decisiones que tomé yo, a confirmar:
- **Fechas válidas:** la regla "fechas del evento" se reemplaza por "antigüedad máxima del comprobante", 60 días por defecto. Con límites mensuales, un rango fijo de fechas deja de tener sentido.
- **Categorías configurables:** cada categoría tiene clave, nombre y una **descripción** que el agente usa para clasificar (por ejemplo, "Transporte: taxis, remises, colectivos, nafta para traslados de trabajo").
- **Wallet del empleado:** queda fijada en su perfil y solo la cambia el organizador. Ya no se escribe en cada solicitud, lo que evita que alguien desvíe un pago cambiando la dirección.
- **Privacidad:** cada colaborador ve solo sus propias solicitudes y sus límites. El organizador ve todo.
- **Presupuesto total** (saldo asignado a la wallet del agente): sigue siendo un tope duro.
- **Tope por comprobante:** pasa a ser opcional.

## 3. Modelo de datos

Es un piloto: no se migran datos viejos. Se sube la versión del esquema y `demo:reset` recrea todo.

```sql
team_policy(id=1, name, budget_cents, cap_per_receipt_cents NULL, max_receipt_age_days,
            policy_version, created_at, updated_at)

categories(key TEXT PK /* [a-z_] */, name, description, monthly_limit_cents, active)

members(id, name, role CHECK (role IN ('organizer','collaborator')),
        passcode_hash /* scrypt + salt */, wallet /* checksummed, NULL para organizer */,
        active, created_at, updated_at)

member_limits(member_id, category_key, monthly_limit_cents, PRIMARY KEY(member_id, category_key))

requests(+ member_id NOT NULL, + period TEXT /* 'YYYY-MM' derivado de receipt_date */)
         -- recipient = members.wallet al momento de presentar

authorizations(+ member_id, + category_key, + period,
               + requested_cents /* importe del ticket */,
               + approved_cents  /* lo que se paga */,
               + within_limit_cents, + exception_cents, + exception_reason)
         -- amount_cents pasa a ser approved_cents
```

## 4. Reglas deterministas (código, no IA)

**Límite vigente** de un miembro en una categoría:
- Se usa `member_limits` si hay un override para esa persona.
- Si no, se usa `categories.monthly_limit_cents`.

**Consumido** de un miembro, una categoría y un mes:
- Suma de `approved_cents` de autorizaciones **no revocadas** (pendientes, pagando, inciertas o pagadas) con ese `member_id`, `category_key` y `period`.
- No cuentan las revocadas ni los pagos `failed`.

**Disponible** = `max(límite − consumido, 0)`.

Al evaluar una solicitud con importe `I`, categoría `C` y período `P`:

| Caso | Recomendación | Propuesta de pago |
|---|---|---|
| `I ≤ disponible` | la que corresponda (approve, needs_info, etc.) | `I` |
| `0 < disponible < I` | **`partial`** (nueva) | `disponible`. Excedente `I − disponible` solo como excepción. |
| `disponible = 0` | **`over_limit`** (nueva) | nada dentro del límite. Todo solo como excepción. |

Prioridades:
- `reject` (fuera de política) y `flag_review` (duplicado o instrucciones sospechosas) siguen teniendo prioridad sobre `partial` y `over_limit`.
- `needs_info` también tiene prioridad, porque sin categoría o importe no se puede calcular el límite.

Al **autorizar**, el organizador elige una de estas opciones:
1. **Pagar dentro del límite:** `approved = min(I, disponible)`.
2. **Pagar el total como excepción:** `approved = I`, `exception_cents = I − disponible` y motivo obligatorio. La excepción **sí consume** límite, porque es gasto real del mes; el disponible puede quedar en 0.
3. **Rechazar.**

Validación y binding:
- Todo se revalida dentro de `BEGIN IMMEDIATE`: límite, presupuesto total y tope por comprobante.
- El binding de la autorización incluye `approved_cents`, `recipient`, token, red, `request_id`, `file_sha256`, `member_id`, `category_key` y `period`.
- Si cambia cualquiera de esos valores, incluida la wallet del miembro, la autorización se revoca (igual que hoy).

Cambios de política o límites:
- Generan una nueva `policy_version` y quedan en el `audit_log`.
- **No revocan** autorizaciones ya dadas: se respetan las decisiones tomadas.
- Las solicitudes todavía no autorizadas se re-evalúan con los valores nuevos, y la UI muestra "re-evaluada con la política v{n}".

Una solicitud pagada parcialmente queda `reimbursed`. La UI muestra "Reembolsado $ X de $ Y", y el excedente no pagado no se puede volver a presentar.

## 5. Agente (IA)

No cambia su rol.
- Recibe la lista de categorías activas **con sus descripciones**, y el `enum` del schema se arma dinámicamente con esas claves más `otra` e `indeterminada`.
- **No** recibe ni calcula límites ni saldos.
- La explicación final combina el texto del agente con las reglas deterministas. Por ejemplo: "Te quedan $ 500 de $ 2.000 en transporte este mes: se propone reembolsar $ 500".

## 6. Interfaz

- **Login:** elegir persona y su passcode personal.
- **Colaborador:**
  - **"Mis límites"** arriba de todo: por categoría, límite, usado y disponible del mes, con barra.
  - "Presentar gasto": ya no pide wallet; muestra "Se paga a tu wallet 0x…".
  - "Mis solicitudes": solo las propias.
- **Organizador:**
  - **"Equipo":** miembros (alta, baja, wallet, passcode), categorías con descripción y límite mensual, overrides por persona, y tabla de uso del mes por persona y categoría.
  - **"Revisar gasto":** la caja de autorización muestra límite, usado, disponible, la propuesta (pago completo o parcial) y el botón de excepción con motivo.
  - **"Resumen":** presupuesto total y wallet del agente, como hoy.

## 7. Tests obligatorios

1. Límite efectivo: override > categoría, y el override aplica solo a esa persona.
2. Consumido por mes: un comprobante de septiembre no consume el límite de octubre, y viceversa.
3. Las tres ramas: completo, `partial` y `over_limit`.
4. Autorizar parcial paga `disponible` y el binding queda con `approved_cents = disponible`.
5. Excepción sin motivo → rechazada. Con motivo → `approved = I` y el disponible queda en 0.
6. Concurrencia: dos autorizaciones simultáneas del mismo miembro y categoría no superan el límite sin excepción.
7. Cambiar la wallet del miembro con una autorización pendiente → se revoca.
8. Cambiar límites no revoca autorizaciones dadas y re-evalúa las pendientes.
9. Un colaborador no ve ni accede a solicitudes ni comprobantes de otro (página y ruta del archivo).
10. Antigüedad: comprobante de hace 61 días → `reject`.
11. Siguen pasando todos los tests existentes de doble pago, reconciliación y presupuesto.

## 8. Demo

- **Equipo:** Ana y Bruno (colaboradores) y Organizador.
- **Categorías:**
  - Transporte: $ 2.000 por mes.
  - Materiales: $ 1.500 por mes.
- **Override:** Ana en transporte, $ 3.000.
- **Presupuesto total:** 5.000 wARS.

Guion:
1. Bruno, remís de $ 1.500 → **aprobar**, dentro del límite. Le quedan $ 500.
2. Bruno, ticket ambiguo → **pide aclaración**.
3. Bruno sube de nuevo el ticket del remís → **duplicado**.
4. Bruno, otro remís de $ 1.200 (comprobante nuevo `04-excede.png`) → **parcial**: se propone $ 500 y $ 700 quedan como excepción.
5. Ana ve su propio saldo y no ve las solicitudes de Bruno.

## 9. Fuera de alcance

- Emisión de tarjetas.
- Pre-aprobación de gastos antes de hacerlos.
- Varios niveles de aprobación.
- Límites por comercio.
- Otras monedas.
- Integración contable.
- Pago automático sin aprobación.
