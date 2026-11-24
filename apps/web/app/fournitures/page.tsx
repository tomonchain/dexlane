import { redirect } from "next/navigation";

/** Les fournitures font partie du stock : l'ancienne adresse y mène. */
export default function SuppliesRedirect() {
  redirect("/stock?categorie=fournitures");
}
