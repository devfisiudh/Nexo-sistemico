import { supabase } from '../../js/config/supabase.js';


export async function obtenerAdministradorActual() {

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


    return {
        session,
        usuario: session.user,
        perfil
    };
}


export async function protegerPaginaAdmin() {

    const administrador =
        await obtenerAdministradorActual();


    if (!administrador) {

        window.location.replace('/admin/index.html');

        return null;
    }


    return administrador;
}


export async function cerrarSesion() {

    await supabase.auth.signOut();

    window.location.replace('/admin/index.html');
}