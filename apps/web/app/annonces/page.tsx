import { redirect } from "next/navigation";

/** Ancienne adresse des annonces : le planning des mises en ligne a désormais sa page. */
export default function ListingsPage() {
  redirect("/mises-en-ligne");
}
