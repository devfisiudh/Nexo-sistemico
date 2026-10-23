import { supabase } from '../../js/config/supabase.js';


const CACHE_KEY = 'nexo_admin_session';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos


function leerCache() {

    try {

        const bruto = sessionStorage.getItem(CACHE_KEY);

        if (!bruto) return null;

        const dato = JSON.parse(bruto);

        if (Date.now() - dato.ts > CACHE_TTL) {

            sessionStorage.removeItem(CACHE_KEY);

            return null;

        }

        return dato.valor;

    } catch {

        return null;

    }

}


function escribirCache(valor) {

    try {

        sessionStorage.setItem(CACHE_KEY, JSON.stringify({

            ts: Date.now(),

            valor

        }));

    } catch {

        // sessionStorage no disponible o lleno, ignorar

    }

}


export async function obtenerAdministradorActual() {

    const cacheado = leerCache();

    if (cacheado) {

        return cacheado;

    }


    const {

        data: { session },

        error: sessionError

    } = await supabase.auth.getSession();

    if (sessionError || !session) {

        return null;

    }


    const {

        data: perfil,

        error: perfilError

    } = await supabase

        .from('perfiles_admin')

        .select('id, nombre, rol, estado')

        .eq('id', session.user.id)

        .eq('estado', 'ACTIVO')

        .single();


    if (perfilError || !perfil) {

        await supabase.auth.signOut();

        return null;

    }


    const resultado = {

        session,

        usuario: session.user,

        perfil

    };

    escribirCache(resultado);

    return resultado;

}


export async function protegerPaginaAdmin() {

    const administrador = await obtenerAdministradorActual();


    if (!administrador) {

        window.location.replace('/admin/index.html');

        return null;

    }


    return administrador;

}


export async function cerrarSesion() {

    sessionStorage.removeItem(CACHE_KEY);

    await supabase.auth.signOut();

    window.location.replace('/admin/index.html');

}