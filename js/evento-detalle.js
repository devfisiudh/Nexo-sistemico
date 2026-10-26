// js/evento-detalle.js — Página de detalle de un evento.
//
// URL canónica: /eventos?slug=hackathon-udh-2026
// Se acepta ?id= como compatibilidad con los enlaces anteriores a la migración.

import { obtenerEventoPorSlug } from './data/eventos.js';
import { obtenerEventoArchivado } from './data/historial.js';
import { escapar, urlSegura } from './utils/formato.js';
import { prepararContenido } from './utils/sanitizar.js';
import { formatearFecha } from './utils/formato.js';
import { actualizarMetadatos } from './utils/seo.js';

document.addEventListener('DOMContentLoaded', () => {
    cargarDetalleEvento();
});


async function cargarDetalleEvento() {

    const contenedor = document.getElementById('event-detail-content');

    if (!contenedor) return;

    const parametros = new URLSearchParams(window.location.search);
    const slug = parametros.get('slug');
    const idResidual = parametros.get('id');

    if (!slug && !idResidual) {
        mostrarError(contenedor, 'Evento no especificado.');
        return;
    }

    try {

        const buscado = slug ?? `evento-${idResidual}`;

        let evento = await obtenerEventoPorSlug(buscado);

        // Mismo caso que en las noticias: los archivados y vencidos no los
        // devuelve RLS, así que se piden por la RPC del histórico.
        if (!evento) {
            evento = await obtenerEventoArchivado(buscado).catch(() => null);
        }

        if (!evento) {
            mostrarError(contenedor, 'Evento no encontrado o no publicado.');
            return;
        }

        actualizarMetadatos({
            titulo: evento.titulo,
            resumen: evento.resumen || evento.contenido,
            imagen: evento.imagenUrl,
            tipo: 'website'
        });

        if (evento.historico) {
            renderCompacto(contenedor, evento);
            return;
        }

        renderDetalle(contenedor, evento);

    } catch (error) {

        console.error('[evento] Error al cargar el detalle.', error);

        mostrarError(contenedor, 'Hubo un error al cargar el evento.');

    }
}


function renderDetalle(contenedor, evento) {

    const fechaTexto = evento.fechaTexto || (evento.fecha_inicio ? formatearFecha(evento.fecha_inicio) : 'Sin fecha');
    const lugar = evento.lugar || 'Por definir';

    const distintivo = evento.vigencia.etiqueta
        ? `<span class="post-kicker dot" style="--kicker:${evento.vigencia.clase === 'status-publicado' ? 'var(--scarlet)' : evento.vigencia.clase === 'status-vencido' ? '#B5151C' : 'var(--antler)'}">${escapar(evento.vigencia.etiqueta)}</span>`
        : '';

    const portada = evento.imagenUrl
        ? `<img src="${escapar(evento.imagenUrl)}" alt="" loading="lazy" decoding="async">`
        : '<span class="post-hero-placeholder" aria-hidden="true">IMAGEN</span>';

    // El cuerpo puede venir vacío; en ese caso mostramos el resumen.
    const cuerpo = prepararContenido(evento.contenido)
        || `<p class="lead">${escapar(evento.resumen)}</p>`;

    // Enlace de inscripción vuelto a validar al mostrar (urlSegura).
    const inscripcion = urlSegura(evento.urlInscripcion);

    const cta = evento.tieneInscripcion && inscripcion
        ? `
            <div class="post-action">
                <a href="${escapar(inscripcion)}" target="_blank" rel="noopener noreferrer" class="post-btn">
                    ${escapar(evento.textoBoton || 'Inscribirse')} ↗
                </a>
            </div>`
        : '';

    contenedor.innerHTML = `
        <a href="/eventos" class="post-back">&larr; Volver a la Agenda</a>

        <header class="post-hero" style="background-color: ${escapar(evento.color || 'var(--surface-2)')};">
            ${portada}
            <div class="post-hero-inner">
                ${distintivo}
                <span class="post-type-badge">EVENTO</span>
                <h1 class="post-title">${escapar(evento.titulo)}</h1>
                <p class="post-lead">${escapar(evento.resumen || '')}</p>
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
            <div class="post-meta-item">
                <span class="post-meta-icon">📍</span>
                <div>
                    <span class="post-meta-label">Lugar</span>
                    <span class="post-meta-value">${escapar(lugar)}</span>
                </div>
            </div>
            ${evento.url_inscripcion
                ? `
                <div class="post-meta-item">
                    <span class="post-meta-icon">🎫</span>
                    <div>
                        <span class="post-meta-label">Inscripción</span>
                        <span class="post-meta-value">Enlace externo</span>
                    </div>
                </div>`
                : ''
            }
        </div>

        <div class="post-body" id="cuerpo-texto">
            ${cuerpo}
        </div>

        ${cta}
    `;
}


/**
 * Detalle de un evento del histórico: compacto y sin CTA de inscripción
 * (un evento terminado ya no admite inscribirse).
 */
function renderCompacto(contenedor, evento) {

    const fechaTexto = evento.fechaTexto || 'Sin fechas';

    const cuerpo = prepararContenido(evento.contenido)
        || `<p class="lead">${escapar(evento.resumen)}</p>`;

    contenedor.innerHTML = `
        <a href="/historico?seccion=eventos" class="post-back">← Volver al histórico</a>

        <div class="post-aviso-historico">
            <strong>${escapar(evento.historico || 'Archivado')}</strong>
            <span>
                Este evento ya no aparece en la agenda. Aquí queda su
                información para consulta.
            </span>
        </div>

        <header class="post-historico-cabecera">
            <span class="post-kicker dot" style="--kicker: var(--scarlet)">Evento</span>
            <h1 class="post-title">${escapar(evento.titulo)}</h1>
            ${evento.resumen ? `<p class="post-lead">${escapar(evento.resumen)}</p>` : ''}
        </header>

        <div class="post-historico-datos">
            <span>📅 ${escapar(fechaTexto)}</span>
            <span>📍 ${escapar(evento.lugar)}</span>
        </div>

        <div class="post-body" id="cuerpo-texto">
            ${cuerpo}
        </div>
    `;
}


function mostrarError(contenedor, mensaje) {

    contenedor.innerHTML = `
        <a href="/eventos" class="post-back">&larr; Volver a la Agenda</a>

        <div class="post-error">
            <h2>${escapar(mensaje)}</h2>
            <p><a href="/eventos">&larr; Volver a la Agenda</a></p>
        </div>
    `;
}
