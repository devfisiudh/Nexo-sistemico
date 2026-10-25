// admin/js/editor-rico.js — Editor enriquecido (tipo Word / blog) para el panel.
//
// Objetivo: escribir o pegar texto y que el formato se reconozca solo.
//
// Cómo funciona:
//   · Un <textarea> sigue siendo el campo del formulario (fuente de verdad):
//     guarda el HTML resultante, de modo que rellenar(), construirDatos(),
//     los contadores y la validación siguen funcionando sin cambios.
//   · Sobre él se monta una barra de herramientas + un <div contenteditable>
//     donde se escribe. Cada cambio se sincroniza hacia el textarea.
//   · El pegado (Ctrl+V) se intercepta: se limpia el HTML del portapapeles
//     (etiquetas de Word, estilos inline, clases mso-) y se reducen a los
//     formatos básicos: negrita, cursiva, subrayado, tachado, títulos,
//     listas, citas, enlaces e imágenes.
//   · La alineación se guarda como clase (.txt-centro, .txt-der,
//     .txt-justificado) porque el sanitizador del portal elimina los
//     atributos style y las clases sí se conservan.
//
// Seguridad: el portal NUNCA mete esto a innerHTML en crudo; pasa por
// sanitizar() (allowlist de js/utils/sanitizar.js) antes de mostrarse.

/* ══════════════════════════════════════════════════════════════════════════
   UTILIDADES DE TEXTO
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Texto visible de un fragmento HTML (sin etiquetas).
 * Se usa para contadores y para validar longitudes mínimas.
 */
export function textoPlano(html) {

    if (!html) return '';

    const caja = document.createElement('div');
    caja.innerHTML = String(html);

    caja.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    caja.querySelectorAll(
        'p,div,h1,h2,h3,h4,h5,h6,li,blockquote,tr,hr'
    ).forEach((n) => n.append('\n'));

    return (caja.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Escapa texto plano para poder insertarlo como HTML. */
function escapar(texto) {
    const caja = document.createElement('div');
    caja.textContent = String(texto ?? '');
    return caja.innerHTML;
}

/**
 * Convierte el contenido guardado en HTML listo para el contenteditable.
 * El texto plano de siempre (con saltos de línea) se convierte en párrafos;
 * si ya es HTML se deja tal cual (el portal lo sanitiza al mostrarlo).
 */
function aHTMLeditable(valor) {

    const texto = String(valor ?? '').trim();

    if (!texto) return '';
    if (/<[a-z][\s\S]*>/i.test(texto)) return texto;

    return texto
        .split(/\n{2,}/)
        .map((bloque) => `<p>${escapar(bloque).replace(/\n/g, '<br>')}</p>`)
        .join('');
}


/* ══════════════════════════════════════════════════════════════════════════
   NORMALIZACIÓN
   ══════════════════════════════════════════════════════════════════════════ */

const CLASES_ALINEACION = {
    center: 'txt-centro',
    right: 'txt-der',
    justify: 'txt-justificado'
};

/**
 * Cambia style="text-align: center" por la clase equivalente.
 * El sanitizador del portal elimina los atributos style: sin esto, la
 * alineación elegida en el editor no se vería nunca en el portal.
 */
function normalizarAlineacion(raiz) {

    raiz.querySelectorAll('[style*="text-align" i]').forEach((el) => {

        const estilos = el.getAttribute('style') || '';
        const coincidencia = estilos.match(/text-align\s*:\s*([^;"']+)/i);

        if (!coincidencia) return;

        const alineacion = coincidencia[1]
            .trim()
            .toLowerCase()
            .replace(/^-?(moz|webkit)-/, '');

        const resto = estilos
            .replace(/text-align\s*:[^;"']*;?/ig, '')
            .replace(/;\s*;/g, ';')
            .trim();

        if (resto) el.setAttribute('style', resto);
        else el.removeAttribute('style');

        Object.values(CLASES_ALINEACION).forEach((clase) => el.classList.remove(clase));

        const clase = CLASES_ALINEACION[alineacion];
        if (clase) el.classList.add(clase);
    });
}


/* ══════════════════════════════════════════════════════════════════════════
   INSERCIÓN (pegar / soltar) SIN ESTRUCTURA IMPOSIBLE
   ══════════════════════════════════════════════════════════════════════════

   El navegador inserta lo que se pega ahí donde está el cursor, y eso puede
   producir HTML que no tiene sentido:

     · pegar párrafos con el cursor dentro de un título → <h2><p>...</p></h2>
     · pegar una lista dentro de un párrafo             → <p><ul>...</ul></p>

   El portal lo mostraría igualmente, pero con el aspecto equivocado (todo el
   texto pegado saldría como título, por ejemplo). Estas dos rutinas corrigen
   el resultado justo después de pegar. */

// Lo que nunca debe ir dentro de un <p> o de un título.
const BLOQUES = 'p,div,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,table,figure,pre,hr,section,article';

// Bloques cuyo contenido debe ser texto (títulos y párrafos).
const ANFITRIONES = 'p,h1,h2,h3,h4,h5,h6';

/** ¿El HTML que llega del portapapeles trae estructura de bloque? */
function contieneBloques(html) {

    if (!html) return false;

    const documento = new DOMParser().parseFromString(String(html), 'text/html');

    return Boolean(documento.body.querySelector(BLOQUES));
}

/** Elemento de bloque que contiene el cursor (null si escribe en la raíz). */
function bloqueDelCursor(cuerpo) {

    const seleccion = window.getSelection();

    let nodo = seleccion && seleccion.rangeCount
        ? seleccion.getRangeAt(0).startContainer
        : null;

    while (nodo && nodo !== cuerpo) {
        if (nodo.nodeType === Node.ELEMENT_NODE && nodo.matches(ANFITRIONES)) return nodo;
        nodo = nodo.parentNode;
    }

    return null;
}

/** Deja el cursor al final del nodo indicado. */
function colocarCaretFinal(nodo) {

    if (!nodo) return;

    const rango = document.createRange();
    rango.selectNodeContents(nodo);
    rango.collapse(false);

    const seleccion = window.getSelection();
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
}

/**
 * Saca los bloques que hayan quedado dentro de un párrafo o de un título
 * (que no admiten bloques dentro) y los coloca a continuación, en orden.
 * El cursor se conserva: se guarda el nodo sobre el que está y se vuelve a
 * poner al terminar, porque mover un nodo puede descolocar la selección.
 */
function desanidarBloques(raiz) {

    const seleccion = window.getSelection();
    const foco = seleccion && seleccion.rangeCount && raiz.contains(seleccion.anchorNode)
        ? { nodo: seleccion.anchorNode, offset: seleccion.anchorOffset }
        : null;

    for (let ronda = 0; ronda < 6; ronda++) {

        let huboMovimiento = false;

        for (const host of Array.from(raiz.querySelectorAll(ANFITRIONES))) {

            // Solo los bloques exteriores: los que cuelgan de otro ya
            // saldrán con él.
            const internos = [];

            for (const candidato of host.querySelectorAll(BLOQUES)) {
                if (internos.some((nodo) => nodo.contains(candidato))) continue;
                internos.push(candidato);
            }

            if (!internos.length) continue;

            let ref = host;
            for (const bloque of internos) {
                ref.after(bloque);   // mueve el nodo, no lo copia
                ref = bloque;
                huboMovimiento = true;
            }

            // El título/párrafo se quedó vacío: no aporta una línea en blanco.
            if (!host.textContent.trim() && !host.querySelector('img,br,hr')) {
                host.remove();
            }
        }

        if (!huboMovimiento) break;
    }

    if (foco && foco.nodo.isConnected && raiz.contains(foco.nodo)) {
        const maximo = foco.nodo.nodeType === Node.TEXT_NODE
            ? foco.nodo.length
            : foco.nodo.childNodes.length;

        const rango = document.createRange();
        rango.setStart(foco.nodo, Math.min(foco.offset, maximo));
        rango.collapse(true);

        const seleccion2 = window.getSelection();
        seleccion2.removeAllRanges();
        seleccion2.addRange(rango);
    }
}

/**
 * Inserta HTML limpio en el editor respetando la estructura:
 *  · con el cursor en un título, el contenido de bloque va DEBAJO del título
 *    (un título no puede contener párrafos);
 *  · en cualquier otro caso lo inserta donde esté el cursor, como hace
 *    cualquier editor de texto.
 */
function insertarContenido(cuerpo, html, textoPlano = '') {

    const host = bloqueDelCursor(cuerpo);
    const enTitulo = host && /^H[1-6]$/.test(host.tagName);

    if (enTitulo && contieneBloques(html)) {

        const caja = document.createElement('div');
        caja.innerHTML = html;

        const fragmento = document.createDocumentFragment();
        while (caja.firstChild) fragmento.appendChild(caja.firstChild);

        const ultimo = fragmento.lastChild;
        host.after(fragmento);
        colocarCaretFinal(ultimo);

    } else {
        try {
            document.execCommand('insertHTML', false, html);
        } catch {
            // Navegador sin insertHTML: al menos el texto, sin formato.
            if (textoPlano) document.execCommand('insertText', false, textoPlano);
        }
    }

    normalizarAlineacion(cuerpo);
    desanidarBloques(cuerpo);
}


/* ══════════════════════════════════════════════════════════════════════════
   LIMPIEZA DEL PORTAPAPELES (pegar desde Word, Google Docs, un blog...)
   ══════════════════════════════════════════════════════════════════════════ */

const ETIQUETAS_DESCARTAR = new Set([
    'script', 'style', 'head', 'title', 'meta', 'link', 'xml', 'noscript',
    'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea',
    'select', 'template', 'svg', 'math', 'body', 'html'
]);

// Etiquetas que se conservan con su significado original.
const ETIQUETAS_QUEDAN = new Set([
    'b', 'i', 'u', 's', 'code', 'br', 'p', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'mark',
    'sub', 'sup', 'small', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'figure', 'figcaption', 'pre'
]);

// Sinónimos que se canonicalizan (Word/Docs usan strong, em, strike...).
const SINONIMOS = {
    strong: 'b', em: 'i', cite: 'i', var: 'i', ins: 'u',
    strike: 's', del: 's', 'h1': 'h2'
};

const ATRIBUTOS_URL = { a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'] };

const ESQUEMAS_SEGUROS = /^https?:|^mailto:|^tel:|^\/|^#|^\.\//i;
const IMAGEN_DATA = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;

// Únicas clases que sobreviven a la limpieza: las de alineación.
// (Un `class="MsoNormal"` de Word no aporta nada en el portal.)
const CLASES_ALINEACION_PERMITIDAS = /^(txt-centro|txt-der|txt-justificado)$/;

/** Copia la alineación (clase txt-*) de un elemento a su sustituto. */
function heredarAlineacion(origen, destino) {
    const clases = String(origen.className || '')
        .split(/\s+/)
        .filter((clase) => CLASES_ALINEACION_PERMITIDAS.test(clase));

    clases.forEach((clase) => destino.classList.add(clase));
}

/** Elementos de bloque: sus hijos no se pueden pegar dentro de un párrafo. */
const ES_BLOQUE = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul',
    'ol', 'li', 'hr', 'table', 'tr', 'figure', 'pre', 'section', 'article'
]);


/** Reconoce el formato embebido en un style inline de Word/Docs. */
function formatoDeEstilo(estilo) {

    if (!estilo) return [];

    const salida = [];

    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(estilo)) salida.push('b');
    if (/font-style\s*:\s*italic/i.test(estilo)) salida.push('i');
    if (/text-decoration[^:]*:\s*[^;]*underline/i.test(estilo)) salida.push('u');
    if (/text-decoration[^:]*:\s*[^;]*(line-through|strikethrough)/i.test(estilo)) salida.push('s');

    return salida;
}

/**
 * Envuelve los hijos de `nodo` en las etiquetas dadas (b > i, por orden).
 * Devuelve la envoltura EXTERIOR: es la que hay que colocar en el árbol.
 */
function envolverHijos(nodo, etiquetas) {

    let destino = nodo;
    let exterior = null;

    for (const etiqueta of etiquetas) {
        const envoltura = nodo.ownerDocument.createElement(etiqueta);
        while (destino.firstChild) envoltura.appendChild(destino.firstChild);
        destino.appendChild(envoltura);
        if (!exterior) exterior = envoltura;
        destino = envoltura;
    }

    return exterior;
}

function desenvolver(nodo) {
    const padre = nodo.parentNode;
    if (!padre) return;
    while (nodo.firstChild) padre.insertBefore(nodo.firstChild, nodo);
    padre.removeChild(nodo);
}

function limpiarElemento(el) {

    const crudo = el.tagName.toLowerCase();

    // XML de Word/Docs (<o:p>, <w:sdt...>): solo interesa su contenido.
    if (crudo.includes(':')) {
        desenvolver(el);
        return;
    }

    const nombre = crudo;

    if (ETIQUETAS_DESCARTAR.has(nombre)) {
        el.remove();
        return;
    }

    const estilos = el.getAttribute('style') || '';
    const formato = formatoDeEstilo(estilos);

    // Sinónimos (strong → b, em → i, strike → s, h1 → h2...).
    const canonica = SINONIMOS[nombre];
    if (canonica && canonica !== nombre) {
        const nuevo = el.ownerDocument.createElement(canonica);
        while (el.firstChild) nuevo.appendChild(el.firstChild);
        if (formato.length) envolverHijos(nuevo, filtroFormato(formato, canonica));
        heredarAlineacion(el, nuevo);
        el.replaceWith(nuevo);
        limpiarAtributos(nuevo);
        return;
    }

    // <div> de Word/Docs: se comporta como párrafo (si no contiene bloques).
    if (nombre === 'div') {

        const conBloques = Array.from(el.children).some(
            (hijo) => ES_BLOQUE.has(hijo.tagName.toLowerCase().replace(/:.*/, ''))
        );

        if (conBloques) {
            // Contenedor de bloques: solo se conservan sus hijos.
            if (formato.length) envolverHijos(el, filtroFormato(formato, ''));
            desenvolver(el);
            return;
        }

        const parrafo = el.ownerDocument.createElement('p');
        while (el.firstChild) parrafo.appendChild(el.firstChild);
        if (formato.length) envolverHijos(parrafo, filtroFormato(formato, 'p'));
        heredarAlineacion(el, parrafo);
        el.replaceWith(parrafo);
        limpiarAtributos(parrafo);
        return;
    }

    // Etiqueta que no se conserva (span, font, abbr de Word...):
    // si llevaba formato embebido se convierte en etiquetas reales;
    // si no, se quita dejando el texto.
    if (!ETIQUETAS_QUEDAN.has(nombre)) {

        if (formato.length) {
            const envoltura = envolverHijos(el, filtroFormato(formato, nombre));
            if (envoltura && envoltura !== el) {
                heredarAlineacion(el, envoltura);
                el.replaceWith(envoltura);
            } else {
                desenvolver(el);
            }
        } else {
            desenvolver(el);
        }
        return;
    }

    // Etiqueta válida: el formato inline del style se aplica a sus hijos
    // sin perder el bloque (un <p style="font-weight:bold"> sigue siendo
    // un párrafo, con la negrita dentro).
    if (formato.length) {
        envolverHijos(el, filtroFormato(formato, nombre));
    }

    limpiarAtributos(el);
}

/** Evita envolver dos veces la misma etiqueta (<b style="font-weight:bold">). */
function filtroFormato(etiquetas, nombre) {
    return etiquetas.filter((etiqueta) => etiqueta !== nombre);
}

function limpiarAtributos(el) {

    const nombre = el.tagName.toLowerCase();
    const permitidos = ATRIBUTOS_URL[nombre] || [];

    for (const atributo of Array.from(el.attributes)) {

        const nombreAtributo = atributo.name.toLowerCase();

        // Las clases de alineación se conservan; el resto se descartan.
        if (nombreAtributo === 'class') {
            const vivas = String(atributo.value || '')
                .split(/\s+/)
                .filter((clase) => CLASES_ALINEACION_PERMITIDAS.test(clase));

            if (vivas.length) el.setAttribute('class', vivas.join(' '));
            else el.removeAttribute('class');

            continue;
        }

        if (!permitidos.includes(nombreAtributo)) {
            el.removeAttribute(atributo.name);
        }
    }

    if (nombre === 'a') {
        const href = (el.getAttribute('href') || '').trim();
        if (!href || !ESQUEMAS_SEGUROS.test(href)) {
            desenvolver(el);
            return;
        }
        el.setAttribute('rel', 'noopener noreferrer');
    }

    if (nombre === 'img') {
        const src = (el.getAttribute('src') || '').trim();
        if (!src || !(ESQUEMAS_SEGUROS.test(src) || IMAGEN_DATA.test(src))) {
            el.remove();
        }
    }
}

/**
 * Devuelve HTML limpio a partir de lo que haya en el portapapeles.
 * Conserva solo el formato básico y elimina el rastro de Word/Docs.
 */
export function limpiarPegado(html) {

    if (!html) return '';

    const documento = new DOMParser().parseFromString(String(html), 'text/html');

    // Primero la alineación: style="text-align:center" pasa a la clase
    // .txt-centro y así sobrevive al barrido de atributos de abajo.
    normalizarAlineacion(documento.body);

    Array.from(documento.body.querySelectorAll('*')).forEach((el) => {
        if (!el.isConnected) return;   // ya descartado por un ancestro
        limpiarElemento(el);
    });

    // Los NBSP de Word se convierten en espacios normales.
    documento.body.innerHTML = documento.body.innerHTML
        .replace(/\u00a0/g, ' ')
        .replace(/(<(p|li|h[1-6]|blockquote)>)\s*(<\/\2>)/gi, '$1<br>$3');

    return documento.body.innerHTML.trim();
}


/* ══════════════════════════════════════════════════════════════════════════
   ICONOS DE LA BARRA DE HERRAMIENTAS
   ══════════════════════════════════════════════════════════════════════════ */

const svg = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d}</svg>`;

const ICONOS = {
    izquierda: svg('<path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8"/>'),
    centro: svg('<path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8"/>'),
    derecha: svg('<path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8"/>'),
    enlace: svg('<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1"/>'),
    imagen: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M2.5 11.5 6 8.5l3 2.5 2-1.5 2.5 2"/>'),
    limpiar: svg('<path d="M6 3h8M9.5 3 7 13M3 13h5"/><path d="M11 6.5 13.5 11M13.5 6.5 11 11"/>'),
    regla: svg('<path d="M2 8h12"/>'),
    lista: svg('<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="3" cy="4" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="3" cy="12" r="1.2"/>'),
    numerada: svg('<path d="M6 4h8M6 8h8M6 12h8"/><path d="M2.5 2.5v3M1.8 5.5h1.4M1.8 7.5h1.4M1.8 9.8h1.4 2.4-1.6"/>'),
    cita: svg('<path d="M3 4.5h3.5V8c0 2-1.3 3.2-3 3.5M9 4.5h3.5V8c0 2-1.3 3.2-3 3.5"/>')
};


/* ══════════════════════════════════════════════════════════════════════════
   MONTAJE DEL EDITOR
   ══════════════════════════════════════════════════════════════════════════ */

// textarea → instancia (para que rellenar() pueda escribir en el editor)
const INSTANCIAS = new WeakMap();

const BARRA = `
    <div class="editor-rico-barra" role="toolbar" aria-label="Formato del texto">

        <button type="button" class="er-btn" data-cmd="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">&#8630;</button>
        <button type="button" class="er-btn" data-cmd="redo" title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">&#8631;</button>

        <span class="er-sep" aria-hidden="true"></span>

        <select class="er-formato" data-bloque title="Estilo de párrafo" aria-label="Estilo de párrafo">
            <option value="p">Párrafo</option>
            <option value="h2">Título</option>
            <option value="h3">Subtítulo</option>
            <option value="h4">Encabezado menor</option>
            <option value="blockquote">Cita</option>
        </select>

        <span class="er-sep" aria-hidden="true"></span>

        <button type="button" class="er-btn er-negrita" data-cmd="bold" title="Negrita (Ctrl+B)" aria-label="Negrita"><b>B</b></button>
        <button type="button" class="er-btn er-cursiva" data-cmd="italic" title="Cursiva (Ctrl+I)" aria-label="Cursiva"><i>I</i></button>
        <button type="button" class="er-btn er-subrayado" data-cmd="underline" title="Subrayado (Ctrl+U)" aria-label="Subrayado"><u>U</u></button>
        <button type="button" class="er-btn er-tachado" data-cmd="strikeThrough" title="Tachado" aria-label="Tachado"><s>S</s></button>
        <button type="button" class="er-btn er-mayusculas" data-cmd="mayusculas" title="Alternar MAYÚSCULAS / minúsculas" aria-label="Alternar mayúsculas y minúsculas">Aa</button>

        <span class="er-sep" aria-hidden="true"></span>

        <button type="button" class="er-btn" data-cmd="insertUnorderedList" title="Lista con viñetas" aria-label="Lista con viñetas">${ICONOS.lista}</button>
        <button type="button" class="er-btn" data-cmd="insertOrderedList" title="Lista numerada" aria-label="Lista numerada">${ICONOS.numerada}</button>

        <span class="er-sep" aria-hidden="true"></span>

        <button type="button" class="er-btn" data-cmd="justifyLeft" title="Alinear a la izquierda" aria-label="Alinear a la izquierda">${ICONOS.izquierda}</button>
        <button type="button" class="er-btn" data-cmd="justifyCenter" title="Centrar" aria-label="Centrar">${ICONOS.centro}</button>
        <button type="button" class="er-btn" data-cmd="justifyRight" title="Alinear a la derecha" aria-label="Alinear a la derecha">${ICONOS.derecha}</button>

        <span class="er-sep" aria-hidden="true"></span>

        <button type="button" class="er-btn" data-cmd="link" title="Insertar enlace (Ctrl+K)" aria-label="Insertar enlace">${ICONOS.enlace}</button>
        <button type="button" class="er-btn" data-cmd="imagen" title="Insertar imagen por URL" aria-label="Insertar imagen">${ICONOS.imagen}</button>
        <button type="button" class="er-btn" data-cmd="insertHorizontalRule" title="Línea horizontal" aria-label="Línea horizontal">${ICONOS.regla}</button>
        <button type="button" class="er-btn" data-cmd="removeFormat" title="Limpiar formato" aria-label="Limpiar formato">${ICONOS.limpiar}</button>
    </div>

    <div
        class="editor-rico-cuerpo"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        aria-label="Cuerpo del texto"
        data-placeholder="Escribe aquí el contenido. Puedes pegar texto de Word o un blog: se limpia y conserva solo el formato."
    ></div>
`;


/**
 * Monta el editor enriquecido sobre el campo indicado.
 *
 * @param {Element} raiz        Contenedor del formulario (el esqueleto).
 * @param {string}  selector    Selector del <textarea> fuente de verdad.
 * @param {object}  [opciones]  { placeholder, maximo }
 * @returns {object|null}       { obtenerHTML, texto, establecer, sincronizar }
 */
export function montarEditorRico(raiz, selector, opciones = {}) {

    const campo = typeof selector === 'string' ? raiz.querySelector(selector) : selector;

    if (!campo) return null;
    if (INSTANCIAS.has(campo)) return INSTANCIAS.get(campo);

    const envoltura = document.createElement('div');
    envoltura.className = 'editor-rico';
    envoltura.innerHTML = BARRA;

    campo.insertAdjacentElement('beforebegin', envoltura);
    campo.hidden = true;
    campo.required = false;   // la validación la hace construirDatos()

    const cuerpo = envoltura.querySelector('.editor-rico-cuerpo');
    const formatoBloque = envoltura.querySelector('[data-bloque]');

    if (opciones.placeholder) {
        cuerpo.dataset.placeholder = opciones.placeholder;
    }

    // Párrafos al pulsar Intro (en vez de <div> o <br> sueltos).
    try {
        document.execCommand('styleWithCSS', false, false);
        document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch { /* navegadores que no lo soportan: sin más */ }

    /* ── sincronización campo ↔ editor ─────────────────────────────────── */

    const obtenerHTML = () => {
        const clon = cuerpo.cloneNode(true);
        normalizarAlineacion(clon);
        return clon.innerHTML.trim();
    };

    // El placeholder del CSS depende de este atributo (un <p><br></p>
    // vacío no es un nodo :empty, así que no sirve el selector clásico).
    const marcarVacio = () => {
        const vacio = !cuerpo.textContent.trim()
            && !cuerpo.querySelector('img,hr,li');
        cuerpo.dataset.vacio = String(vacio);
    };

    const sincronizar = () => {
        campo.value = obtenerHTML();
        marcarVacio();
        // Los contadores escuchan 'input' en el textarea.
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const establecer = (valor) => {
        cuerpo.innerHTML = aHTMLeditable(valor);
        campo.value = obtenerHTML();
        marcarVacio();
    };

    const instancia = { obtenerHTML, texto: () => textoPlano(campo.value), establecer, sincronizar, cuerpo };

    INSTANCIAS.set(campo, instancia);

    cuerpo.innerHTML = aHTMLeditable(campo.value);
    campo.value = obtenerHTML();
    marcarVacio();

    /* ── comandos ──────────────────────────────────────────────────────── */

    const ejecutar = (cmd, valor = null) => {
        cuerpo.focus();
        try { document.execCommand(cmd, false, valor); } catch { return; }
        normalizarAlineacion(cuerpo);
        sincronizar();
        refrescarEstado();
    };

    const pedirUrl = (mensaje, porDefecto = 'https://') => {
        const url = window.prompt(mensaje, porDefecto);
        return url ? url.trim() : null;
    };

    const accion = {
        link: () => {
            const seleccion = window.getSelection();
            const textoSel = seleccion ? String(seleccion) : '';

            if (!textoSel) {
                mensajes('Selecciona primero el texto que quieres enlazar.', 'error');
                return;
            }

            const href = pedirUrl('¿A qué dirección apunta el enlace?');
            if (!href) return;

            if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) {
                mensajes('El enlace debe empezar por https://, mailto: o ser una ruta interna (/...).', 'error');
                return;
            }

            ejecutar('createLink', href);
        },
        imagen: () => {
            const src = pedirUrl('URL de la imagen (https://...):');
            if (!src) return;
            if (!/^(https?:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(src)) {
                mensajes('La imagen debe ser una URL https:// válida.', 'error');
                return;
            }
            ejecutar('insertImage', src);
        },

        // Alterna el texto seleccionado entre MAYÚSCULAS y minúsculas:
        // si hay letras en minúscula las sube; si no, las baja.
        mayusculas: () => {

            const seleccion = window.getSelection();

            if (!seleccion || seleccion.isCollapsed || !cuerpo.contains(seleccion.anchorNode)) {
                mensajes('Selecciona el texto que quieres pasar a MAYÚSCULAS o minúsculas.', 'error');
                return;
            }

            const texto = String(seleccion);
            const hayMinusculas = /[a-záéíóúüñ]/.test(texto);
            const nuevo = hayMinusculas ? texto.toUpperCase() : texto.toLowerCase();

            if (nuevo === texto) return;   // sin letras cambiables

            cuerpo.focus();
            // insertText reemplaza la selección y se puede deshacer (Ctrl+Z).
            try { document.execCommand('insertText', false, nuevo); } catch { return; }

            // Se vuelve a seleccionar lo escrito para poder alternar otra vez.
            try {
                const s = window.getSelection();
                for (let i = 0; i < nuevo.length; i++) s.modify('move', 'backward', 'character');
                for (let i = 0; i < nuevo.length; i++) s.modify('extend', 'forward', 'character');
            } catch { /* navegador sin modify: el cursor queda al final */ }

            normalizarAlineacion(cuerpo);
            sincronizar();
            refrescarEstado();
        }
    };

    // Mensajes del formulario: se apoyan en el mismo bloque que usa app.js.
    function mensajes(texto, tipo) {
        const zona = raiz.querySelector('#editor-message');
        if (zona) {
            zona.textContent = texto;
            zona.className = `editor-message editor-message-${tipo}`;
            zona.hidden = false;
            zona.scrollIntoView({ block: 'nearest' });
            return;
        }
        window.alert(texto);
    }

    // La barra no debe robarle el foco al texto: si no, al pulsar un botón
    // se perdería la selección y el formato se aplicaría a otro sitio.
    envoltura.querySelector('.editor-rico-barra').addEventListener('mousedown', (evento) => {
        if (evento.target.closest('button')) evento.preventDefault();
    });

    envoltura.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-cmd]');
        if (!boton) return;
        evento.preventDefault();
        const cmd = boton.dataset.cmd;
        if (accion[cmd]) accion[cmd]();
        else ejecutar(cmd);
    });

    formatoBloque.addEventListener('change', () => {
        const valor = formatoBloque.value;
        ejecutar('formatBlock', `<${valor}>`);
    });

    /* ── pegado limpio ─────────────────────────────────────────────────── */

    cuerpo.addEventListener('paste', (evento) => {

        evento.preventDefault();

        const datos = evento.clipboardData;
        if (!datos) return;

        const html = datos.getData('text/html');
        const plano = datos.getData('text/plain');

        const pegado = html
            ? limpiarPegado(html)
            : escalarPlano(plano);

        if (!pegado) return;

        insertarContenido(cuerpo, pegado, plano);
        sincronizar();
    });

    function escalarPlano(texto) {
        if (!texto) return '';
        return texto
            .split(/\n{2,}/)
            .map((bloque) => `<p>${escapar(bloque).replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    /* ── arrastrar y soltar de texto ───────────────────────────────────── */

    cuerpo.addEventListener('drop', (evento) => {

        const html = evento.dataTransfer?.getData('text/html');
        if (!html) return;   // texto normal: lo deja el navegador

        evento.preventDefault();

        const pegado = limpiarPegado(html);
        if (!pegado) return;

        insertarContenido(cuerpo, pegado);
        sincronizar();
    });

    /* ── atajos y estado de los botones ────────────────────────────────── */

    cuerpo.addEventListener('keydown', (evento) => {

        const tecla = evento.key.toLowerCase();

        if ((evento.ctrlKey || evento.metaKey) && tecla === 'k') {
            evento.preventDefault();
            accion.link();
        }
    });

    const refrescarEstado = () => {

        for (const boton of envoltura.querySelectorAll('[data-cmd]')) {
            const cmd = boton.dataset.cmd;
            if (!['bold', 'italic', 'underline', 'strikeThrough',
                'insertUnorderedList', 'insertOrderedList',
                'justifyLeft', 'justifyCenter', 'justifyRight'].includes(cmd)) continue;

            let activo = false;
            try { activo = document.queryCommandState(cmd); } catch { activo = false; }
            boton.classList.toggle('er-activo', activo);
            boton.setAttribute('aria-pressed', String(activo));
        }

        let bloque = 'p';
        try { bloque = (document.queryCommandValue('formatBlock') || 'p').toLowerCase(); } catch { bloque = 'p'; }
        if (!['p', 'h2', 'h3', 'h4', 'blockquote'].includes(bloque)) bloque = 'p';
        formatoBloque.value = bloque;
    };

    document.addEventListener('selectionchange', () => {
        if (document.activeElement === cuerpo) refrescarEstado();
    });

    cuerpo.addEventListener('input', sincronizar);
    cuerpo.addEventListener('keyup', refrescarEstado);
    cuerpo.addEventListener('mouseup', refrescarEstado);
    cuerpo.addEventListener('blur', sincronizar);

    refrescarEstado();

    return instancia;
}


/**
 * Usado por rellenar(): si el control tiene editor montado, el valor se
 * vuelca en el editor (y se queda listo para editarlo) en vez de en .value.
 * @returns {boolean} true si lo gestionó el editor.
 */
export function asignarValorEditorRico(control, valor) {

    const instancia = INSTANCIAS.get(control);

    if (!instancia) return false;

    instancia.establecer(valor ?? '');
    return true;
}
