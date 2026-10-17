"use client";
import { useFormStatus } from "react-dom";

/** Botón que se deshabilita mientras la acción corre (protección cosmética; la real está en el servidor). */
export default function SubmitButton({
  children,
  pendingText,
  className = "btn btn-primary",
  disabled = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending} aria-label={ariaLabel}>
      {pending ? (
        <>
          <span className="spin" aria-hidden />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
