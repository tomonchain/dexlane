import { redirect } from "next/navigation";

/** Les annonces se gèrent depuis le stock (fiche d'une carte) : l'ancienne adresse y mène, sur les cartes prêtes à vendre. */
export default function ListingsPage() {
  redirect("/stock?statut=READY");
}
