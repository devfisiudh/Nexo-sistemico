// js/evento-detalle.js — Página de detalle de un evento.
//
// URL canónica: /eventos?slug=hackathon-udh-2026
// Se acepta ?id= como compatibilidad con los enlaces anteriores a la migración.

import { obtenerEventoPorSlug } from './data/eventos.js';
import { escapar } from './utils/formato.js';
import { sanitizar } from './utils/sanitizar.js';
import { formatearFecha } from './utils/formato.js';

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

        const evento = await obtenerEventoPorSlug(slug ?? `evento-${idResidual}`);

        if (!evento) {
            mostrarError(contenedor, 'Evento no encontrado o no publicado.');
            return;
        }

        document.title = `${evento.titulo} | Nexo Sistémico`;

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
        ? `<span class="post-kicker dot" style="color:${evento.vigencia.clase === 'status-publicado' ? 'var(--scarlet)' : evento.vigencia.clase === 'status-vencido' ? '#B5151C' : 'var(--antler)'}">${escapar(evento.vigencia.etiqueta)}</span>`
        : '';

    const portada = evento.imagenUrl
        ? `<img src="${escapar(evento.imagenUrl)}" alt="" loading="lazy">`
        : '<span class="post-hero-placeholder" aria-hidden="true">IMAGEN</span>';

    // El cuerpo puede venir vacío; en ese caso mostramos el resumen.
    const cuerpo = sanitizar(evento.contenido)
        || `<p class="lead">${escapar(evento.resumen)}</p>`;

    const cta = evento.tieneInscripcion && evento.urlInscripcion
        ? `
            <div class="post-action">
                <a href="${escapar(evento.urlInscripcion)}" target="_blank" rel="noopener noreferrer" class="post-btn">
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


function mostrarError(contenedor, mensaje) {

    contenedor.innerHTML = `
        <a href="/eventos" class="post-back">&larr; Volver a la Agenda</a>

        <div class="post-error">
            <h2>${escapar(mensaje)}</h2>
            <p><a href="/eventos">&larr; Volver a la Agenda</a></p>
        </div>
    `;
}
