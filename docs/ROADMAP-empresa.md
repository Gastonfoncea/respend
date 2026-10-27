# Respend para empresas — plan de trabajo

Objetivo: pasar de la demo del workshop (una laptop, SQLite y un túnel) a una app usable por una empresa, con URL pública, login y gastos separados por evento y categoría.

Cada paso va en su propia rama y su propio PR. Un paso se tacha recién cuando está mergeado y probado.

## 1. Paridad en Vercel + Supabase

La app hace lo mismo que hoy, pero corre en la nube.

- [x] Crear el proyecto de Supabase (Postgres + Storage) y el de Vercel.
- [x] Pasar el esquema de SQLite a Postgres (migración SQL versionada).
- [x] Hacer `async` las funciones de `lib/repo.ts` y `lib/workflow.ts`.
- [x] Rehacer en Postgres el bloqueo de pagos (que no se pague dos veces) y el índice único de pagos.
- [x] Guardar las fotos de los tickets en Supabase Storage (bucket privado) en vez de `data/`.
- [x] Correr los tests sobre PGlite (Postgres en memoria): siguen sin red ni IA.
- [ ] Variables de entorno en Vercel. La clave del agente va como variable secreta y se sigue leyendo solo en `lib/chain/signer.ts`.
- [ ] Deploy y prueba desde el celular, sin túnel: un gasto simulado y después uno real en mainnet (con autorización).
- [x] Actualizar `docs/WORKSHOP.md` y `CLAUDE.md`.

## 2. Login con roles

- [x] Supabase Auth con mail y contraseña (el enlace mágico necesita un SMTP propio y Google, credenciales de Google Cloud: se suman después).
- [x] Roles organizador y colaborador por persona. Reemplaza los códigos compartidos. Alta por invitación desde "Equipo".
- [x] Cada gasto queda atado a un usuario real; el perfil (nombre y wallet) pasa a ser por usuario. La wallet la fija el organizador.
- [x] Permisos en el servidor; cada colaborador ve solo lo suyo. RLS activado sin políticas: solo el servidor accede a las tablas.

## 3. Eventos

- [x] Crear y editar presupuestos (un evento o un mes): nombre, fechas y máximo por ticket del pago automático. La política general (tope por ticket y presupuesto total) queda aparte.
- [x] Separar gastos, saldo y pago automático por presupuesto y por persona (asignaciones).
- [x] El colaborador elige el presupuesto al presentar y ve "Mis presupuestos"; el organizador, la lista y el detalle.

## 4. Categorías y límites

- [x] Crear y editar categorías, con una descripción que usa el agente para clasificar.
- [x] Asignación por persona con categoría opcional (`docs/SPEC-limites-por-persona.md`). La caja del owner: pagar, hasta el saldo o excepción con motivo.
- [x] El colaborador ve cuánto le queda antes de gastar (inicio y vista previa).
- [x] El agente usa las categorías activas (y sus descripciones) al leer el ticket.

## Reglas que se mantienen

- Ninguna transacción real sin autorización explícita.
- La IA nunca decide pagar: lo deciden el código o una persona.
- Dinero en enteros (centavos y wei), nunca floats.
