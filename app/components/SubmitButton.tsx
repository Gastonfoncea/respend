"use client";
import { useFormStatus } from "react-dom";

/** Botón que se deshabilita mientras la acción corre (protección cosmética; la real está en el servidor). */
export default function SubmitButton({
  children,
  pendingText,
  className = "btn",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (
        <>
          <span className="spinner" aria-hidden /> {pendingText ?? "Procesando…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
