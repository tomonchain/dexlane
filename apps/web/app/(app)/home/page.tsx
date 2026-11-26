import { Home } from "@/components/home";

/**
 * Accueil de l'application. Servi à l'adresse « / » quand une session est ouverte (voir proxy.ts) : la racine reste
 * la landing statique pour les visiteurs.
 */
export default function HomePage() {
  return <Home />;
}
