// Aviso breve que llega por querystring (?ok= / ?error=) tras una server action.
import Icon from "./Icon.tsx";

export default function Flash({ error, ok }: { error?: string | string[]; ok?: string | string[] }) {
  const e = Array.isArray(error) ? error[0] : error;
  const o = Array.isArray(ok) ? ok[0] : ok;
  if (!e && !o) return null;
  return (
    <div className={`toast ${e ? "toast-error" : "toast-ok"}`} role={e ? "alert" : "status"}>
      <Icon name={e ? "warn" : "check"} size={18} stroke={2} />
      <span>{e ?? o}</span>
    </div>
  );
}
