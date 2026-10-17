# Integración con Celo y Ripio: cómo funciona por dentro

Esta guía explica, tema por tema, qué hace Respend con la red Celo y con wARS, y en qué archivo y función está cada cosa. Está pensada para aprender, así que va despacio.

---

## 1. Ripio y wARS

### Qué es wARS

**wARS** ("Peso Argentino") es un token de Ripio que representa pesos argentinos. Es un **ERC-20** desplegado en **Celo mainnet**:

| Dato | Valor |
|---|---|
| Contrato | `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D` |
| `symbol()` | `wARS` |
| `name()` | `Peso Argentino` |
| `decimals()` | `18` |

Un ERC-20 es un contrato con una interfaz estándar. Respend usa solo cuatro funciones y un evento:

| Función / evento | Para qué | Dónde |
|---|---|---|
| `decimals()` | Verificar antes de pagar que el token tiene 18 decimales. | `lib/chain/payTool.ts` → `assertMainnetTarget` |
| `symbol()` | Verificar que el contrato es `wARS`. | idem |
| `balanceOf(address)` | Mostrar el saldo de la wallet del agente. | `lib/chain/clients.ts` → `getTokenBalance`; `scripts/check-wallet.ts` |
| `transfer(to, amount)` | Pagar el reembolso. | `lib/chain/token.ts` → `encodeTransfer` |
| evento `Transfer(from, to, value)` | Confirmar que el pago movió exactamente lo autorizado. | `lib/chain/token.ts` → `transferLogsOf`; `lib/chain/verify.ts` |

### Por qué `× 10^16` desde centavos

Los tokens no tienen decimales "de verdad": guardan enteros, y `decimals()` dice dónde va la coma. Con 18 decimales, **1 wARS = 10^18 unidades base** (wei).

Respend guarda los pesos en **centavos** (1 peso = 100 centavos) y el piloto usa la equivalencia nominal 1 ARS = 1 wARS. Entonces:

```
1 centavo = 0,01 wARS = 10^18 / 100 = 10^16 wei
wei = centavos × 10^16
```

Ejemplo: $ 1.500,00 = 150.000 centavos → 150.000 × 10^16 = 1.500 × 10^18 wei = 1.500 wARS.

Todo esto se hace con enteros (`bigint`), nunca con `float`, para no perder precisión: `lib/money.ts` → `centsToWei`.

### Cómo se consigue wARS

Fuera del producto: en la app de Ripio se compran wARS y se retiran a una dirección en la **red Celo**. Para la demo, esa dirección es la wallet del agente (`npm run wallet:new` la crea). La wallet necesita además un poco de **CELO** para pagar el gas.

---

## 2. Celo

### La red

| Dato | Valor |
|---|---|
| Red | Celo mainnet |
| Chain ID | `42220` (`0xa4ec`) |
| RPC público | `https://forno.celo.org` ("forno") |
| Explorador | `https://celoscan.io` |

- Constantes en `lib/config.ts`.
- Cliente de lectura (viem + `celo` de `viem/chains`): `lib/chain/clients.ts` → `createRealChain`.

### Gas en CELO

Cada transacción paga gas. Respend arma transacciones **EIP-1559** (`maxFeePerGas` y `maxPriorityFeePerGas`) que se pagan en **CELO**, la moneda nativa. Celo también permite pagar gas con otros tokens (`feeCurrency`), pero el piloto no lo usa para simplificar. Por eso la wallet del agente necesita algo de CELO (unos 0,5 alcanzan con margen).

### Firma local con viem

La clave privada del agente **nunca sale de la máquina** ni se manda a un nodo. El flujo, en `lib/chain/payTool.ts` → `createPayTool`:

1. `prepareTransaction`: pide al RPC el nonce `pending`, estima el gas y las fees.
2. `account.signTransaction(...)`: viem firma **localmente** con la clave. El resultado es el `raw_tx` (la transacción firmada, en bytes).
3. `tx_hash = keccak256(raw_tx)`: el hash se puede calcular antes de enviarla.
4. `sendRawTransaction(raw_tx)`: recién acá la transacción sale a la red.

La clave se lee en un único lugar: `lib/chain/signer.ts` → `getAgentAccount`.

### Por qué se guarda el `raw_tx` antes de difundir

Supongamos que el servidor se cae justo después de enviar la transacción, antes de anotar nada. Al volver no sabríamos si el pago salió o no, y la tentación sería "pagar de nuevo", con riesgo de **pagar dos veces**.

Por eso Respend **persiste `raw_tx`, `nonce` y `tx_hash` con estado `signed` antes de llamar a `sendRawTransaction`**. Si algo falla:

- El hash ya está guardado, así que se puede buscar en la cadena.
- Si la transacción no aparece y el nonce sigue libre, se **re-difunde el mismo `raw_tx`**. Mismo nonce y mismo hash: la red no puede aceptarla dos veces.
- Si otra transacción ya usó ese nonce, la nuestra nunca se va a minar, y el pago se marca `failed` con el motivo.

Todo esto está en `lib/chain/reconcile.ts` → `reconcile`. Un error de red al enviar deja el pago en `uncertain`, **nunca** en `failed`: no se asume que "no salió".

Otras defensas contra el doble pago (en `payTool`, dentro de una transacción SQLite `BEGIN IMMEDIATE`):
- La solicitud tiene que estar en `authorized` y el `binding_hash` de la autorización tiene que coincidir con los datos actuales.
- Índice único `one_live_payment_per_request`: un solo pago vivo por solicitud.
- Lock global: no se arranca un pago si hay otro `preparing`/`signed`/`sent`/`uncertain`. Eso también evita colisiones de nonce.

### Verificación del receipt y del `Transfer`

Que una transacción "se haya minado" no alcanza. `lib/chain/verify.ts` → `verifyPayment` exige:

1. `receipt.status === "success"` (si revirtió, no se movieron fondos → `failed`).
2. **Exactamente un** log `Transfer` emitido por el contrato wARS, con `from` = wallet del agente, `to` = destinatario autorizado y `value` = monto autorizado.

Solo así el pago pasa a `confirmed` y la solicitud a `reimbursed`. Si el `Transfer` no coincide, el pago queda `uncertain` para revisión manual (no se confirma ni se marca fallido, porque podrían haberse movido fondos).

Antes de firmar, `assertMainnetTarget` verifica onchain que la red responde chain ID 42220 y que el token dice `decimals() = 18` y `symbol() = "wARS"`. Si algo no coincide, aborta sin firmar.

---

## 3. ERC-8021: atribución de transacciones

### Qué es el sufijo

ERC-8021 define una forma de "firmar" una transacción con el código de la app que la generó, **agregando unos bytes al final del calldata**. El contrato los ignora (lee solo lo que necesita), pero quedan en la cadena y se pueden decodificar después. Celo lo usa para atribuir actividad a cada proyecto del programa de builders.

Formato (schema 0), leyendo desde el final del calldata:

```
[código][largo: 1 byte][schema: 0x00][marcador: 0x80218021… ×8]
```

### Por qué el código sale del repo

El código de Respend es `celo_e418a350ffec`. No es arbitrario: es `codeFromRepo("gastonfoncea/respend")`, o sea, `celo_` + los primeros 12 hex del sha256 de `owner/repo` en minúsculas. La plataforma de Celo deriva el mismo código del repositorio inscripto, así que cualquiera puede comprobar que coincide.

`lib/chain/attribution.ts` → `assertAttributionCode` recalcula `codeFromRepo` y aborta si no coincide con `ATTRIBUTION_CODE` de `lib/config.ts`.

### Dónde lo agregamos

En `lib/chain/payTool.ts`:

```ts
const data = withAttribution(encodeTransfer(to, BigInt(auth.token_amount)));
// = encodeFunctionData(transfer(to, amount)) ++ toDataSuffix("celo_e418a350ffec")
```

`withAttribution` está en `lib/chain/attribution.ts` y usa `toDataSuffix` de `@celo/attribution-tags`. El registro ERC-8004 (`scripts/register-agent.ts`) usa la extensión `withAttribution` del SDK sobre el wallet client de viem.

### Cómo verificarlo

```bash
npm run tx:verify -- 0xHASH
```

`scripts/verify-tx.ts` decodifica el calldata con `fromDataSuffix` y además corre `verifyTx` del SDK. Después de cada pago real, `verify.ts` guarda `attribution_ok` y la UI muestra "Tag ERC-8021 ✓ presente".

---

## 4. ERC-8004: identidad del agente

### Qué es

ERC-8004 es un registro onchain de agentes. El **Identity Registry** es un contrato tipo NFT: llamar `register(agentURI)` le da al agente un `agentId` cuyo dueño es la wallet que lo registró. Hay también un **Reputation Registry** donde otros pueden dejar feedback.

| Contrato (Celo mainnet) | Dirección |
|---|---|
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

### El archivo de registro como `data:` URI

`agentURI` apunta a un JSON que describe al agente. En vez de hostearlo, Respend lo mete entero en la URI como `data:application/json;base64,…`. Así no depende de ningún servidor.

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Respend",
  "description": "…",
  "services": [{ "name": "web", "endpoint": "https://github.com/gastonfoncea/respend" }],
  "active": true,
  "supportedTrust": ["reputation"]
}
```

Se arma en `lib/erc8004.ts` → `buildRegistration` y `toDataUri`.

### El script

`scripts/register-agent.ts` registra **desde la wallet del agente** (la misma que paga), así la identidad y los pagos quedan ligados a la misma dirección.

- `npm run agent:register -- --offline`: muestra el JSON y la URI, sin red.
- `npm run agent:register`: **dry-run**. Hace `simulateContract` de `register(agentURI)` (un `eth_call`, no gasta nada) y estima el gas.
- `npm run agent:register -- --send`: pide escribir `REGISTRAR`, envía con el sufijo ERC-8021, espera el receipt y lee el `agentId` del **evento `Registered`**, no del valor de retorno (si otro agente se registra en el mismo bloque, el valor simulado puede no coincidir). Imprime los links a 8004scan (`https://www.8004scan.io/agents/celo/<agentId>`) y a Celoscan.

---

## Resumen: archivo y función de cada tema

| Tema | Archivo → función |
|---|---|
| Constantes de red, token, registries, código de atribución | `lib/config.ts` |
| Centavos ↔ wei, formato de montos | `lib/money.ts` → `centsToWei`, `formatWars`, `parseArsToCents` |
| Cliente de Celo (lecturas, envío) | `lib/chain/clients.ts` → `createRealChain` |
| ERC-20: transfer y logs | `lib/chain/token.ts` → `encodeTransfer`, `transferLogsOf` |
| Clave del agente | `lib/chain/signer.ts` → `getAgentAccount` |
| Herramienta de pago | `lib/chain/payTool.ts` → `createPayTool` (`executeAuthorizedReimbursement`), `assertMainnetTarget` |
| Verificación del pago | `lib/chain/verify.ts` → `verifyPayment` |
| Reconciliación | `lib/chain/reconcile.ts` → `reconcile`, `applyReceipt` |
| ERC-8021 | `lib/chain/attribution.ts` → `withAttribution`, `hasOurAttribution` |
| ERC-8004 | `lib/erc8004.ts`, `scripts/register-agent.ts` |
| Cadena falsa para tests | `lib/chain/fakeChain.ts` |
