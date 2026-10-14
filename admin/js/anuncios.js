// admin/js/anuncios.js — Listado de anuncios del panel.

import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';

import {
    formatearRol,
    formatearFecha,
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

const tbody = document.getElementById('anuncios-body');
const buscador = document.getElementById('buscar-anuncio');
const botonesFiltro = document.querySelectorAll('.filter-button');

let anuncios = [];
let estadoActual = 'TODOS';


/** Espeja las etiquetas y clases del tablón público (js/comunidad.js). */
const TIPOS = {
    urgente: { etiqueta: 'Urgente',   clase: 'anuncio-urgente' },
    info:    { etiqueta: 'Académico', clase: 'anuncio-info' },
    social:  { etiqueta: 'Social',    clase: 'anuncio-social' },
    venta:   { etiqueta: 'Empleo',    clase: 'anuncio-venta' },
    general: { etiqueta: 'General',   clase: 'anuncio-info' }
};

const MODOS = {
    texto: 'Solo texto',
    imagen: 'Solo imagen',
    mixto: 'Imagen + texto'
};

const DESTINOS = {
    ninguno: 'Sin botón',
    form: 'Formulario',
    whatsapp: 'WhatsApp',
    email: 'Correo',
    url: 'URL externa',
    pagina: 'Página interna'
};


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

        await cargarAnuncios();

    } catch (error) {

        console.error('Error iniciando Anuncios:', error);
        loading.textContent = 'No se pudo cargar el panel.';

    }

}


async function cargarAnuncios() {

    mostrarMensaje('Cargando anuncios...');

    const { data, error } = await supabase
        .from('anuncios')
        .select(`
            id,
            titulo,
            tipo,
            modo,
            destino_tipo,
            fecha_inicio,
            fecha_fin,
            estado,
            created_at
        `)
        .order('created_at', { ascending: false });

    if (error) {

        console.error('Error cargando anuncios:', error);
        mostrarMensaje('No se pudieron cargar los anuncios.');
        return;

    }

    anuncios = data ?? [];

    aplicarFiltros();

}


function aEntradaVisibilidad(anuncio) {
    return {
        estado: anuncio.estado,
        fechaInicio: anuncio.fecha_inicio,
        fechaFin: anuncio.fecha_fin
    };
}


function aplicarFiltros() {

    const texto = buscador.value
        .trim()
        .toLocaleLowerCase('es');

    const resultado = anuncios.filter((anuncio) => {

        const visibilidad = derivarVisibilidad(aEntradaVisibilidad(anuncio));

        let coincideEstado;

        if (estadoActual === 'TODOS') {
            coincideEstado = true;
        } else if (estadoActual === 'VENCIDOS') {
            coincideEstado = visibilidad.clave === 'VENCIDO';
        } else if (estadoActual === 'FUTUROS') {
            coincideEstado = visibilidad.clave === 'PROGRAMADO';
        } else {
            coincideEstado = anuncio.estado === estadoActual;
        }

        const coincideBusqueda =
            (anuncio.titulo ?? '').toLocaleLowerCase('es').includes(texto)
            || (anuncio.tipo ?? '').toLocaleLowerCase('es').includes(texto);

        return coincideEstado && coincideBusqueda;

    });

    renderizarAnuncios(resultado);

}


function renderizarAnuncios(lista) {

    tbody.replaceChildren();

    if (lista.length === 0) {
        mostrarMensaje('No se encontraron anuncios.');
        return;
    }

    const fragment = document.createDocumentFragment();

    lista.forEach((anuncio) => fragment.appendChild(buildFila(anuncio)));

    tbody.appendChild(fragment);

}


function celda(texto, clase) {
    const td = document.createElement('td');
    td.textContent = texto;
    if (clase) td.className = clase;
    return td;
}


function buildFila(anuncio) {

    const fila = document.createElement('tr');

    // ANUNCIO
    const tdAnuncio = document.createElement('td');

    const info = document.createElement('div');
    info.className = 'table-title';

    const titulo = document.createElement('strong');
    titulo.textContent = anuncio.titulo || '(sin título)';

    const meta = document.createElement('small');
    meta.textContent = `creado el ${formatearFecha(anuncio.created_at)}`;

    info.append(titulo, meta);
    tdAnuncio.appendChild(info);

    // TIPO — mismo criterio de colores que el tablón público
    const tipo = TIPOS[(anuncio.tipo ?? '').toLowerCase()] ?? TIPOS.general;

    const tdTipo = document.createElement('td');

    const insignia = document.createElement('span');
    insignia.className = `status-badge status-neutro`;
    insignia.textContent = tipo.etiqueta;
    insignia.title = `Se publica como «${tipo.etiqueta}» en el tablón.`;

    tdTipo.appendChild(insignia);

    // PRESENTACIÓN
    const tdModo = celda(MODOS[anuncio.modo] ?? anuncio.modo ?? '—');

    // VIGENCIA
    const tieneVentana = Boolean(anuncio.fecha_inicio || anuncio.fecha_fin);
    const tdVigencia = celda(
        tieneVentana ? formatearRango(anuncio.fecha_inicio, anuncio.fecha_fin) : 'Siempre'
    );

    // ESTADO
    const tdEstado = document.createElement('td');

    const visibilidad = derivarVisibilidad(aEntradaVisibilidad(anuncio));

    const badge = document.createElement('span');
    badge.className = `status-badge ${visibilidad.clase}`;
    badge.textContent = visibilidad.etiqueta;
    badge.title = explicarVisibilidad(visibilidad, {
        fechaInicio: anuncio.fecha_inicio,
        fechaFin: anuncio.fecha_fin
    });

    tdEstado.appendChild(badge);

    // DESTINO
    const tdDestino = celda(DESTINOS[anuncio.destino_tipo] ?? anuncio.destino_tipo ?? 'Sin botón');

    // ACCIONES
    const tdAcciones = document.createElement('td');
    tdAcciones.className = 'table-actions';

    const editar = document.createElement('a');
    editar.className = 'table-action-link';
    editar.textContent = 'Editar';
    editar.href = `./anuncio-editor.html?id=${encodeURIComponent(anuncio.id)}`;

    tdAcciones.appendChild(editar);

    fila.append(
        tdAnuncio,
        tdTipo,
        tdModo,
        tdVigencia,
        tdEstado,
        tdDestino,
        tdAcciones
    );

    return fila;

}


function mostrarMensaje(mensaje) {

    tbody.replaceChildren();

    const fila = document.createElement('tr');
    const td = document.createElement('td');

    td.colSpan = 7;
    td.className = 'table-message';
    td.textContent = mensaje;

    fila.appendChild(td);
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
