#!/usr/bin/env bash
# Publie la version du package.json racine si elle n'a pas encore d'étiquette : étiquette vX.Y.Z sur le commit donné
# (main par défaut) et release GitHub dont les notes sont la section correspondante de CHANGELOG.md.
# Sans changement de version, ne fait rien. Demande GH_TOKEN avec le droit contents: write.
set -euo pipefail

target=$(git rev-parse "${1:-HEAD}")
version=$(git show "$target:package.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
tag="v$version"

if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  echo "Version $version déjà publiée."
  exit 0
fi

# Section « ## [x.y.z] … » jusqu'au titre de version suivant (ou aux liens de fin).
notes=$(git show "$target:CHANGELOG.md" | awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && (/^## \[/ || /^\[[^]]+\]: /) { exit }
  on { print }
')
if [ -z "$(echo "$notes" | tr -d '[:space:]')" ]; then
  echo "::error::CHANGELOG.md n'a pas de section « ## [$version] » : ajoutez-la avant de changer la version."
  exit 1
fi

gh release create "$tag" --target "$target" --title "$tag" --notes "$notes"
echo "Version $version publiée."
