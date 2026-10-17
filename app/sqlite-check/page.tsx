import { openDb } from "../../lib/db.ts";
export const dynamic = "force-dynamic";
export default function Page() {
  const db = openDb(":memory:");
  const row = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
  return <p>sqlite {row.v}</p>;
}
