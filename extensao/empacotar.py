# Gera o .zip para enviar à Chrome Web Store, só com os arquivos da extensão.
# Uso (na raiz do repositório): python3 extensao/empacotar.py  → extensao/comunique-extensao-<versão>.zip
import json, pathlib, zipfile
raiz = pathlib.Path(__file__).parent
versao = json.loads((raiz / "manifest.json").read_text(encoding="utf-8"))["version"]
fora = {"CHROMEWEBSTORE.md", "empacotar.py", "README.md"}
fora_pastas = {"loja"}
destino = raiz / f"comunique-extensao-{versao}.zip"
with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(raiz.rglob("*")):
        if f.is_file() and f.name not in fora and not (set(f.relative_to(raiz).parts) & fora_pastas) and not f.name.endswith(".zip") and not f.name.startswith("."):
            z.write(f, f.relative_to(raiz))
print(destino)
