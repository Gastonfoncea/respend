"use client";
// Categorías como lista con check. Envía el mismo campo "categories" (separado por comas) que espera la acción.
import { useState } from "react";
import Icon from "./Icon.tsx";

export default function CategoryOptions({ known, selected }: { known: readonly string[]; selected: string[] }) {
  const all = [...new Set([...known, ...selected])];
  const [on, setOn] = useState<string[]>(selected);
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 8 }}>
        Categorías
      </legend>
      <div className="options">
        {all.map((c) => (
          <label key={c} className="option">
            <input
              type="checkbox"
              checked={on.includes(c)}
              onChange={(e) => setOn((prev) => (e.target.checked ? [...prev, c] : prev.filter((x) => x !== c)))}
            />
            <span>{c}</span>
            <span className="box">
              <Icon name="check" size={14} stroke={3} />
            </span>
          </label>
        ))}
      </div>
      <input type="hidden" name="categories" value={on.join(", ")} />
    </fieldset>
  );
}
