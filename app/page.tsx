import { redirect } from "next/navigation";
import { getSession } from "@/lib/session.ts";
import { login } from "./actions/session.ts";
import Flash from "./components/Flash.tsx";
import SubmitButton from "./components/SubmitButton.tsx";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getSession()) redirect("/evento");
  const sp = await searchParams;
  return (
    <div className="login">
      <h1>Rendición de gastos del meetup</h1>
      <p className="lead">
        Subí el comprobante. El agente lo contrasta con la política de gastos, explica su recomendación y prepara el reembolso. El
        organizador siempre decide.
      </p>
      <Flash error={sp.error} />
      <form action={login} className="card form">
        <fieldset className="roles">
          <legend>¿Quién sos?</legend>
          <label className="radio">
            <input type="radio" name="role" value="collaborator" defaultChecked /> Colaborador · presento gastos
          </label>
          <label className="radio">
            <input type="radio" name="role" value="organizer" /> Organizador · reviso y autorizo
          </label>
        </fieldset>
        <label>
          Passcode
          <input type="password" name="passcode" required autoComplete="current-password" />
        </label>
        <SubmitButton pendingText="Ingresando…">Ingresar</SubmitButton>
      </form>
    </div>
  );
}
