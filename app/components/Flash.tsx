export default function Flash({ error, ok }: { error?: string | string[]; ok?: string | string[] }) {
  const e = Array.isArray(error) ? error[0] : error;
  const o = Array.isArray(ok) ? ok[0] : ok;
  return (
    <>
      {e && (
        <div className="flash flash-error" role="alert">
          {e}
        </div>
      )}
      {o && (
        <div className="flash flash-ok" role="status">
          {o}
        </div>
      )}
    </>
  );
}
