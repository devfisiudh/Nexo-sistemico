// admin/js/administradores.js — Listado de perfiles de administración.
//
// Solo usuarios con rol ADMINISTRADOR pueden acceder a esta página.
// Los perfiles se leen de public.perfiles_admin; el email vive en auth.users
// y no es accesible desde el cliente, por eso no se muestra aquí.
// Para crear usuarios nuevos hay que usar Supabase Auth (interfaz web o SQL).

import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';

import {
    formatearRol,
    formatearFecha
}
from './utils.js';


const loading = document.getElementById('admin-loading');
const app = document.getElementById('admin-app');
const nombreElement = document.getElementById('admin-nombre');
const rolElement = document.getElementById('admin-rol');
const logoutButton = document.getElementById('logout-button');

const tbody = document.getElementById('administradores-body');
const buscador = document.getElementById('buscar-administrador');
const botonesFiltro = document.querySelectorAll('.filter-button');

let administradores = [];
let estadoActual = 'TODOS';
let rolActual = 'TODOS';


async function iniciar() {

    try {

        const administrador = await protegerPaginaAdmin();

        if (!administrador) return;

        const { perfil } = administrador;

        // Esta página es exclusiva de ADMINISTRADOR.
        // Un EDITOR no puede gestionar otros usuarios.
        if (perfil.rol !== 'ADMINISTRADOR') {

            loading.hidden = true;

            app.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #888;">
                    <h2>Acceso denegado</h2>
                    <p>Solo un Administrador puede gestionar usuarios.</p>
                    <p><a href="../dashboard.html">Volver al panel</a></p>
                </div>
            `;

            return;

        }

        nombreElement.textContent = perfil.nombre;
        rolElement.textContent = formatearRol(perfil.rol);

        loading.hidden = true;
        app.hidden = false;

        await cargarAdministradores();

    } catch (error) {

        console.error('Error iniciando Administradores:', error);
        loading.textContent = 'No se pudo cargar el panel.';

    }

}


async function cargarAdministradores() {

    mostrarMensaje('Cargando administradores...');

    const { data, error } = await supabase
        .from('perfiles_admin')
        .select(`
            id,
            nombre,
            rol,
            estado,
            created_at
        `)
        .order('created_at', { ascending: false });

    if (error) {

        console.error('Error cargando administradores:', error);
        mostrarMensaje('No se pudieron cargar los administradores.');
        return;

    }

    administradores = data ?? [];

    aplicarFiltros();

}


function aplicarFiltros() {

    const texto = buscador.value
        .trim()
        .toLocaleLowerCase('es');

    const resultado = administradores.filter((administrador) => {

        const coincideEstado =
            estadoActual === 'TODOS' || administrador.estado === estadoActual;

        const coincideRol =
            rolActual === 'TODOS' || administrador.rol === rolActual;

        const coincideBusqueda =
            (administrador.nombre ?? '').toLocaleLowerCase('es').includes(texto);

        return coincideEstado && coincideRol && coincideBusqueda;

    });

    renderizarAdministradores(resultado);

}


function renderizarAdministradores(lista) {

    tbody.replaceChildren();

    if (lista.length === 0) {
        mostrarMensaje('No se encontraron administradores.');
        return;
    }

    const fragment = document.createDocumentFragment();

    lista.forEach((administrador) => fragment.appendChild(buildFila(administrador)));

    tbody.appendChild(fragment);

}


function celda(texto, clase) {
    const td = document.createElement('td');
    td.textContent = texto;
    if (clase) td.className = clase;
    return td;
}


function buildFila(administrador) {

    const fila = document.createElement('tr');

    // NOMBRE
    const tdNombre = document.createElement('td');

    const info = document.createElement('div');
    info.className = 'table-title';

    const nombre = document.createElement('strong');
    nombre.textContent = administrador.nombre || '(sin nombre)';

    const idCorto = document.createElement('small');
    idCorto.textContent = `ID: ${(administrador.id ?? '').slice(0, 8)}…`;

    info.append(nombre, idCorto);
    tdNombre.appendChild(info);

    // ROL
    const tdRol = document.createElement('td');

    const rolBadge = document.createElement('span');
    rolBadge.className = `status-badge ${administrador.rol === 'ADMINISTRADOR' ? 'status-publicado' : 'status-borrador'}`;
    rolBadge.textContent = formatearRol(administrador.rol);

    tdRol.appendChild(rolBadge);

    // ESTADO
    const tdEstado = document.createElement('td');

    const estado = document.createElement('span');
    estado.className = `status-badge ${administrador.estado === 'ACTIVO' ? 'status-publicado' : 'status-archivado'}`;
    estado.textContent = administrador.estado === 'ACTIVO' ? 'Activo' : 'Inactivo';

    tdEstado.appendChild(estado);

    // FECHA
    const tdFecha = celda(formatearFecha(administrador.created_at));

    // ACCIONES
    const tdAcciones = document.createElement('td');
    tdAcciones.className = 'table-actions';

    const editar = document.createElement('a');
    editar.className = 'table-action-link';
    editar.textContent = 'Editar';
    editar.href = `./administrador-editor.html?id=${encodeURIComponent(administrador.id)}`;

    tdAcciones.appendChild(editar);

    fila.append(
        tdNombre,
        tdRol,
        tdEstado,
        tdFecha,
        tdAcciones
    );

    return fila;

}


function mostrarMensaje(mensaje) {

    tbody.replaceChildren();

    const fila = document.createElement('tr');
    const td = document.createElement('td');

    td.colSpan = 5;
    td.className = 'table-message';
    td.textContent = mensaje;

    fila.appendChild(td);
    tbody.appendChild(fila);

}


buscador.addEventListener('input', aplicarFiltros);

botonesFiltro.forEach((boton) => {
    boton.addEventListener('click', () => {

        const tipo = boton.dataset.tipo;
        const estado = boton.dataset.estado;
        const rol = boton.dataset.rol;

        if (tipo === 'limpiar') {
            estadoActual = 'TODOS';
            rolActual = 'TODOS';
            buscador.value = '';
        } else if (estado) {
            estadoActual = estado;
            rolActual = 'TODOS';
            buscador.value = '';
        } else if (rol) {
            rolActual = rol;
            estadoActual = 'TODOS';
            buscador.value = '';
        }

        botonesFiltro.forEach((item) => item.classList.remove('active'));
        boton.classList.add('active');

        aplicarFiltros();

    });
});

logoutButton.addEventListener('click', cerrarSesion);

iniciar();
