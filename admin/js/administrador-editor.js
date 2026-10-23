// admin/js/administrador-editor.js — Crear y editar perfiles de administración.
//
// Solo usuarios con rol ADMINISTRADOR pueden acceder.
//
// Reglas de negocio:
//   · Un administrador no puede desactivarse a sí mismo.
//   * No se puede dejar sin ningún administrador activo (quitar el último
//     rol ADMINISTRADOR o poner INACTIVO al único ADMINISTRADOR).
//   · El email no se gestiona aquí: vive en auth.users y se crea desde
//     Supabase Auth. Este formulario solo gestiona nombre, rol y estado.

import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';

import {
    formatearRol
}
from './utils.js';


const loading = document.getElementById('admin-loading');
const app = document.getElementById('admin-app');
const form = document.getElementById('administrador-form');
const nombreElement = document.getElementById('admin-nombre');
const rolElement = document.getElementById('admin-rol');
const logoutButton = document.getElementById('logout-button');

const headerTitle = document.getElementById('header-title');
const editorTitle = document.getElementById('editor-title');
const saveButton = document.getElementById('save-button');
const messageElement = document.getElementById('editor-message');

const nombreInput = document.getElementById('nombre');
const rolInput = document.getElementById('rol');
const estadoInput = document.getElementById('estado');

const params = new URLSearchParams(window.location.search);
const perfilId = params.get('id');

let administradorActual = null;
let editando = Boolean(perfilId);
let perfilOriginal = null;


async function iniciar() {

    try {

        administradorActual = await protegerPaginaAdmin();

        if (!administradorActual) return;

        const { perfil } = administradorActual;

        // Esta página es exclusiva de ADMINISTRADOR.
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

        if (editando) {

            headerTitle.textContent = 'Editar administrador';
            editorTitle.textContent = 'Editar administrador';
            saveButton.textContent = 'Guardar cambios';

            await cargarPerfil(perfilId);

        }

        loading.hidden = true;
        app.hidden = false;

    } catch (error) {

        console.error('Error iniciando editor de administrador:', error);
        loading.textContent = 'No se pudo cargar el editor.';

    }

}


async function cargarPerfil(id) {

    const { data, error } = await supabase
        .from('perfiles_admin')
        .select(`
            id,
            nombre,
            rol,
            estado,
            created_at
        `)
        .eq('id', id)
        .single();

    if (error || !data) {

        console.error('Error cargando perfil:', error);

        throw new Error('No se pudo encontrar el perfil.');

    }

    perfilOriginal = data;

    nombreInput.value = data.nombre ?? '';
    rolInput.value = data.rol ?? 'EDITOR';
    estadoInput.value = data.estado ?? 'ACTIVO';

}


// ── Validación ────────────────────────────────────────────────────────────────

function recopilarDatos() {

    const nombre = nombreInput.value.trim();
    const rol = rolInput.value;
    const estado = estadoInput.value;

    if (!nombre) {
        return { error: 'El nombre es obligatorio.' };
    }

    if (nombre.length < 3) {
        return { error: 'El nombre debe tener al menos 3 caracteres.' };
    }

    if (!rol) {
        return { error: 'Selecciona un rol.' };
    }

    if (!estado) {
        return { error: 'Selecciona un estado.' };
    }

    return {
        datos: {
            nombre,
            rol,
            estado
        }
    };

}

// Verifica si el cambio propuesto dejaría al sistema sin administradores activos.
async function validarCambioSeguro(nuevosDatos) {

    // Si no cambia rol ni estado, no hay riesgo.
    if (
        !editando ||
        (nuevosDatos.rol === perfilOriginal.rol &&
         nuevosDatos.estado === perfilOriginal.estado)
    ) {
        return { seguro: true };
    }

    // Contar administradores activos actuales.
    const { data: todos, error } = await supabase
        .from('perfiles_admin')
        .select('id, rol, estado');

    if (error) {

        console.error('Error verificando administradores:', error);
        return { seguro: true, advertencia: 'No se pudo verificar la seguridad del cambio.' };

    }

    const administradoresActivos = (todos ?? []).filter(
        p => p.estado === 'ACTIVO' && p.rol === 'ADMINISTRADOR'
    );

    // Si el perfil que se está editando es un administrador activo,
    // se descuenta del conteo porque va a cambiar.
    const soyEstePerfil = editando && perfilOriginal.id === nuevosDatos.id;
    const seguiríaSiendoActivoAdmin =
        nuevosDatos.estado === 'ACTIVO' && nuevosDatos.rol === 'ADMINISTRADOR';

    const restantes = administradoresActivos.length
        - (soyEstePerfil && perfilOriginal.estado === 'ACTIVO' && perfilOriginal.rol === 'ADMINISTRADOR' ? 1 : 0)
        + (seguiríaSiendoActivoAdmin && soyEstePerfil ? 1 : 0);

    if (restantes === 0) {

        return {
            seguro: false,
            motivo: 'No se puede dejar sin administradores activos. Al menos un usuario debe mantener el rol Administrador y estado Activo.'
        };

    }

    return { seguro: true };

}


form.addEventListener('submit', async (event) => {

    event.preventDefault();

    limpiarMensaje();

    if (!form.reportValidity()) return;

    const { datos, error: errorValidacion } = recopilarDatos();

    if (errorValidacion) {
        mostrarMensaje(errorValidacion, 'error');
        return;
    }

    const seguridad = await validarCambioSeguro(datos);

    if (!seguridad.seguro) {
        mostrarMensaje(seguridad.motivo, 'error');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = editando ? 'Guardando...' : 'Creando...';

    try {

        if (editando) {

            await actualizarPerfil(datos);

        } else {

            await crearPerfil(datos);

        }

    } catch (error) {

        console.error(error);
        mostrarMensaje('No se pudo guardar el perfil.', 'error');

    } finally {

        saveButton.disabled = false;
        saveButton.textContent = editando ? 'Guardar cambios' : 'Guardar administrador';

    }

});


async function crearPerfil(datos) {

    // ⚠️ IMPORTANTE: Desde el cliente NO se puede crear un usuario en auth.users.
    // Eso requiere service_role key. Este INSERT solo funciona si el usuario
    // ya fue creado en Supabase Auth y existe un registro correspondiente.
    //
    // Si el perfil no existe en auth.users, el INSERT fallará con error de
    // clave foránea o simplemente no tendrá sentido sin un usuario detrás.
    //
    // Por ahora permitimos el INSERT pero advertimos al administrador.

    const { data, error } = await supabase
        .from('perfiles_admin')
        .insert({
            ...datos,
            // id se genera automáticamente con gen_random_uuid()
        })
        .select()
        .single();

    if (error) {

        if (error.code === '23505') {
            mostrarMensaje('Ya existe un perfil con ese identificador.', 'error');
        } else if (error.code === '23503') {
            mostrarMensaje('No se puede crear el perfil: el usuario no existe en Supabase Auth. Crea primero el usuario en Supabase → Authentication → Users.', 'error');
        } else {
            mostrarMensaje(error.message || 'No se pudo crear el perfil.', 'error');
        }

        return;

    }

    mostrarMensaje('Perfil creado correctamente. Recuerda que el usuario debe existir en Supabase Auth para poder iniciar sesión.', 'success');

    setTimeout(() => {
        window.location.replace('./administradores.html');
    }, 1500);

}


async function actualizarPerfil(datos) {

    const { error } = await supabase
        .from('perfiles_admin')
        .update(datos)
        .eq('id', perfilId);

    if (error) {

        if (error.code === '23503') {
            mostrarMensaje('El perfil referenciado no existe en Supabase Auth.', 'error');
        } else {
            mostrarMensaje(error.message || 'No se pudo actualizar el perfil.', 'error');
        }

        return;

    }

    mostrarMensaje('Cambios guardados correctamente.', 'success');

    setTimeout(() => {
        window.location.replace('./administradores.html');
    }, 1000);

}


function mostrarMensaje(mensaje, tipo) {
    messageElement.textContent = mensaje;
    messageElement.className = `editor-message editor-message-${tipo}`;
    messageElement.hidden = false;
}

function limpiarMensaje() {
    messageElement.textContent = '';
    messageElement.hidden = true;
}


logoutButton.addEventListener('click', cerrarSesion);

iniciar();
