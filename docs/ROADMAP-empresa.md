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

- [ ] Crear y editar eventos: nombre, fechas, presupuesto y política.
- [ ] Separar gastos, presupuesto y pago automático por evento.
- [ ] Selector de evento para organizador y colaborador.

## 4. Categorías y límites

- [ ] Crear y editar categorías (hoy están fijas: transporte y materiales).
- [ ] Límites por categoría y ajuste por persona (base: `docs/SPEC-limites-por-persona.md`).
- [ ] El colaborador ve cuánto le queda antes de gastar.
- [ ] El agente usa las categorías del evento al leer el ticket.

## Reglas que se mantienen

- Ninguna transacción real sin autorización explícita.
- La IA nunca decide pagar: lo deciden el código o una persona.
- Dinero en enteros (centavos y wei), nunca floats.
