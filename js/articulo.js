// js/articulo.js — Detalle de noticia.
//
// URL canónica:  articulo.html?slug=hackathon-udh-2026
// Se acepta ?id= como compatibilidad con los enlaces anteriores a la migración.

import { obtenerNoticiaPorSlug } from './data/noticias.js';
import { escapar } from './utils/formato.js';
import { sanitizar } from './utils/sanitizar.js';

document.addEventListener('DOMContentLoaded', () => {
    cargarArticulo();
});


async function cargarArticulo() {

    const contenedor = document.getElementById('article-content');

    if (!contenedor) return;

    const parametros = new URLSearchParams(window.location.search);
    const slug = parametros.get('slug');
    const idResidual = parametros.get('id');

    if (!slug && !idResidual) {
        mostrarError(contenedor, 'No se especificó ninguna noticia.');
        return;
    }

    try {

        const noticia = await obtenerNoticiaPorSlug(slug ?? `noticia-${idResidual}`);

        if (!noticia) {
            mostrarError(contenedor, 'Noticia no encontrada o no publicada.');
            return;
        }

        renderizarCabecera(noticia);

        // El cuerpo llega en texto plano con HTML: pasa por la allowlist.
        const cuerpo = sanitizar(noticia.contenido);

        document.getElementById('cuerpo-texto').innerHTML = cuerpo
            || '<p class="lead"><em>(Artículo completo no disponible)</em></p>';

        document.title = `${noticia.titulo} | Nexo Sistémico`;

    } catch (error) {

        console.error('[articulo] Error al cargar la noticia.', error);

        mostrarError(contenedor, 'Hubo un error al cargar la noticia.');

    }

}


function renderizarCabecera(noticia) {

    const contenedor = document.getElementById('article-content');

    const portada = noticia.imagenUrl
        ? `<img src="${escapar(noticia.imagenUrl)}" alt="" class="article-cover">`
        : '<span class="article-cover-placeholder" aria-hidden="true">IMAGEN</span>';

    contenedor.innerHTML = `
        <header class="article-header">
            <div class="article-meta">
                <span class="article-category">${escapar(noticia.categoria)}</span>
                <span class="article-date">${escapar(noticia.fecha)}</span>
            </div>
            <h1 class="article-title">${escapar(noticia.titulo)}</h1>
        </header>

        <div class="article-image" style="background-color: ${escapar(noticia.color)};">
            ${portada}
        </div>

        <div class="article-body" id="cuerpo-texto">
            <div class="loader-simple">Cargando texto completo…</div>
        </div>
    `;

}


function mostrarError(contenedor, mensaje) {

    contenedor.innerHTML = `
        <h2 class="article-error">${escapar(mensaje)}</h2>
        <p class="article-back"><a href="noticias.html">&larr; Volver a Noticias</a></p>
    `;

}
