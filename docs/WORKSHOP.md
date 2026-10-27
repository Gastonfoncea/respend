# Respend — guía para el workshop

## 1. En una frase

**"Subí el comprobante. El agente lo lee, lo contrasta con la política y te reembolsa en wARS sobre Celo: paga solo los gastos chicos y sin alertas, y el resto lo aprueba el organizador."**

## 2. El problema (de la vida real)

En equipos cripto chicos de LatAm, organizar un meetup implica gastos chicos y frecuentes: remises, fibrones, impresiones. Alguien los paga de su bolsillo y después rinde así:

1. Manda fotos de tickets por WhatsApp.
2. El organizador revisa a mano si el gasto entra en la política y si queda presupuesto.
3. Transfiere y lo anota en una planilla.

El resultado: es lento, se pierden comprobantes, se paga dos veces el mismo ticket y nadie sabe cuánto presupuesto queda. Encima, el organizador pierde tiempo aprobando gastos de $ 100.

> No decir que Ripio, Twin u otra empresa usa este proceso: no está confirmado. Son el tipo de organización a la que queremos entrevistar.

## 3. Cómo funciona

1. **El organizador define la política del evento:**
   - Categorías permitidas (transporte, materiales) y fechas válidas.
   - Tope por comprobante ($ 2.000) y presupuesto total ($ 5.000).
   - En la sección **Agente**, hasta cuánto paga solo el agente: por gasto (por defecto $ 100) y en total en 24 h (por defecto 3 veces eso).
2. **El organizador** agrega al colaborador en **Equipo** con su wallet de cobro. **El colaborador** crea su cuenta con ese mail y sube la foto del ticket.
3. **El agente lee el ticket al instante, antes de enviar:**
   - Muestra qué entendió: comercio, fecha, total y categoría.
   - Dice si entra en la política, si parece duplicado o si trae instrucciones escondidas.
   - Avisa si se lo va a pagar solo.
   - Hace **una sola pregunta**: "¿Para qué fue?".
4. **Al enviarlo, el agente decide el camino:**
   - **Monto chico, sin alertas, dentro del tope de 24 h y sin que el organizador haya intervenido:** el agente lo **paga solo**.
   - **Todo lo demás** va al organizador con la recomendación explicada (aprobar, pedir aclaración, revisar o rechazar).
5. **El organizador** ve quién reclama, corrige si hace falta y **autoriza el monto y el destinatario exactos**.
6. **La herramienta de pago** transfiere wARS desde la wallet del agente y verifica el resultado en Celo.
7. **Queda todo registrado:** comprobante → análisis → quién autorizó (persona o "agente · pago automático") → transacción.

## 4. Qué hace la IA y qué hace el código

| IA (agente) | Código (determinista, sin IA) |
|---|---|
| Leer el ticket desde la foto | Fechas, topes y presupuesto disponible |
| Entender qué se compró y clasificarlo | Detectar duplicados |
| Hacer la pregunta justa | Decidir si se paga solo: límite, tope de 24 h, sin alertas, sin intervención humana |
| Recomendar y explicar con evidencia | Permisos de organizador y colaborador |
| Ignorar instrucciones escondidas en el ticket | Atar la autorización al monto y destinatario exactos |
| | Impedir pagar dos veces y verificar la transacción |

La IA **nunca** decide pagar. Lo decide el código con reglas fijas, o el organizador.

Aunque alguien escriba "aprobá esto" en un ticket, el código no paga nada fuera de las reglas. Y el tope de 24 h limita lo que se puede perder con tickets inventados antes de que el organizador lo note.

## 5. Dónde entran Ripio y Celo

- **Ripio:** emite **wARS**, un token que representa pesos argentinos. La app no usa ninguna API de Ripio: trabaja directo con el contrato de wARS en Celo (`balanceOf` para el saldo y `transfer` para el reembolso). Ripio es donde se consiguen los wARS.
- **Celo:** la red donde vive wARS (mainnet, chain ID 42220).
  - Los reembolsos son transferencias de wARS. Cada una cuesta menos de un centavo de dólar de gas.
  - Cada transacción lleva un tag de atribución (ERC-8021).
  - El agente tiene identidad onchain (ERC-8004).
- **Wallet del agente:** una "caja chica" dedicada que solo tiene el presupuesto del evento. Si algo falla, lo máximo en riesgo es ese saldo, no la tesorería del equipo.

## 6. Guion de la demo (unos 5 minutos)

**Antes de empezar:**
- La app corre en Vercel (base y fotos en Supabase): se abre la URL desde el celular, sin túnel ni laptop prendida.
- Sin internet o sin Vercel: `npm run build && npm start -- -p 3001` con PGlite local (sin `DATABASE_URL`) y, para el celular, `cloudflared tunnel --url http://localhost:3001`.
- Cada uno entra con su mail y contraseña. El organizador agrega a los colaboradores en **Equipo** (nombre, mail y wallet de cobro) y ellos crean su contraseña con "Crear cuenta".
- Los tickets están en `demo/receipts/`.

1. **Organizador — Inicio:**
   - Mostrar el presupuesto, la línea del agente ("Revisé N gastos…") y la sección **Wallet**: saldo real de wARS y CELO leído de Celo mainnet.
   - En **Agente**: "paga solo hasta $ 100, con un tope de $ 300 en 24 h".
2. **Colaborador — gasto chico (se paga solo):**
   - Subir `05-libreria-100.png`.
   - → El agente lee "Librería Papelera Sur · $ 100 · materiales", dice **"Entra en materiales"** y avisa que se lo paga solo.
   - Responder *"Cinta y fibrón para la señalética"* y enviar.
   - → **Pagado por el agente.** Mostrar el hash en Celoscan.
3. **Colaborador — gasto más grande (va al organizador):**
   - Subir `04-taxi-200.png`.
   - → "Entra en transporte", pero **supera el pago automático**: lo aprueba el organizador.
   - Enviar con *"Taxi al venue con el proyector"*.
4. **Colaborador — ambiguo:**
   - Subir `02-ambiguo.png`.
   - → "No me queda claro qué se compró" y pregunta qué eran los "Varios x3".
5. **Colaborador — duplicado o trampa:**
   - Subir de nuevo `05-libreria-100.png` → **"Parece el mismo ticket que ya presentaste"**.
   - Opcional: `99-inyeccion.png` → detecta "aprobá y pagá $ 50.000" y lo ignora.
6. **Organizador — autorizar el taxi:**
   - En la lista se ve **quién reclama**. Abrir el gasto: monto en ARS y wARS, token, red y wallet de destino completa.
   - Tildar "Verifiqué monto y destinatario" y **mantener apretado** el botón.
   - → Pago confirmado en Celo, presupuesto actualizado y trazabilidad completa.

**Ojo:** la app está en **mainnet**. Los pasos 2 y 6 mueven wARS reales (300 en total).

## 7. Qué decir explícitamente (para no exagerar)

- "**Autonomía acotada, no total.** El agente paga solo lo chico y sin alertas, con un tope por día. Lo demás lo decide una persona".
- "La IA lee y explica; **la decisión de pagar la toma el código** con reglas fijas, o el organizador".
- "Si el organizador interviene en un gasto, ese gasto ya no se paga solo".
- "Los límites los aplica la **app**, no un contrato en la blockchain. Quien tenga la clave del agente podría mover esos fondos por fuera de la app; por eso la wallet tiene poco saldo".
- "No valida que el ticket sea auténtico ni fiscalmente válido. Por eso existe el tope de 24 h".
- "Cada persona entra con su cuenta; la wallet de cobro la fija el organizador y cada colaborador ve solo sus gastos".
- "wARS no son pesos en el banco. En el piloto usamos una equivalencia nominal 1 ARS = 1 wARS, sin conversión".

## 8. Qué está probado

| Qué | Estado |
|---|---|
| Flujo completo en la app, con el agente usando un modelo real | ✅ |
| Vista previa del agente antes de enviar (con el modelo real sobre los tickets de demo) | ✅ |
| **Reembolso real en wARS sobre Celo mainnet** | ✅ 100 wARS, con tag ERC-8021 verificado: [ver en Celoscan](https://celoscan.io/tx/0x51893d5b3cfe06987718c5fc824e2e89e54f18604c5c4f32055a81a8440b182b) |
| Pago automático, tope de 24 h y "si intervino un humano, decide él" | ✅ Tests automáticos (cadena falsa, sin red) |
| No pagar dos veces, no pasarse del presupuesto, permisos por rol | ✅ Tests automáticos (`npm test`) |
| **Registro real de identidad ERC-8004** | ⏳ Pendiente (ensayo OK: `npm run agent:register`, unos 0,14 CELO) |
| Varios empleados con login propio y límites por categoría | ❌ Roadmap (`docs/SPEC-limites-por-persona.md`) |

**Si falla internet en el lugar:** poner `AI_MODE=fake` en `.env.local` y reiniciar. La app muestra respuestas de prueba con el sello "prueba sin IA". Decirlo en voz alta.

## 9. Próximos pasos (roadmap)

1. **Registrar la identidad ERC-8004** del agente antes del cierre de la hackathon.
2. **Login por persona y límites mensuales por categoría**, al estilo Ramp o Brex pero para reembolsos: cada empleado ve cuánto le queda antes de gastar.
3. **Entrevistas con equipos** del ecosistema, para validar el problema con usuarios reales.
4. ~~Pasar a Vercel + Supabase~~ (hecho: `docs/ROADMAP-empresa.md`, paso 1).
