// admin/js/eventos.js — Listado de eventos del panel.

import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';

import {
    formatearRol,
    formatearRango,
    derivarVisibilidad,
    explicarVisibilidad
}
from './utils.js';


const loading = document.getElementById('admin-loading');
const app = document.getElementById('admin-app');
const nombreElement = document.getElementById('admin-nombre');
const rolElement = document.getElementById('admin-rol');
const logoutButton = document.getElementById('logout-button');
const menuAdministradores = document.getElementById('menu-administradores');

const tbody = document.getElementById('eventos-body');
const buscador = document.getElementById('buscar-evento');
const botonesFiltro = document.querySelectorAll('.filter-button');

let eventos = [];
let estadoActual = 'TODOS';


async function iniciar() {

    try {

        const administrador = await protegerPaginaAdmin();

        if (!administrador) return;

        const { perfil } = administrador;

        nombreElement.textContent = perfil.nombre;
        rolElement.textContent = formatearRol(perfil.rol);

        if (perfil.rol === 'ADMINISTRADOR') {
            menuAdministradores.hidden = false;
        }

        loading.hidden = true;
        app.hidden = false;

        await cargarEventos();

    } catch (error) {

        console.error('Error iniciando Eventos:', error);
        loading.textContent = 'No se pudo cargar el panel.';

    }

}


async function cargarEventos() {

    mostrarMensaje('Cargando eventos...');

    const { data, error } = await supabase
        .from('eventos')
        .select(`
            id,
            titulo,
            slug,
            lugar,
            fecha_inicio,
            fecha_fin,
            url_inscripcion,
            estado,
            created_at
        `)
        .order('fecha_inicio', { ascending: true, nullsfirst: false });

    if (error) {

        console.error('Error cargando eventos:', error);
        mostrarMensaje('No se pudieron cargar los eventos.');
        return;

    }

    eventos = data ?? [];

    aplicarFiltros();

}


/** Adapta la fila de Postgres al formato que espera derivarVisibilidad. */
function aEntradaVisibilidad(evento) {
    return {
        estado: evento.estado,
        fechaInicio: evento.fecha_inicio,
        fechaFin: evento.fecha_fin
    };
}


function aplicarFiltros() {

    const texto = buscador.value
        .trim()
        .toLocaleLowerCase('es');

    // "VENCIDOS" y "VISIBLES" no son estados del ENUM: son categorías
    // derivadas, y son justo las que el administrador no puede armar a mano
    // ("¿cuáles de los míos están publicados y aun así no salen?").
    const resultado = eventos.filter((evento) => {

        let coincideEstado;

        if (estadoActual === 'TODOS') {
            coincideEstado = true;
        } else if (estadoActual === 'VENCIDOS') {
            coincideEstado = derivarVisibilidad(aEntradaVisibilidad(evento)).clave === 'VENCIDO';
        } else if (estadoActual === 'FUTUROS') {
            coincideEstado = derivarVisibilidad(aEntradaVisibilidad(evento)).clave === 'PROGRAMADO';
        } else {
            coincideEstado = evento.estado === estadoActual;
        }

        const coincideBusqueda =
            (evento.titulo ?? '').toLocaleLowerCase('es').includes(texto)
            || (evento.lugar ?? '').toLocaleLowerCase('es').includes(texto);

        return coincideEstado && coincideBusqueda;

    });

    renderizarEventos(resultado);

}


function renderizarEventos(lista) {

    tbody.replaceChildren();

    if (lista.length === 0) {
        mostrarMensaje('No se encontraron eventos.');
        return;
    }

    const fragment = document.createDocumentFragment();

    lista.forEach((evento) => fragment.appendChild(buildFila(evento)));

    tbody.appendChild(fragment);

}


function buildFila(evento) {

    const fila = document.createElement('tr');

    // EVENTO
    const celdaEvento = document.createElement('td');

    const info = document.createElement('div');
    info.className = 'table-title';

    const titulo = document.createElement('strong');
    titulo.textContent = evento.titulo;

    const slug = document.createElement('small');
    slug.textContent = `/${evento.slug}`;

    info.append(titulo, slug);
    celdaEvento.appendChild(info);

    // VIGENCIA
    const celdaVigencia = document.createElement('td');
    celdaVigencia.textContent = formatearRango(evento.fecha_inicio, evento.fecha_fin);

    // LUGAR
    const celdaLugar = document.createElement('td');
    celdaLugar.textContent = evento.lugar || '—';

    // ESTADO — derivado, no el ENUM crudo. Ver utils.js/derivarVisibilidad.
    const celdaEstado = document.createElement('td');

    const visibilidad = derivarVisibilidad({
        estado: evento.estado,
        fechaInicio: evento.fecha_inicio,
        fechaFin: evento.fecha_fin
    });

    const estado = document.createElement('span');
    estado.className = `status-badge ${visibilidad.clase}`;
    estado.textContent = visibilidad.etiqueta;
    estado.title = explicarVisibilidad(visibilidad, {
        fechaInicio: evento.fecha_inicio,
        fechaFin: evento.fecha_fin
    });

    celdaEstado.appendChild(estado);

    // INSCRIPCIÓN — neutral, no usa las clases de estado: aquí no hay bien
    // ni mal, solo dos comportamientos distintos del botón en el portal.
    const celdaInscripcion = document.createElement('td');

    const tieneInscripcion = Boolean((evento.url_inscripcion ?? '').trim());

    const insignia = document.createElement('span');
    insignia.className = 'status-badge status-neutro';
    insignia.textContent = tieneInscripcion ? 'Enlace externo' : 'Solo detalle';
    insignia.title = tieneInscripcion
        ? 'La tarjeta muestra «Inscribirse» y abre el enlace en otra pestaña.'
        : 'La tarjeta muestra «Ver detalles» y lleva a la página interna del evento.';

    celdaInscripcion.appendChild(insignia);

    // ACCIONES
    const celdaAcciones = document.createElement('td');
    celdaAcciones.className = 'table-actions';

    const editar = document.createElement('a');
    editar.className = 'table-action-link';
    editar.textContent = 'Editar';
    editar.href = `./evento-editor.html?id=${encodeURIComponent(evento.id)}`;

    const ver = document.createElement('a');
    ver.className = 'table-action-link';
    ver.textContent = 'Ver';
    ver.href = `../../pages/evento.html?slug=${encodeURIComponent(evento.slug)}`;
    ver.target = '_blank';
    ver.rel = 'noopener noreferrer';

    celdaAcciones.append(ver, editar);

    fila.append(
        celdaEvento,
        celdaVigencia,
        celdaLugar,
        celdaEstado,
        celdaInscripcion,
        celdaAcciones
    );

    return fila;

}


function mostrarMensaje(mensaje) {

    tbody.replaceChildren();

    const fila = document.createElement('tr');
    const celda = document.createElement('td');

    celda.colSpan = 6;
    celda.className = 'table-message';
    celda.textContent = mensaje;

    fila.appendChild(celda);
    tbody.appendChild(fila);

}


buscador.addEventListener('input', aplicarFiltros);

botonesFiltro.forEach((boton) => {
    boton.addEventListener('click', () => {

        estadoActual = boton.dataset.estado;

        botonesFiltro.forEach((item) => item.classList.remove('active'));
        boton.classList.add('active');

        aplicarFiltros();

    });
});

logoutButton.addEventListener('click', cerrarSesion);

iniciar();
