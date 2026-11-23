/**
 * Contrôle des traductions : chaque texte passé à `t()` ou `tn()` doit avoir sa traduction anglaise, avec les mêmes
 * variables `{…}`. `--untranslated` liste en plus les lignes qui semblent contenir du français hors de `t()`
 * (repérage approximatif : à relire, pas une erreur).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { EN } from "../lib/i18n/en";

const ROOT = join(import.meta.dirname, "..");
const DIRS = ["app", "components", "lib"];
const SKIP = [/lib\/i18n\//, /\.test\./, /lib\/i18n\.ts$/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|mts)$/.test(name) && !SKIP.some((re) => re.test(path)) ? [path] : [];
  });
}

const STRING = String.raw`(["'\x60])((?:\\.|(?!\1)[\s\S])*?)\1`;
const T_CALL = new RegExp(String.raw`\bt\(\s*` + STRING, "g");
const TN_CALL = new RegExp(String.raw`\btn\(\s*[^,]+?,\s*` + STRING + String.raw`\s*,\s*` + STRING.replace("\\1", "\\3").replace("(?!\\1)", "(?!\\3)"), "g");
const unescape = (s: string) => s.replace(/\\(["'\x60\\])/g, "$1").replace(/\\n/g, "\n");
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const missing: string[] = [];
const mismatched: string[] = [];
const suspicious: string[] = [];
const untranslated = process.argv.includes("--untranslated");
let keys = 0;

for (const path of files(ROOT).filter((p) => DIRS.some((d) => relative(ROOT, p).startsWith(d)))) {
  const source = readFileSync(path, "utf8");
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  const check = (raw: string, index: number) => {
    if (raw.includes("${")) {
      missing.push(`${relative(ROOT, path)}:${lineOf(index)}  interpolation \${} dans t() : utiliser {variable}`);
      return;
    }
    const key = unescape(raw);
    keys++;
    const en = EN[key];
    if (en === undefined) missing.push(`${relative(ROOT, path)}:${lineOf(index)}  ${JSON.stringify(key)}`);
    else if (vars(en) !== vars(key)) mismatched.push(`${relative(ROOT, path)}:${lineOf(index)}  ${JSON.stringify(key)} → ${JSON.stringify(en)}`);
  };
  for (const m of source.matchAll(T_CALL)) check(m[2]!, m.index!);
  for (const m of source.matchAll(TN_CALL)) {
    check(m[2]!, m.index!);
    check(m[4]!, m.index!);
  }
  if (untranslated) {
    source.split("\n").forEach((line, i) => {
      const code = line
        .replace(/\/\/.*$/, "")
        .replace(/^\s*(\*|\/\*).*$/, "")
        .replace(/\{\/\*.*?\*\/\}/g, "")
        .replace(new RegExp(String.raw`\btn?\(\s*(?:[^,()]+?,\s*)?` + STRING + String.raw`(?:\s*,\s*` + STRING.replace("\\1", "\\3").replace("(?!\\1)", "(?!\\3)") + ")?", "g"), "")
        .replace(/(className|data-testid|href|key|id|type|name|variant|size|role|aria-hidden)=("[^"]*"|\{[^}]*\})/g, "");
      if (/[àâçéèêëîïôûùüÿœÀÂÇÉÈÊÎÔÛ]|\b(le|la|les|des|une|du|aux|est|sont|pour|avec|dans|sur|pas|vos|votre)\b\s+\w/.test(code) && /["'`>]/.test(code)) {
        suspicious.push(`${relative(ROOT, path)}:${i + 1}  ${line.trim().slice(0, 140)}`);
      }
    });
  }
}

console.log(`${keys} textes traduisibles, ${Object.keys(EN).length} traductions.`);
if (mismatched.length) console.log(`\nVariables différentes entre le français et l'anglais (${mismatched.length}) :\n` + mismatched.join("\n"));
if (missing.length) console.log(`\nTraductions manquantes (${missing.length}) :\n` + missing.join("\n"));
if (untranslated) console.log(`\nLignes à vérifier, français hors de t() (${suspicious.length}) :\n` + suspicious.join("\n"));
process.exit(missing.length || mismatched.length ? 1 : 0);
