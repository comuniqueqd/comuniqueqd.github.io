#!/usr/bin/env python3
"""Junta o registro comum da varredura num mapa.json e num placar.json, e compara com a rodada anterior.
Uso: python3 consolidar.py <pasta-da-varredura> <docs/revisoes/<versao>>
- <pasta>/registro.jsonl: uma linha por achado/sugestão (formato no SKILL.md)
- <pasta>/a9/vereditos.json (opcional): {"id": {"veredito": ..., "prio": ...}}
- <pasta>/placar.json: números da rodada {"chave": valor} (cada agente acrescenta os seus)
Escreve <destino>/mapa.json, <destino>/placar.json e imprime a comparação com a revisão anterior em docs/revisoes/."""
import json, sys, os, glob, re
pasta, destino = sys.argv[1], sys.argv[2]
os.makedirs(destino, exist_ok=True)
itens, vistos = [], {}
for l in open(os.path.join(pasta, "registro.jsonl"), encoding="utf8"):
    l = l.strip()
    if not l: continue
    o = json.loads(l)
    if o.get("tipo") == "alerta": continue
    if o.get("mais_evidencia"):
        if o["mais_evidencia"] in vistos: vistos[o["mais_evidencia"]]["evidencia"] += " | " + o.get("evidencia", "")
        continue
    vistos[o["id"]] = o; itens.append(o)
ver = {}
vp = os.path.join(pasta, "a9", "vereditos.json")
if os.path.exists(vp): ver = json.load(open(vp, encoding="utf8"))
PR = {"crítica": 4, "alta": 3, "média": 2, "baixa": 1}
for o in itens:
    v = ver.get(o["id"])
    if v:
        o["veredito"] = v.get("veredito", ""); o["prio_orig"] = o["prio"]; o["prio"] = v.get("prio", o["prio"]); o["nota"] = v.get("nota", "")
    p, e = PR.get(o["prio"], 2), o.get("esforco", "médio")
    o["onda"] = 1 if p >= 3 and e != "grande" else (2 if p >= 3 or o.get("tipo") == "achado" and p == 2 else 3)
    for k in ("evidencia", "sugestao", "onde"):
        o[k] = re.sub(r"\d{3}\.\d{3}\.\d{3}-\d{2}", "000.000.000-00", o.get(k, ""))
json.dump(itens, open(os.path.join(destino, "mapa.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
placar = json.load(open(os.path.join(pasta, "placar.json"), encoding="utf8")) if os.path.exists(os.path.join(pasta, "placar.json")) else {}
json.dump(placar, open(os.path.join(destino, "placar.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
anteriores = sorted(p for p in glob.glob(os.path.join(os.path.dirname(destino.rstrip("/")), "*", "placar.json")) if os.path.dirname(p) != destino.rstrip("/"))
print(f"{len(itens)} itens; altos/críticos: {sum(1 for o in itens if PR.get(o['prio'],0) >= 3)}; para agora: {sum(1 for o in itens if o['onda'] == 1)}")
if anteriores:
    ant = json.load(open(anteriores[-1], encoding="utf8"))
    print("Placar comparado com", os.path.dirname(anteriores[-1]))
    for k in sorted(set(ant) | set(placar)):
        print(f"  {k}: {ant.get(k, '—')} → {placar.get(k, '—')}")
