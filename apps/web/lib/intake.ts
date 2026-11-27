import { Camera, FolderUp, ScanLine, type LucideIcon } from "lucide-react";
import type { AppSettings } from "./types";

export type IntakeMode = NonNullable<AppSettings["intakeMode"]>;

/** Les façons de faire entrer les cartes : l'écran d'ajout et le menu « Ajouter des cartes » s'adaptent au choix. */
export const INTAKE: { value: IntakeMode; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "SCANNER", label: "Scanner à défilement", hint: "Les cartes passent une à une, les images arrivent seules depuis le dossier du scanner.", icon: ScanLine },
  { value: "CAMERA", label: "Appareil photo du téléphone", hint: "Tu photographies recto puis verso au téléphone ; la revue se fait sur l'ordinateur.", icon: Camera },
  { value: "FILES", label: "Envoi de fichiers", hint: "Les photos existent déjà : tu les déposes par lot.", icon: FolderUp },
];
