import { supabase }
from '../../js/config/supabase.js';

import {
    protegerPaginaAdmin,
    cerrarSesion
}
from './admin-guard.js';


const loading =
    document.getElementById('admin-loading');

const app =
    document.getElementById('admin-app');

const nombreElement =
    document.getElementById('admin-nombre');

const rolElement =
    document.getElementById('admin-rol');

const welcomeTitle =
    document.getElementById('welcome-title');

const logoutButton =
    document.getElementById('logout-button');

const menuAdministradores =
    document.getElementById('menu-administradores');


async function iniciarDashboard() {

    const administrador =
        await protegerPaginaAdmin();


    if (!administrador) {
        return;
    }


    const { perfil } = administrador;


    nombreElement.textContent =
        perfil.nombre;

    rolElement.textContent =
        formatearRol(perfil.rol);

    welcomeTitle.textContent =
        `Bienvenido, ${perfil.nombre}`;


    if (perfil.rol === 'ADMINISTRADOR') {
        menuAdministradores.hidden = false;
    }


    loading.hidden = true;
    app.hidden = false;


    await Promise.all([
        cargarEstadisticas(),
        cargarUltimasNoticias()
    ]);
}


async function cargarEstadisticas() {

    const [
        noticias,
        eventos,
        anuncios
    ] = await Promise.all([

        contarRegistros('noticias'),

        contarRegistros('eventos'),

        contarRegistros('anuncios')

    ]);


    document.getElementById(
        'total-noticias'
    ).textContent = noticias;


    document.getElementById(
        'total-eventos'
    ).textContent = eventos;


    document.getElementById(
        'total-anuncios'
    ).textContent = anuncios;
}


async function contarRegistros(tabla) {

    const {
        count,
        error
    } = await supabase
        .from(tabla)
        .select('*', {
            count: 'exact',
            head: true
        });


    if (error) {

        console.error(
            `Error contando ${tabla}:`,
            error
        );

        return '—';
    }


    return count ?? 0;
}


async function cargarUltimasNoticias() {

    const contenedor =
        document.getElementById(
            'ultimas-noticias'
        );


    const {
        data,
        error
    } = await supabase
        .from('noticias')
        .select(`
            id,
            titulo,
            estado,
            created_at
        `)
        .order(
            'created_at',
            { ascending: false }
        )
        .limit(5);


    if (error) {

        console.error(error);

        contenedor.replaceChildren(
            crearMensaje(
                'No se pudieron cargar las noticias.'
            )
        );

        return;
    }


    if (!data || data.length === 0) {

        contenedor.replaceChildren(
            crearMensaje(
                'Todavía no existen noticias registradas.'
            )
        );

        return;
    }


    const fragment =
        document.createDocumentFragment();


    data.forEach((noticia) => {

        const item =
            document.createElement('article');

        item.className =
            'content-list-item';


        const info =
            document.createElement('div');


        const titulo =
            document.createElement('strong');

        titulo.textContent =
            noticia.titulo;


        const fecha =
            document.createElement('small');

        fecha.textContent =
            formatearFecha(
                noticia.created_at
            );


        info.append(
            titulo,
            fecha
        );


        const estado =
            document.createElement('span');

        estado.className =
            `status-badge status-${noticia.estado.toLowerCase()}`;

        estado.textContent =
            formatearEstado(
                noticia.estado
            );


        item.append(
            info,
            estado
        );


        fragment.appendChild(item);
    });


    contenedor.replaceChildren(fragment);
}


function crearMensaje(texto) {

    const elemento =
        document.createElement('p');

    elemento.className =
        'empty-message';

    elemento.textContent =
        texto;

    return elemento;
}


function formatearFecha(fecha) {

    return new Intl.DateTimeFormat(
        'es-PE',
        {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }
    ).format(
        new Date(fecha)
    );
}


function formatearRol(rol) {

    if (rol === 'ADMINISTRADOR') {
        return 'Administrador';
    }

    if (rol === 'EDITOR') {
        return 'Editor';
    }

    return rol;
}


function formatearEstado(estado) {

    const estados = {
        BORRADOR: 'Borrador',
        PUBLICADO: 'Publicado',
        ARCHIVADO: 'Archivado'
    };

    return estados[estado] ?? estado;
}


logoutButton.addEventListener(
    'click',
    cerrarSesion
);


iniciarDashboard();