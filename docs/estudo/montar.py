#!/usr/bin/env python3
"""Monta mapa-estudo.html a partir de curso.json (e metodologia.md, se existir).

Uso: python3 docs/estudo/montar.py
- Troca o JSON embutido em <script id="curso">.
- Troca o bloco de JavaScript do curso (entre os marcadores) pela versão que entende o formato novo de aula.
- Acrescenta o CSS do curso uma vez (marcador /* curso-v2 */).
Pode rodar quantas vezes quiser.
"""
import json, re, pathlib

AQUI = pathlib.Path(__file__).parent
PAGINA = AQUI / "mapa-estudo.html"
CURSO = AQUI / "curso.json"
METODO = AQUI / "metodologia.md"


def md_para_secoes(texto):
    """Markdown simples (## títulos, parágrafos, listas com -) -> [{titulo, blocos:[str | [itens]]}]."""
    secoes, atual, lista = [], None, None
    for linha in texto.splitlines():
        l = linha.rstrip()
        if l.startswith("# "):
            continue
        if l.startswith("## ") or l.startswith("### "):
            atual = {"titulo": l.lstrip("#").strip(), "blocos": []}
            secoes.append(atual)
            lista = None
            continue
        if atual is None:
            atual = {"titulo": "", "blocos": []}
            secoes.append(atual)
        if re.match(r"^\s*([-*]|\d+\.)\s+", l):
            item = re.sub(r"^\s*([-*]|\d+\.)\s+", "", l)
            if lista is None:
                lista = []
                atual["blocos"].append(lista)
            lista.append(limpar(item))
        elif l.strip():
            lista = None
            if atual["blocos"] and isinstance(atual["blocos"][-1], str) and not texto_terminou(atual["blocos"][-1]):
                atual["blocos"][-1] += " " + limpar(l.strip())
            else:
                atual["blocos"].append(limpar(l.strip()))
        else:
            lista = None
            if atual["blocos"] and isinstance(atual["blocos"][-1], str):
                atual["blocos"][-1] += "\u0000"  # fim de parágrafo
    for s in secoes:
        s["blocos"] = [b.replace("\u0000", "") if isinstance(b, str) else b for b in s["blocos"]]
    return [s for s in secoes if s["titulo"] or s["blocos"]]


def texto_terminou(b):
    return b.endswith("\u0000")


def limpar(t):
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
    t = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"\1", t)
    t = re.sub(r"`([^`]+)`", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", t)
    return t


JS = r"""// ---------- curso ----------
const CU=JSON.parse(document.getElementById("curso").textContent);
const DIA=864e5,INTERV=CU.revisao_dias||[1,3,7,21];
let feitas=new Map();
try{const v=JSON.parse(localStorage.getItem("curso-feitas")||"[]");feitas=new Map((Array.isArray(v)?v:[]).map(x=>Array.isArray(x)?x:[x,{t:Date.now(),r:0}]))}catch(e){}
const salvar=()=>{try{localStorage.setItem("curso-feitas",JSON.stringify([...feitas]))}catch(e){}};
let atual=null;
const todas=()=>CU.modulos.flatMap(m=>m.aulas);
const titulo=id=>(todas().find(x=>x[0]===id)||[])[1]||id;
const vence=f=>f.r<INTERV.length?f.t+INTERV[f.r]*DIA:Infinity;
const paraRevisar=()=>[...feitas].filter(([,f])=>vence(f)<=Date.now()).map(([id])=>id);
const quando=f=>{const v=vence(f);if(v===Infinity)return"revisões completas";const d=Math.ceil((v-Date.now())/DIA);return d<=0?"revisar hoje":`revisar em ${d} dia${d>1?"s":""}`};
const TIPOS={prever:"Preveja",rodar:"Rode",investigar:"Investigue",modificar:"Modifique",criar:"Crie",ordenar:"Ordene"};
function alterna(txt,rot="Mostrar resposta"){const r=el("pre",{class:"resp",hidden:""},el("code",{text:txt}));const b=el("button",{class:"bt",type:"button",text:rot});b.addEventListener("click",()=>{r.hidden=!r.hidden;b.textContent=r.hidden?rot:"Esconder"});return[el("div",{class:"acoes"},b),r]}
function escada(ds){const box=el("div",{class:"dicas"});let n=0;const b=el("button",{class:"bt",type:"button",text:"Quero uma dica (1 de "+ds.length+")"});b.addEventListener("click",()=>{box.append(el("p",{class:"dica",text:`Dica ${n+1}: ${ds[n]}`}));n++;if(n>=ds.length)b.remove();else b.textContent=`Mais uma dica (${n+1} de ${ds.length})`});return[el("div",{class:"acoes"},b),box]}
function texto(t){return /\n/.test(t)?el("pre",{class:"enun"},el("code",{text:t})):el("p",{text:t})}
function indice(){const lista=todas(),prontas=lista.filter(a=>a[2]).length,rev=paraRevisar();
 document.getElementById("prog").textContent=`${[...feitas.keys()].filter(id=>lista.some(a=>a[0]===id)).length} de ${prontas} aulas prontas feitas · ${lista.length} aulas no plano`;
 const topo=[];
 if(CU.metodologia){const b=el("button",{class:"aula-l metodo",type:"button","aria-current":String(atual==="metodo")},el("span",{class:"ok"+(atual==="metodo"?"":""),"aria-hidden":"true"}),el("span",{text:"Como o curso funciona"}),el("span",{class:"st",text:"leia antes"}));b.addEventListener("click",abrirMetodo);topo.push(el("div",{class:"bloco-topo"},b))}
 if(rev.length)topo.push(el("div",{class:"bloco-topo rev"},el("p",{class:"rev-t",text:`Para revisar hoje (${rev.length})`}),rev.map(id=>{const b=el("button",{class:"aula-l",type:"button"},el("span",{class:"ok rev-p","aria-hidden":"true"}),el("span",{text:titulo(id)}),el("span",{class:"st",text:"revisar"}));b.addEventListener("click",()=>abrirAula(id,true));return b})));
 document.getElementById("indice").replaceChildren(...topo,...CU.modulos.map((m,mi)=>{const d=el("details",{},el("summary",{},el("span",{text:`${mi}. ${m.titulo}`}),el("small",{text:`${m.aulas.filter(a=>feitas.has(a[0])).length}/${m.aulas.length}`})),
  m.meta?el("p",{class:"meta-mod",text:m.meta}):null,
  m.aulas.map(([id,t,pronta])=>{const f=feitas.get(id);const b=el("button",{class:"aula-l",type:"button","aria-current":String(atual===id)},el("span",{class:"ok"+(f?" feito":""),"aria-hidden":"true"}),el("span",{text:t}),el("span",{class:"st",text:pronta?(f?quando(f):""):"em breve"}));if(!pronta)b.disabled=true;else b.addEventListener("click",()=>abrirAula(id));return b}),
  m.projeto_ponte?el("p",{class:"ponte",text:"Projeto do módulo: "+m.projeto_ponte}):null);
  if(m.aulas.some(a=>a[0]===atual)||(!atual&&mi<2))d.open=true;return d}))}
function abrirMetodo(){atual="metodo";const M=CU.metodologia;
 document.getElementById("aula").replaceChildren(...[el("h2",{text:"Como o curso funciona"}),M.map(s=>[s.titulo?el("h3",{text:s.titulo}):null,s.blocos.map(b=>Array.isArray(b)?el("ul",{},b.map(i=>el("li",{text:i}))):el("p",{text:b}))])].flat(Infinity).filter(Boolean));indice();document.getElementById("aula").scrollIntoView?.({block:"start"})}
function proxima(id){const l=todas(),i=l.findIndex(a=>a[0]===id);const n=l.slice(i+1).find(a=>a[2]);return n?n[0]:null}
function abrirAula(id,revisando){atual=id;const a=CU.aulas[id];const f=feitas.get(id);const P=[];
 P.push(el("h2",{text:titulo(id)}));
 const meta=[a.tempo_min?`cerca de ${a.tempo_min} min`:null,a.antes?`Antes: ${a.antes}`:null].filter(Boolean).join(" · ");if(meta)P.push(el("p",{class:"meta",text:meta}));
 P.push(el("h3",{text:"Objetivo"}),el("p",{text:a.objetivo}));
 if(a.revisao&&a.revisao.length)P.push(el("h3",{text:"Aquecimento: lembra?"}),el("p",{class:"dica-r",text:"Tente responder de cabeça antes de abrir. Errar aqui ajuda a lembrar."}),a.revisao.map(r=>el("div",{class:"item"},el("p",{text:r.pergunta}),alterna(r.resposta+(r.de?`  (aula: ${titulo(r.de)})`:"")))));
 P.push(el("h3",{text:"Explicação"}),(a.explicacao||[]).map(p=>texto(p)));
 if(a.exemplo)P.push(el("h3",{text:"Exemplo"}),el("pre",{},el("code",{text:a.exemplo})));
 if(a.como_o_computador_le&&a.como_o_computador_le.length)P.push(el("h3",{text:"Como o computador lê"}),el("ol",{class:"passos"},a.como_o_computador_le.map(s=>el("li",{text:s}))));
 if(a.pratica&&a.pratica.length)P.push(el("h3",{text:"Prática"}),a.pratica.map((p,i)=>el("div",{class:"item"},el("p",{class:"tipo",text:`${i+1}. ${TIPOS[p.tipo]||p.tipo}`}),texto(p.enunciado),p.tipo==="criar"&&a.dicas&&a.dicas.length?escada(a.dicas):null,alterna(p.resposta))));
 else if(a.exercicio)P.push(el("h3",{text:"Exercício"}),texto(a.exercicio),alterna(a.resposta||""));
 if(a.erros_comuns&&a.erros_comuns.length)P.push(el("h3",{text:"Erros comuns"}),el("ul",{},a.erros_comuns.map(e=>el("li",{text:e}))));
 if(a.checagem&&a.checagem.length)P.push(el("h3",{text:"Antes de marcar como feita"}),el("ul",{class:"check"},a.checagem.map((c,i)=>el("li",{},el("label",{},el("input",{type:"checkbox",id:`ck-${id}-${i}`}),el("span",{text:c}))))));
 if(a.comunique)P.push(el("h3",{text:"No Comunique"}),el("p",{text:a.comunique}));
 const bFeita=el("button",{class:"bt pri",type:"button",text:f?"Feita (desmarcar)":"Marcar como feita"});bFeita.addEventListener("click",()=>{f?feitas.delete(id):feitas.set(id,{t:Date.now(),r:0});salvar();abrirAula(id)});
 const acoes=[bFeita];
 if(f&&vence(f)<=Date.now()){const bR=el("button",{class:"bt",type:"button",text:"Revisei hoje"});bR.addEventListener("click",()=>{f.r+=1;f.t=Date.now()-0;feitas.set(id,f);salvar();abrirAula(id)});acoes.push(bR)}
 const n=proxima(id);if(n){const bN=el("button",{class:"bt",type:"button",text:"Próxima aula"});bN.addEventListener("click",()=>abrirAula(n));acoes.push(bN)}
 if(f)P.push(el("p",{class:"meta",text:quando(f)}));
 P.push(el("div",{class:"acoes"},acoes));
 document.getElementById("aula").replaceChildren(...P.flat(Infinity).filter(Boolean));indice();document.getElementById("aula").scrollIntoView?.({block:"start"})}
indice();
// ---------- fim do curso ----------
"""

CSS = """/* curso-v2 */
.aula .meta,.meta-mod{font:500 13px var(--b);color:var(--muted);margin:0}
.meta-mod{padding:0 14px 8px}
.ponte{font:600 12.5px var(--b);color:var(--accent);padding:8px 14px 12px;margin:0;border-top:1px dashed var(--line)}
.aula .item{border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:8px;min-width:0}
.aula .tipo{font:700 12.5px var(--b);color:var(--accent);text-transform:uppercase;letter-spacing:.06em}
.aula pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.aula pre.resp{background:var(--areia);border-radius:8px;padding:10px 12px}
.aula .dica-r{font-size:13px;color:var(--muted)}
.aula ul{margin:0;padding-left:20px;display:grid;gap:6px}
.aula ul.check{list-style:none;padding:0}.aula ul.check label{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.aula ul.check input{width:18px;height:18px;margin-top:2px;accent-color:var(--accent)}
.bloco-topo{border-bottom:1px solid var(--line);padding:4px 0}
.bloco-topo.rev{background:var(--leaf)}.rev-t{font:700 13px var(--b);padding:8px 14px 2px;margin:0}
.aula-l .ok.rev-p{border-color:var(--ambar);background:var(--ambar)}
.aula-l.metodo{font-weight:700}
.aula ol.passos{margin:0;padding-left:22px;display:grid;gap:4px;font:500 13.5px var(--b)}
.aula .dicas{display:grid;gap:6px}.aula .dica{background:var(--leaf);border-radius:8px;padding:8px 12px;font-size:14px}
"""


def main():
    curso = json.loads(CURSO.read_text())
    if METODO.exists():
        corpo = METODO.read_text()
        curso["metodologia"] = md_para_secoes(corpo)
    html = PAGINA.read_text()
    dado = json.dumps(curso, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html, n = re.subn(r'(<script id="curso" type="application/json">)(.*?)(</script>)',
                      lambda m: m.group(1) + dado + m.group(3), html, count=1, flags=re.S)
    assert n == 1, "não achei o JSON do curso"
    if "// ---------- fim do curso ----------" in html:
        html, n = re.subn(r"// ---------- curso ----------.*?// ---------- fim do curso ----------\n",
                          lambda m: JS, html, count=1, flags=re.S)
    else:
        html, n = re.subn(r"// ---------- curso ----------.*?\nindice\(\);\n",
                          lambda m: JS, html, count=1, flags=re.S)
    assert n == 1, "não achei o bloco do curso"
    if "/* curso-v2 */" not in html:
        html = html.replace("</style>", CSS + "</style>", 1)
    PAGINA.write_text(html)
    tot = sum(len(m["aulas"]) for m in curso["modulos"])
    prontas = sum(1 for m in curso["modulos"] for a in m["aulas"] if a[2])
    print(f"ok: {prontas} de {tot} aulas prontas; metodologia: {'sim' if 'metodologia' in curso else 'não'}")


if __name__ == "__main__":
    main()
