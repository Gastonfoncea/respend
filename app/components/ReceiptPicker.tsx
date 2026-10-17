"use client";
// Foto del comprobante: cámara en mobile, arrastrar o pegar en desktop. Valida tipo y tamaño antes de enviar.
// Mientras la acción corre, muestra "Leyendo el ticket" sobre la foto elegida.
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Icon from "./Icon.tsx";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");
}

export default function ReceiptPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const { pending } = useFormStatus();

  function accept(files: FileList | null) {
    const f = files?.[0];
    if (!f || !input.current) return;
    let msg: string | null = null;
    if (!TYPES.includes(f.type)) msg = "Formato no soportado. Usá JPG, PNG o WEBP.";
    else if (f.size > MAX_BYTES) msg = `Pesa demasiado: ${mb(f.size)} MB · máximo 4 MB.`;
    input.current.setCustomValidity(msg ?? "");
    setError(msg);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return msg ? null : URL.createObjectURL(f);
    });
  }

  function setFiles(files: FileList) {
    if (!input.current) return;
    input.current.files = files;
    accept(files);
  }

  // Pegar una imagen desde el portapapeles (desktop).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      setFiles(dt.files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const state = error ? "is-error" : preview ? "has-file" : "";
  return (
    <>
      <label
        className={`picker ${state} ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
        }}
      >
        <span className="brackets" aria-hidden />
        {error ? (
          <span className="picker-empty">
            <span className="avatar" style={{ background: "var(--red-tint)", color: "var(--red)" }}>
              <Icon name="warn" size={22} stroke={2} />
            </span>
            <span className="t-red" style={{ fontWeight: 500 }}>
              {error}
            </span>
            <span className="small dim">Tocá para elegir otra foto.</span>
          </span>
        ) : preview ? (
          <>
            <span className="picker-status">Ticket listo · tocá para cambiar</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="picker-preview" src={preview} alt="Vista previa del comprobante" />
          </>
        ) : (
          <span className="picker-empty">
            <span className="shutter hide-desktop" aria-hidden />
            <span className="avatar only-desktop" style={{ width: 56, height: 56, borderRadius: 18 }}>
              <Icon name="image" size={24} />
            </span>
            <span style={{ fontWeight: 500 }}>
              <span className="hide-desktop">Sacale foto al ticket</span>
              <span className="only-desktop">Soltá el ticket, pegalo o elegilo</span>
            </span>
            <span className="mono dim-2">JPG, PNG o WEBP · hasta 4 MB</span>
          </span>
        )}
        <input
          ref={input}
          type="file"
          name="receipt"
          accept="image/jpeg,image/png,image/webp"
          required
          aria-label="Foto del comprobante"
          onChange={(e) => accept(e.target.files)}
        />
      </label>

      {pending && <Reading preview={preview} />}
    </>
  );
}

function Reading({ preview }: { preview: string | null }) {
  const rows: [string, number][] = [
    ["Comercio", 110],
    ["Fecha", 80],
    ["Total", 90],
    ["Categoría", 96],
    ["Política", 70],
  ];
  return (
    <div className="reading" role="status" aria-live="polite">
      <div className="ticket-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="" />}
        <span className="scan" aria-hidden />
      </div>
      <div className="reading-body">
        <div className="between">
          <h2 className="display h2">Leyendo el ticket</h2>
          <span className="spin t-green" aria-hidden />
        </div>
        <div>
          {rows.map(([k, w], i) => (
            <div key={k} className="reading-row" style={{ "--i": i } as React.CSSProperties}>
              <span>{k}</span>
              <span className="shimmer" style={{ "--w": `${w}px` } as React.CSSProperties} />
            </div>
          ))}
        </div>
        <p className="field-help">El ticket es dato, no instrucción. El agente nunca paga solo.</p>
      </div>
    </div>
  );
}
