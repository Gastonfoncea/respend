"use client";
// Hoja inferior (modal en desktop) sobre <dialog>. Los formularios adentro envían server actions normalmente.
import { useEffect, useRef } from "react";
import Icon from "./Icon.tsx";

export default function Sheet({
  trigger,
  triggerClassName = "btn btn-neutral",
  triggerLabel,
  children,
  defaultOpen = false,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (defaultOpen) ref.current?.showModal();
  }, [defaultOpen]);

  return (
    <>
      <button type="button" className={triggerClassName} aria-label={triggerLabel} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        className="sheet"
        onClick={(e) => {
          // Cerrar tocando el fondo.
          if (e.target === ref.current) ref.current.close();
        }}
      >
        <div className="sheet-inner">
          <div className="sheet-grab" aria-hidden />
          <button type="button" className="icon-btn sheet-close" aria-label="Cerrar" onClick={() => ref.current?.close()}>
            <Icon name="x" size={20} />
          </button>
          {children}
        </div>
      </dialog>
    </>
  );
}
