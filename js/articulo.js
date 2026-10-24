// js/articulo.js — Detalle de noticia.
//
// URL canónica: /noticias?slug=hackathon-udh-2026
// (mantiene compatibilidad con articulo.html?slug= si llega por enlaces antiguos)
//
// Se acepta ?id= como compatibilidad con los enlaces anteriores a la migración.

import { obtenerNoticiaPorSlug } from './data/noticias.js';
import { escapar } from './utils/formato.js';
import { sanitizar } from './utils/sanitizar.js';
import { formatearFecha } from './utils/formato.js';

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

        renderizarCabecera(contenedor, noticia);

        // El cuerpo llega en texto plano con HTML: pasa por la allowlist.
        const cuerpo = sanitizar(noticia.contenido)
            || '<p class="lead"><em>(Artículo completo no disponible)</em></p>';

        document.getElementById('cuerpo-texto').innerHTML = cuerpo;

        document.title = `${noticia.titulo} | Nexo Sistémico`;

    } catch (error) {

        console.error('[articulo] Error al cargar la noticia.', error);

        mostrarError(contenedor, 'Hubo un error al cargar la noticia.');

    }
}


function renderizarCabecera(contenedor, noticia) {

    const fecha = noticia.fecha_publicacion || noticia.created_at || '';
    const fechaTexto = fecha ? formatearFecha(fecha) : 'Sin fecha';

    const portada = noticia.imagenUrl
        ? `<img src="${escapar(noticia.imagenUrl)}" alt="" loading="lazy">`
        : '<span class="post-hero-placeholder" aria-hidden="true">IMAGEN</span>';

    const kicker = noticia.categoria
        ? `<span class="post-kicker dot" style="color:${escapar(noticia.color || 'var(--scarlet)')}">${escapar(noticia.categoria)}</span>`
        : '';

    contenedor.innerHTML = `
        <a href="/noticias" class="post-back">&larr; Volver a Noticias</a>

        <header class="post-hero" style="background-color: ${escapar(noticia.color || 'var(--surface-2)')};">
            ${portada}
            <div class="post-hero-inner">
                <span class="post-type-badge">NOTICIA</span>
                ${kicker}
                <h1 class="post-title">${escapar(noticia.titulo)}</h1>
                <p class="post-lead">${escapar(noticia.resumen || '')}</p>
            </div>
        </header>

        <div class="post-meta">
            <div class="post-meta-item">
                <span class="post-meta-icon">📅</span>
                <div>
                    <span class="post-meta-label">Fecha</span>
                    <span class="post-meta-value">${escapar(fechaTexto)}</span>
                </div>
            </div>
            ${noticia.autor_nombre
                ? `
                <div class="post-meta-item">
                    <span class="post-meta-icon">✍️</span>
                    <div>
                        <span class="post-meta-label">Autor</span>
                        <span class="post-meta-value">${escapar(noticia.autor_nombre)}</span>
                    </div>
                </div>`
                : ''
            }
            <div class="post-meta-item">
                <span class="post-meta-icon">🏷️</span>
                <div>
                    <span class="post-meta-label">Categoría</span>
                    <span class="post-meta-value">${escapar(noticia.categoria || 'General')}</span>
                </div>
            </div>
        </div>

        <div class="post-body" id="cuerpo-texto">
            <div class="loader-simple">Cargando texto completo…</div>
        </div>
    `;
}


function mostrarError(contenedor, mensaje) {

    contenedor.innerHTML = `
        <a href="/noticias" class="post-back">&larr; Volver a Noticias</a>

        <div class="post-error">
            <h2>${escapar(mensaje)}</h2>
            <p><a href="/noticias">&larr; Volver a Noticias</a></p>
        </div>
    `;
}
