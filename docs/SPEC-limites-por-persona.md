# SPEC — Presupuesto por evento y por persona, con pago automático

Estado: **modelo aprobado por el usuario el 18/10/2026.** Falta implementar.
Reemplaza la versión anterior de esta spec (límites mensuales por categoría, un humano autoriza cada pago).

Rama: `feat/limites-por-persona`. Se implementa **después** de la migración a Vercel + Supabase (`feat/vercel-supabase`, ver `docs/ROADMAP-empresa.md`). El SQL de §3 es orientativo: se escribe en Postgres sobre el esquema migrado.

Contexto de mercado y por qué este modelo: `reports/Valor real de Respend.md`.

---

## 1. Caso de uso

> El owner aprueba **una vez, por adelantado**, asignando presupuesto a cada persona. Después, cada comprobante que entra en ese presupuesto se paga solo y al instante. Lo que no entra, lo decide el owner.

Ejemplo:
1. Ana (owner) crea el presupuesto "Meetup 25/10", del 20/10 al 27/10, con pago automático hasta $ 50.000 por ticket.
2. Le asigna a Juan $ 80.000 (categoría opcional: catering).
3. Juan ve "Tenés $ 80.000 para catering del Meetup 25/10".
4. Juan gasta de su bolsillo y manda la foto del ticket por $ 42.000.
5. El código valida todo (§4.2) y el reintegro sale solo: "Cobraste $ 42.000. Te quedan $ 38.000".
6. Si algo no cierra, no se paga nada solo: va a Ana, que elige entre tres opciones (§4.3).

**Diferencia con Ramp, a explicar sin exagerar:** Ramp bloquea el gasto en el momento con una tarjeta. Respend sigue siendo un reintegro: el colaborador pone la plata. Lo que cambia es que sabe de antemano cuánto puede gastar y cobra al instante.

## 2. Decisiones (18/10/2026)

| Tema | Decisión |
|---|---|
| Unidad de presupuesto | **Presupuesto = evento con nombre y fechas.** Un mes es un presupuesto más ("Octubre 2026"). Lo recurrente queda para después. |
| Asignación | Presupuesto + persona + monto, **categoría opcional**. Sin categoría, vale para cualquier gasto dentro de la política. |
| Aprobación humana | La asignación **es** la aprobación. Dentro de ella, el pago es automático. |
| Máximo por ticket | **Uno por presupuesto.** Un ticket por encima de ese monto **requiere aprobación** del owner, aunque entre en el saldo. (Un modo "pagá y avisame" queda para después.) |
| Tope de 24 h | **Se mantiene** como freno de seguridad de la wallet del agente (`getAutoPayDailyCap`). |
| Ticket que supera el saldo | **El código nunca paga parcial.** Va entero al owner con tres opciones: pagar hasta el saldo, pagar todo como excepción con motivo, o rechazar. |
| Intervención humana | Igual que hoy: si un humano ya intervino en la solicitud, no se paga sola. |

Decisiones heredadas de la versión anterior, que siguen en pie:
- **Wallet del colaborador** fijada en su perfil; solo la cambia el organizador. Ya no se escribe en cada solicitud.
- **Privacidad:** cada colaborador ve solo sus solicitudes y sus asignaciones. El organizador ve todo.
- **Presupuesto total** (saldo de la wallet del agente): sigue siendo un tope duro.
- **Categorías configurables** con clave, nombre y una descripción que el agente usa para clasificar.

## 3. Modelo de datos (orientativo, en Postgres)

Es un piloto: no se migran datos viejos de la demo.

```sql
budgets(id, name, starts_on DATE, ends_on DATE,
        autopay_max_per_receipt_cents /* 0 = sin pago automático */,
        status CHECK (status IN ('open','closed')), created_by, created_at, updated_at)

categories(key PK /* [a-z_] */, name, description, active)

members(id, name, role CHECK (role IN ('organizer','collaborator')),
        wallet /* checksummed, NULL para organizer */, active, created_at, updated_at)
        -- el login lo resuelve el paso 2 del roadmap (Supabase Auth)

assignments(id, budget_id, member_id, category_key NULL, amount_cents,
            created_by, created_at, updated_at,
            UNIQUE NULLS NOT DISTINCT (budget_id, member_id, category_key))
            -- category_key NULL = "cualquier categoría"; una sola asignación sin categoría por persona y presupuesto

requests(+ budget_id NOT NULL, + member_id NOT NULL, + assignment_id NULL)
         -- recipient = members.wallet al momento de presentar

authorizations(+ assignment_id, + requested_cents /* importe del ticket */,
               + approved_cents /* lo que se paga */, + exception_cents, + exception_reason,
               + mode CHECK (mode IN ('auto','full','up_to_balance','exception')))
               -- amount_cents pasa a ser approved_cents
```

## 4. Reglas deterministas (código, nunca la IA)

### 4.1 Saldo de una asignación

- **Consumido** = suma de `approved_cents` de autorizaciones **no revocadas** (pendientes, pagando, inciertas o pagadas) de esa asignación. No cuentan las revocadas ni los pagos `failed`.
- **Disponible** = `max(amount_cents − consumido, 0)`.
- A qué asignación va un ticket: la de la categoría que leyó el agente, si existe; si no, la asignación sin categoría de esa persona. Si no hay ninguna, `needs_review` con "No tenés presupuesto asignado para esto".

### 4.2 Pago automático

Reemplaza la condición `amount_cents ≤ getAutoPayLimitCents` de `autoAuthorize` (`lib/workflow.ts`). Se paga solo **si y solo si se cumple todo**:

1. `status = analyzed` y `recommendation = approve` (sin alertas).
2. Ningún humano intervino en la solicitud (`humanIntervened`, igual que hoy).
3. Pasa `hardLimitError` (política, fechas dentro del presupuesto, presupuesto total).
4. El presupuesto está `open` y la fecha del ticket está entre `starts_on` y `ends_on`.
5. `importe ≤ disponible` de la asignación.
6. `importe ≤ autopay_max_per_receipt_cents` del presupuesto.
7. Entra en el tope de 24 h del agente.

Si falla cualquiera, no se paga nada solo, queda en el `audit_log` cuál falló y la solicitud va al owner. La IA no recibe ni calcula saldos.

### 4.3 Decisión del owner

Cuando la solicitud llega al owner, la caja de autorización muestra: importe, asignación, consumido, disponible, máximo por ticket y el motivo por el que no se pagó sola. Opciones:

| Opción | Cuándo aparece | Se paga | Registro |
|---|---|---|---|
| **Pagar** | importe ≤ disponible | importe | `mode = full` |
| **Pagar hasta el saldo** | 0 < disponible < importe | disponible | `mode = up_to_balance`; el resto no se puede volver a presentar |
| **Pagar todo como excepción** | importe > disponible | importe | `mode = exception`, `exception_cents = importe − disponible`, **motivo obligatorio** |
| **Rechazar** | siempre | nada | motivo opcional |

La excepción **sí consume** saldo; el disponible queda en 0, nunca negativo.

### 4.4 Validación, binding y concurrencia

- Todo se revalida dentro de la transacción con bloqueo (hoy `BEGIN IMMEDIATE`; en Postgres, `SELECT … FOR UPDATE` sobre la asignación).
- El binding incluye `approved_cents`, `recipient`, token, red, `request_id`, `file_sha256`, `member_id`, `assignment_id` y `mode`.
- Si cambia cualquiera de esos valores, incluida la wallet del miembro, la autorización se revoca (igual que hoy).
- **Bajar** una asignación no revoca autorizaciones ya dadas; las solicitudes no autorizadas se re-evalúan y la UI muestra "re-evaluada".

## 5. Agente (IA)

No cambia su rol: lee el ticket, clasifica y explica.
- Recibe las categorías activas con sus descripciones; el `enum` del schema se arma con esas claves más `otra` e `indeterminada`.
- **No** recibe ni calcula saldos ni límites.
- La explicación final combina su texto con las reglas: "Ticket de Panadería X, catering. Te quedan $ 38.000 de $ 80.000 para catering."

## 6. Interfaz

- **Colaborador:**
  - **"Mis presupuestos"** arriba de todo: por presupuesto y categoría, asignado, usado y disponible, con barra, y "Pago automático hasta $ X por ticket".
  - "Presentar gasto": elige el presupuesto (por defecto, el abierto), no pide wallet: "Se paga a tu wallet 0x…". La vista previa del agente dice antes de enviar si se va a pagar solo y, si no, por qué.
  - "Mis solicitudes": solo las propias.
- **Organizador:**
  - **"Presupuestos":** crear y cerrar, fechas, máximo por ticket. Dentro, las asignaciones por persona y categoría, con su uso.
  - **"Equipo":** miembros, wallet y categorías.
  - **"Revisar gasto":** la caja de §4.3.
  - **"Resumen":** presupuesto total, wallet del agente y tope de 24 h, como hoy.

## 7. Tests obligatorios

1. Saldo: consumido suma autorizaciones no revocadas y no cuenta revocadas ni `failed`.
2. Asignación con categoría tiene prioridad sobre la asignación sin categoría.
3. Pago automático: pasa con todo OK, y falla por separado con cada una de las 7 condiciones de §4.2 (con su entrada en el `audit_log`).
4. Ticket mayor al máximo por ticket pero dentro del saldo → va al owner.
5. Ticket mayor al saldo → nunca se paga parcial solo.
6. "Pagar hasta el saldo" paga `disponible` y el binding queda con `approved_cents = disponible`.
7. Excepción sin motivo → rechazada. Con motivo → `approved = importe` y el disponible queda en 0.
8. Concurrencia: dos pagos automáticos simultáneos de la misma asignación no superan el saldo.
9. Presupuesto cerrado o ticket fuera de fechas → no se paga solo.
10. Cambiar la wallet con una autorización pendiente → se revoca.
11. Un colaborador no ve ni accede a solicitudes, comprobantes ni asignaciones de otro.
12. Siguen pasando los tests existentes de doble pago, reconciliación, tope de 24 h e intervención humana.

## 8. Demo

- **Presupuesto:** "Meetup 25/10", pago automático hasta $ 50.000 por ticket.
- **Asignaciones:** Juan $ 120.000 (catering), Sofi $ 30.000 (sin categoría).

Guion:
1. Juan, ticket de $ 42.000 → **se paga solo**. Le quedan $ 78.000.
2. Juan sube de nuevo el mismo ticket → **duplicado** (como hoy).
3. Sofi, ticket de $ 45.000 → **supera su saldo**: va al owner, que elige "pagar hasta el saldo" ($ 30.000).
4. Juan, ticket de $ 60.000 → entra en su saldo pero **supera el máximo por ticket**: va al owner, que lo paga.
5. Sofi ve su saldo y no ve las solicitudes de Juan.

## 9. Fuera de alcance

- Tarjetas, adelantos y pago directo al proveedor.
- Presupuestos recurrentes (mensuales automáticos).
- Modo "pagá y avisame" por encima del máximo por ticket.
- **Validación con ARCA** (descartada por ahora, 18/10): leer el QR de la factura electrónica, comparar importe y fecha con lo que leyó el agente, detectar duplicados por número de comprobante y, más adelante, constatar contra el web service de ARCA. Mientras tanto, los duplicados se detectan como hoy (archivo y datos del ticket).
- Varias monedas o activos de pago (USDC/USDT, "pagado fuera de la cadena").
- Rendición exportable para sponsors.
- Fondos en la Safe del organizador con módulo de allowance.
- Varios niveles de aprobación.
