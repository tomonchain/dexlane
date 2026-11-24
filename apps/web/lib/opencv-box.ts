// Point d'entrée d'OpenCV pour un chargement à la demande. Le module OpenCV se présente comme une promesse
// (« thenable » Emscripten) : importé dynamiquement tel quel, le navigateur essaierait de l'attendre et échouerait.
// Importé ici statiquement puis exposé dans une boîte, il traverse `import()` sans être pris pour une promesse.
import cv from "@techstark/opencv-js";

export const box: { cv: unknown } = { cv };
