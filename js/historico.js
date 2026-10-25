// js/historico.js — Histórico público: una página, dos pestañas.
//
//   /historico                → pestaña de Noticias (por defecto)
//   /historico?seccion=eventos → pestaña de Eventos
//
// Cada pestaña muestra SOLO los títulos (decisión de diseño: el histórico es
// un índice del pasado, no una portada más). Al pulsar un título se abre el
// detalle compacto: /articulo?slug=... o /evento?slug=...
//
// Los datos vienen de js/data/historial.js, que llama a las RPC de
// sql/08_historial_publico.sql.

import { listarHistoricoNoticias, listarHistoricoEventos } from './data/historial.js';
import { escapar } from './utils/formato.js';

const SECCIONES_VALIDAS = new Set(['noticias', 'eventos']);

// Una sola petición por sección aunque se cambie de pestaña varias veces.
const cache = { noticias: null, eventos: null };

let seccionActual = 'noticias';

document.addEventListener('DOMContentLoaded', () => {

    const lista = document.getElementById('historico-lista');
    if (!lista) return;

    seccionActual = seccionDeLaUrl();

    pintarPestanas();
    cargarSeccion(seccionActual);

    document.querySelectorAll('.historico-tab').forEach((boton) => {
        boton.addEventListener('click', () => cambiarSeccion(boton.dataset.seccion));
    });

});


/** Lee ?seccion= y valida: cualquier cosa rara cae en Noticias. */
function seccionDeLaUrl() {

    const valor = new URLSearchParams(window.location.search).get('seccion');

    return SECCIONES_VALIDAS.has(valor) ? valor : 'noticias';

}


function pintarPestanas() {

    document.querySelectorAll('.historico-tab').forEach((boton) => {

        const activa = boton.dataset.seccion === seccionActual;

        boton.classList.toggle('activa', activa);
        boton.setAttribute('aria-selected', String(activa));

    });

    const lista = document.getElementById('historico-lista');
    if (lista) lista.setAttribute('aria-labelledby', `tab-${seccionActual}`);

}


function cambiarSeccion(seccion) {

    if (!SECCIONES_VALIDAS.has(seccion) || seccion === seccionActual) return;

    seccionActual = seccion;
    pintarPestanas();

    // La URL sigue el paso sin recargar la página (back/forward incluidos).
    const url = new URL(window.location.href);
    url.searchParams.set('seccion', seccion);
    window.history.pushState({ seccion }, '', url);

    cargarSeccion(seccion);

}


// Back/forward del navegador: si el visitante vuelve atrás, cambia la pestaña.
window.addEventListener('popstate', () => {

    const seccion = seccionDeLaUrl();
    if (seccion === seccionActual) return;

    seccionActual = seccion;
    pintarPestanas();
    cargarSeccion(seccion);

});


async function cargarSeccion(seccion) {

    const lista = document.getElementById('historico-lista');
    const nota = document.getElementById('historico-nota');

    if (!lista) return;

    try {

        if (cache[seccion] === null) {
            lista.innerHTML = '<li class="loader-simple historico-cargando">Cargando histórico...</li>';
            cache[seccion] = seccion === 'noticias'
                ? await listarHistoricoNoticias()
                : await listarHistoricoEventos();
        }

        pintar(cache[seccion], seccion, nota);

    } catch (error) {

        console.warn('[historico] No se pudo cargar el histórico.', error);

        lista.innerHTML = '';

        if (nota) {
            nota.hidden = false;
            nota.textContent = 'No pudimos cargar el histórico en este momento. Vuelve a intentarlo más tarde.';
        }

    }

}


function pintar(items, seccion, nota) {

    const lista = document.getElementById('historico-lista');

    if (!lista) return;

    if (nota) {
        nota.hidden = true;
        nota.textContent = '';
    }

    if (!items.length) {

        lista.innerHTML = seccion === 'noticias'
            ? '<li class="historico-vacio">Todavía no hay noticias archivadas.</li>'
            : '<li class="historico-vacio">Todavía no hay eventos terminados ni archivados.</li>';

        return;

    }

    const ruta = seccion === 'noticias' ? '/articulo?slug=' : '/evento?slug=';

    // Un solo innerHTML: el DOM se parsea una sola vez.
    lista.innerHTML = items.map((item) => `
        <li>
            <a href="${ruta}${encodeURIComponent(item.slug)}">
                <span class="historico-titulo">${escapar(item.titulo || 'Sin título')}</span>
            </a>
        </li>
    `).join('');

}
