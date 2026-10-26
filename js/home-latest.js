// js/home-latest.js — La noticia y el evento más próximos en la portada.
//
// Ambos módulos ya salen de Supabase. No queda ningún fetch a data/*.json.

import { obtenerUltimaNoticia } from './data/noticias.js';
import { obtenerProximoEvento } from './data/eventos.js';
import { escapar } from './utils/formato.js';

document.addEventListener('DOMContentLoaded', async () => {

    const grilla = document.getElementById('latest-grid');

    if (!grilla) return;

    try {

        const [noticia, evento] = await Promise.all([
            obtenerUltimaNoticia(),
            obtenerProximoEvento()
        ]);

        if (!noticia && !evento) {
            grilla.innerHTML =
                '<p class="latest-empty">Todavía no hay contenido publicado.</p>';
            return;
        }

        grilla.innerHTML = [
            noticia ? tarjetaNoticia(noticia) : '',
            evento ? tarjetaEvento(evento) : ''
        ].join('');

    } catch (error) {

        console.error('[home] Error cargando lo último:', error);

        grilla.innerHTML =
            '<p class="latest-empty">No se pudo cargar el contenido.</p>';

    }

});


/* ── Tarjetas ──────────────────────────────────────────────────────────────── */

function tarjetaNoticia(noticia) {

    const portada = noticia.imagenUrl
        ? `<img src="${escapar(noticia.imagenUrl)}" alt="" class="latest-cover" loading="lazy" decoding="async">`
        : '';

    return `
        <article class="latest-card">
            <div class="latest-card-badge badge-noticia">📰 Noticia</div>
            <div class="card-color-bar" style="background:${escapar(noticia.color)};">
                ${portada}
            </div>
            <div class="latest-card-body">
                <span class="latest-meta">${escapar(noticia.categoria)} · ${escapar(noticia.fecha)}</span>
                <h3>${escapar(noticia.titulo)}</h3>
                <p>${escapar(noticia.resumen)}</p>
                <a href="/articulo?slug=${encodeURIComponent(noticia.slug)}" class="latest-link">Leer noticia →</a>
            </div>
        </article>
    `;

}

function tarjetaEvento(evento) {

    return `
        <article class="latest-card">
            <div class="latest-card-badge badge-evento">📅 Evento</div>
            <div class="card-color-bar" style="background:${escapar(evento.color)};"></div>
            <div class="latest-card-body">
                <span class="latest-meta">${escapar(evento.lugar)} · ${escapar(evento.fechaTexto)}</span>
                <h3>${escapar(evento.titulo)}</h3>
                <p>${escapar(evento.resumen)}</p>
                <a href="/evento?slug=${encodeURIComponent(evento.slug)}" class="latest-link">Ver evento →</a>
            </div>
        </article>
    `;

}
