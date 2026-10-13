'use strict';

/* ---------- Configuração ---------- */
const CHAVE = 'analise-fatura:v1';
const CATEGORIAS_PADRAO = ['Alimentação', 'Mercado', 'Transporte', 'Assinaturas', 'Compras', 'Contas', 'Taxas', 'Pagamentos', 'Outros'];
const CORES = ['#4c5fd5', '#e07a5f', '#2a9d8f', '#e9b44c', '#8e5ba8', '#5fa8d3', '#c8553d', '#6b9080', '#d17ba0', '#7d8597', '#a3b18a', '#3d405b'];

// Categorização automática na importação: [categoria, [trechos do título em minúsculas]].
// A primeira regra que casar vence. Edite à vontade.
const REGRAS = [
  ['Taxas', ['iof de']],
  ['Transporte', ['uber', '99 ride', 'posto', 'estacionamento']],
  ['Mercado', ['supermercado', 'extrabom', 'hortifrutti', 'viana produtos', 'casa show']],
  ['Alimentação', ['imperio do sabor', 'hot dog', 'ifd*', 'padaria', 'recanto das garcas']],
  ['Assinaturas', ['google', 'disney']],
  ['Compras', ['amazon', 'shopee', 'dafiti', 'riachuelo', 'jim.com']],
  ['Contas', ['conta vivo']],
];

/* ---------- Estado e persistência ---------- */
let estado = carregar();
const filtro = { texto: '', categoria: '' };

function carregar() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE));
    if (s && Array.isArray(s.lancamentos) && Array.isArray(s.categorias)) {
      s.regras = s.regras || {}; // dados salvos antes das regras personalizadas
      return s;
    }
  } catch (e) { /* dados corrompidos: começa do zero */ }
  // regras: { "titulo em minúsculas": { titulo, categoria } }
  return { lancamentos: [], categorias: [...CATEGORIAS_PADRAO], regras: {} };
}

function salvar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(estado)); }
  catch (e) { alert('Não foi possível salvar no armazenamento do navegador.'); }
}

/* ---------- Utilitários ---------- */
const $ = id => document.getElementById(id);
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cor = c => { const i = estado.categorias.indexOf(c); return i < 0 ? '#999' : CORES[i % CORES.length]; };

function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...filhos);
  return el;
}

// Aceita "1.234,56", "- 3.724,21" e "12.5".
function lerValor(s) {
  s = String(s).trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

/* ---------- Importação do CSV ---------- */
function lerCSV(txt) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  const fechaLinha = () => {
    linha.push(campo); campo = '';
    if (linha.some(x => x !== '')) linhas.push(linha);
    linha = [];
  };
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; fechaLinha(); }
    else campo += c;
  }
  fechaLinha();
  return linhas;
}

const chaveRegra = titulo => titulo.trim().toLowerCase();

// A regra vale se o texto dela aparece em qualquer parte do título; a de texto mais longo vence.
function regraSalva(titulo) {
  const t = titulo.toLowerCase();
  let melhor = null;
  for (const [k, r] of Object.entries(estado.regras)) {
    if (k && t.includes(k) && (!melhor || k.length > melhor.k.length)) melhor = { k, r };
  }
  return melhor && melhor.r;
}

function sugerir(titulo, valor) {
  const salva = regraSalva(titulo); // regras criadas por você têm prioridade
  if (salva) return salva.categoria;
  if (valor < 0) return 'Pagamentos';
  const t = titulo.toLowerCase();
  for (const [cat, termos] of REGRAS) if (termos.some(x => t.includes(x))) return cat;
  return 'Outros';
}

function importar(txt) {
  const [cab, ...linhas] = lerCSV(txt.replace(/^\uFEFF/, ''));
  const nomes = (cab || []).map(c => c.trim().toLowerCase());
  const [d, t, v] = ['date', 'title', 'amount'].map(n => nomes.indexOf(n));
  if (d < 0 || t < 0 || v < 0) { alert('CSV inválido: o cabeçalho deve ter as colunas date, title e amount.'); return; }

  // Toda linha do arquivo vira um registro novo; não há checagem de duplicados.
  const novos = [];
  for (const r of linhas) {
    const valor = lerValor(r[v] ?? '');
    const data = (r[d] || '').trim();
    if (!data || isNaN(valor)) continue;
    const titulo = (r[t] || '').trim();
    novos.push({ id: novoId(), data, titulo, valor, categoria: sugerir(titulo, valor) });
  }
  if (!novos.length) { alert('Nenhum lançamento encontrado no arquivo.'); return; }

  const aplicar = sobrescrever => {
    if (sobrescrever) estado.lancamentos = [];
    novos.forEach(l => { if (!estado.categorias.includes(l.categoria)) estado.categorias.push(l.categoria); });
    estado.lancamentos.push(...novos);
    salvar();
    render();
  };

  if (!estado.lancamentos.length) { aplicar(false); return; }

  const dlg = $('dlg-importar');
  $('dlg-texto').textContent = `O arquivo tem ${novos.length} lançamento(s) e a lista atual tem ${estado.lancamentos.length}. Adicionar como registros novos (sem checar duplicados) ou sobrescrever os lançamentos atuais? Regras e categorias são mantidas.`;
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue === 'adicionar') aplicar(false);
    else if (dlg.returnValue === 'sobrescrever') aplicar(true);
  };
  dlg.showModal();
}

/* ---------- Edição ---------- */
// Edições de data, título e valor só atualizam os totais e gráficos,
// para não recriar a tabela (e tirar o foco) enquanto você navega com Tab.
function editar(l, campo, valor) {
  l[campo] = valor;
  salvar();
  renderGraficos();
}

function mudarCategoria(l, cat) {
  l.categoria = cat;
  const iguais = estado.lancamentos.filter(x => x !== l && chaveRegra(x.titulo) === chaveRegra(l.titulo) && x.categoria !== cat);
  const pergunta = iguais.length
    ? `Aplicar "${cat}" também a ${iguais.length} outro(s) lançamento(s) "${l.titulo}" e usar essa categoria nas próximas importações?`
    : `Usar "${cat}" para "${l.titulo}" nas próximas importações?`;
  if (confirm(pergunta)) {
    iguais.forEach(x => { x.categoria = cat; });
    estado.regras[chaveRegra(l.titulo)] = { titulo: l.titulo, categoria: cat }; // cria ou atualiza a regra
    salvar();
    render();
    return;
  }
  salvar();
  const sel = document.querySelector(`tr[data-id="${l.id}"] select`);
  if (sel) sel.style.setProperty('--c', cor(cat));
  renderGraficos();
}

function excluir(l) {
  if (!confirm(`Excluir "${l.titulo}"?`)) return;
  estado.lancamentos = estado.lancamentos.filter(x => x !== l);
  salvar();
  render();
}

/* ---------- Renderização ---------- */
function seletorCategoria(atual, aoMudar) {
  const sel = h('select', { onchange: aoMudar, ariaLabel: 'Categoria' },
    ...estado.categorias.map(c => h('option', { value: c, textContent: c, selected: c === atual })));
  sel.style.setProperty('--c', cor(atual));
  return sel;
}

function linha(l) {
  const celulas = [
    h('input', { type: 'date', value: l.data, ariaLabel: 'Data', onchange: e => editar(l, 'data', e.target.value) }),
    h('input', { type: 'text', value: l.titulo, ariaLabel: 'Descrição', onchange: e => editar(l, 'titulo', e.target.value.trim() || l.titulo) }),
    seletorCategoria(l.categoria, e => mudarCategoria(l, e.target.value)),
    h('input', {
      type: 'text', inputMode: 'decimal', className: 'valor', value: num(l.valor), ariaLabel: 'Valor',
      onchange: e => {
        const v = lerValor(e.target.value);
        if (isNaN(v)) { e.target.value = num(l.valor); return; }
        e.target.value = num(v);
        e.target.closest('tr').classList.toggle('credito', v < 0);
        editar(l, 'valor', v);
      },
    }),
    h('button', { className: 'icone', textContent: '×', title: 'Excluir lançamento', ariaLabel: 'Excluir lançamento', onclick: () => excluir(l) }),
  ];
  const tr = h('tr', {}, ...celulas.map(c => h('td', {}, c)));
  tr.dataset.id = l.id;
  if (l.valor < 0) tr.classList.add('credito');
  return tr;
}

// Ordenação da lista: campo (data, titulo, categoria, valor) e direção (asc, desc).
const ordem = { campo: 'data', dir: 'desc' };

function comparar(a, b) {
  const x = a[ordem.campo], y = b[ordem.campo];
  const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { sensitivity: 'base' });
  return ordem.dir === 'asc' ? r : -r;
}

function filtrados() {
  const q = filtro.texto.toLowerCase();
  return estado.lancamentos
    .filter(l => (!filtro.categoria || l.categoria === filtro.categoria) && (!q || l.titulo.toLowerCase().includes(q)))
    .sort(comparar);
}

function renderCabecalho() {
  document.querySelectorAll('th[data-campo]').forEach(th => {
    if (th.dataset.campo === ordem.campo) th.setAttribute('aria-sort', ordem.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
}

function renderFiltro() {
  const sel = $('filtro-categoria');
  sel.replaceChildren(h('option', { value: '', textContent: 'Todas as categorias' }),
    ...estado.categorias.map(c => h('option', { value: c, textContent: c })));
  if (!estado.categorias.includes(filtro.categoria)) filtro.categoria = '';
  sel.value = filtro.categoria;
}

function renderTabela() {
  const lista = filtrados();
  $('linhas').replaceChildren(...lista.map(linha));
  $('vazio').hidden = estado.lancamentos.length > 0;
}

function renderGraficos() {
  const gastos = estado.lancamentos.filter(l => l.valor > 0);
  const total = gastos.reduce((s, l) => s + l.valor, 0);
  const por = {};
  gastos.forEach(l => { por[l.categoria] = (por[l.categoria] || 0) + l.valor; });
  const itens = Object.entries(por).sort((a, b) => b[1] - a[1]);

  $('total').textContent = brl(total);

  let acum = 0;
  const fatias = itens.map(([c, v]) => {
    const ini = acum; acum += v / total * 100;
    return `${cor(c)} ${ini}% ${acum}%`;
  });
  $('rosca').style.background = itens.length ? `conic-gradient(${fatias.join(',')})` : 'var(--linha)';

  const maior = itens.length ? itens[0][1] : 1;
  $('legenda').replaceChildren(...itens.map(([c, v]) => {
    const barra = h('span', { className: 'barra' }, h('i'));
    barra.firstChild.style.width = `${v / maior * 100}%`;
    barra.firstChild.style.background = cor(c);
    const ponto = h('span', { className: 'ponto' });
    ponto.style.background = cor(c);
    const btn = h('button', {
      className: 'item', title: 'Filtrar a lista por esta categoria',
      onclick: () => { filtro.categoria = filtro.categoria === c ? '' : c; renderFiltro(); renderTabela(); renderGraficos(); },
    }, ponto, h('span', { textContent: c }), h('span', { textContent: `${brl(v)} ` }, h('span', { className: 'pct', textContent: `${(v / total * 100).toFixed(1).replace('.', ',')}%` })), barra);
    btn.setAttribute('aria-pressed', String(filtro.categoria === c));
    return h('li', {}, btn);
  }));

  const lista = filtrados();
  const soma = lista.filter(l => l.valor > 0).reduce((s, l) => s + l.valor, 0);
  $('contagem').textContent = `${lista.length} lançamento(s) · ${brl(soma)}`;
}

function renderRegras() {
  const regras = Object.entries(estado.regras).sort((a, b) => a[1].titulo.localeCompare(b[1].titulo, 'pt-BR'));
  $('regras-resumo').textContent = `Regras salvas (${regras.length})`;
  $('regras').replaceChildren(...(regras.length ? regras.map(([chaveInicial, r]) => {
    let k = chaveInicial; // chave atual desta regra (muda se o texto for editado)
    const texto = h('input', {
      type: 'text', value: r.titulo, ariaLabel: 'Texto da regra',
      onchange: e => { // salva ao sair do campo
        const novo = e.target.value.trim();
        const nk = chaveRegra(novo);
        if (!nk) { e.target.value = r.titulo; return; }
        if (nk !== k && estado.regras[nk]) { alert('Já existe uma regra com esse texto.'); e.target.value = r.titulo; return; }
        delete estado.regras[k];
        r.titulo = novo;
        k = nk;
        estado.regras[k] = r;
        salvar();
        $('regras-resumo').textContent = `Regras salvas (${Object.keys(estado.regras).length})`;
      },
    });
    const sel = seletorCategoria(r.categoria, e => { r.categoria = e.target.value; salvar(); e.target.style.setProperty('--c', cor(r.categoria)); });
    const del = h('button', {
      className: 'icone', textContent: '×', title: 'Excluir regra', ariaLabel: 'Excluir regra',
      onclick: () => { delete estado.regras[k]; salvar(); renderRegras(); },
    });
    return h('li', {}, texto, sel, del);
  }) : [h('li', { className: 'vazia', textContent: 'Nenhuma regra ainda. Ao mudar a categoria de um gasto, você pode salvar uma.' })]));
}

function render() { renderFiltro(); renderCabecalho(); renderTabela(); renderGraficos(); renderRegras(); }

/* ---------- Backup em JSON (transportar os dados entre navegadores/computadores) ---------- */
function baixarJSON() {
  const pacote = { app: 'analise-fatura', versao: 1, exportadoEm: new Date().toISOString(), dados: estado };
  const url = URL.createObjectURL(new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `analise-fatura-${new Date().toLocaleDateString('sv-SE')}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Valida e limpa os dados vindos do arquivo; devolve null se o formato não servir.
function normalizar(d) {
  if (!d || !Array.isArray(d.lancamentos) || !Array.isArray(d.categorias)) return null;
  const lancamentos = d.lancamentos
    .filter(l => l && typeof l.data === 'string' && typeof l.titulo === 'string' && typeof l.categoria === 'string' && typeof l.valor === 'number' && isFinite(l.valor))
    .map(l => ({ id: typeof l.id === 'string' && l.id ? l.id : novoId(), data: l.data, titulo: l.titulo, valor: l.valor, categoria: l.categoria }));
  const categorias = [...new Set(d.categorias.filter(c => typeof c === 'string' && c.trim()))];
  const regras = {};
  Object.values(d.regras && typeof d.regras === 'object' ? d.regras : {}).forEach(r => {
    if (r && typeof r.titulo === 'string' && typeof r.categoria === 'string' && chaveRegra(r.titulo)) {
      regras[chaveRegra(r.titulo)] = { titulo: r.titulo.trim(), categoria: r.categoria };
    }
  });
  [...lancamentos, ...Object.values(regras)].forEach(x => { if (!categorias.includes(x.categoria)) categorias.push(x.categoria); });
  return { lancamentos, categorias, regras };
}

function importarJSON(txt) {
  let pacote;
  try { pacote = JSON.parse(txt); } catch (e) { alert('Arquivo JSON inválido.'); return; }
  const novo = normalizar(pacote && pacote.dados ? pacote.dados : pacote);
  if (!novo) { alert('Esse JSON não parece ser um backup desta ferramenta.'); return; }
  const temDados = estado.lancamentos.length || Object.keys(estado.regras).length;
  const resumo = `${novo.lancamentos.length} lançamento(s), ${Object.keys(novo.regras).length} regra(s) e ${novo.categorias.length} categoria(s)`;
  if (temDados && !confirm(`Substituir TODOS os dados atuais por ${resumo} do arquivo? Os dados atuais serão perdidos.`)) return;
  estado = novo;
  filtro.texto = ''; filtro.categoria = ''; $('busca').value = '';
  salvar();
  render();
}

/* ---------- Eventos ---------- */
// Clicar no cabeçalho ordena por aquela coluna; clicar de novo inverte a direção.
document.querySelectorAll('th[data-campo]').forEach(th => {
  th.querySelector('button').onclick = () => {
    const campo = th.dataset.campo;
    if (ordem.campo === campo) ordem.dir = ordem.dir === 'asc' ? 'desc' : 'asc';
    else { ordem.campo = campo; ordem.dir = (campo === 'data' || campo === 'valor') ? 'desc' : 'asc'; }
    renderCabecalho();
    renderTabela();
  };
});

$('btn-importar').onclick = () => $('arquivo').click();
$('arquivo').onchange = e => {
  const arq = e.target.files[0];
  if (!arq) return;
  const leitor = new FileReader();
  leitor.onload = () => importar(String(leitor.result));
  leitor.readAsText(arq, 'utf-8');
  e.target.value = '';
};

$('busca').oninput = e => { filtro.texto = e.target.value; renderTabela(); renderGraficos(); };
$('filtro-categoria').onchange = e => { filtro.categoria = e.target.value; renderTabela(); renderGraficos(); };

$('btn-adicionar').onclick = () => {
  filtro.texto = ''; filtro.categoria = ''; $('busca').value = '';
  const l = { id: novoId(), data: new Date().toLocaleDateString('sv-SE'), titulo: 'Novo gasto', valor: 0, categoria: 'Outros' };
  estado.lancamentos.push(l);
  salvar();
  render();
  const campo = document.querySelector(`tr[data-id="${l.id}"] input[type="text"]`);
  if (campo) { campo.focus(); campo.select(); }
};

$('btn-categoria').onclick = () => {
  const nome = (prompt('Nome da nova categoria:') || '').trim();
  if (!nome) return;
  if (estado.categorias.some(c => c.toLowerCase() === nome.toLowerCase())) { alert('Essa categoria já existe.'); return; }
  estado.categorias.push(nome);
  salvar();
  render();
};

$('btn-limpar-lancamentos').onclick = () => {
  if (!estado.lancamentos.length) return;
  if (!confirm(`Excluir os ${estado.lancamentos.length} lançamento(s)? Regras e categorias serão mantidas.`)) return;
  estado.lancamentos = [];
  salvar();
  render();
};

$('btn-limpar').onclick = () => {
  if (!confirm('Apagar todos os dados salvos no navegador (lançamentos, categorias e alterações)? Essa ação não pode ser desfeita.')) return;
  localStorage.clear();
  estado = carregar();
  filtro.texto = ''; filtro.categoria = ''; $('busca').value = '';
  render();
};

$('btn-baixar-json').onclick = baixarJSON;
$('btn-importar-json').onclick = () => $('arquivo-json').click();
$('arquivo-json').onchange = e => {
  const arq = e.target.files[0];
  if (!arq) return;
  const leitor = new FileReader();
  leitor.onload = () => importarJSON(String(leitor.result));
  leitor.readAsText(arq, 'utf-8');
  e.target.value = '';
};

render();
