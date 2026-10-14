-- =============================================================================
-- 02_anuncios_modos.sql
--
-- Agrega a `anuncios` las dos columnas que el frontend necesita y que el
-- esquema documentado no tenía.
--
-- El tablón de Comunidad (js/comunidad.js → buildAnuncioCard) dibuja cada
-- tarjeta a partir de estos campos, y hoy no existen en la base:
--
--   modo          "texto"  → solo texto + autor
--                 "imagen" → solo imagen, sin texto
--                 "mixto"  → imagen arriba + texto debajo
--
--   destino_tipo  "form" | "whatsapp" | "email" | "url" | "pagina" | "ninguno"
--                 decide el icono, el color del botón y el target.
--
-- Se declaran como TEXT con CHECK, no como ENUM, a diferencia de
-- estado_contenido / estado_usuario / rol_admin. Motivos:
--
--   1. La columna hermana `tipo` (urgente/info/social/venta) ya es TEXT libre.
--   2. Añadir un canal nuevo (telegram, sms) no debe obligar a un ALTER TYPE.
--   3. El CHECK igual impide valores inventados: la integridad se mantiene.
--
-- Seguro de reejecutar. No modifica ni borra filas existentes.
-- =============================================================================

BEGIN;


ALTER TABLE public.anuncios
    ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'texto';

ALTER TABLE public.anuncios
    ADD COLUMN IF NOT EXISTS destino_tipo text NOT NULL DEFAULT 'ninguno';


-- Restricciones. Se eliminan primero para permitir reejecutar el script.
ALTER TABLE public.anuncios
    DROP CONSTRAINT IF EXISTS anuncios_modo_valido;

ALTER TABLE public.anuncios
    ADD CONSTRAINT anuncios_modo_valido
    CHECK (modo IN ('texto', 'imagen', 'mixto'));

ALTER TABLE public.anuncios
    DROP CONSTRAINT IF EXISTS anuncios_destino_tipo_valido;

ALTER TABLE public.anuncios
    ADD CONSTRAINT anuncios_destino_tipo_valido
    CHECK (destino_tipo IN ('form', 'whatsapp', 'email', 'url', 'pagina', 'ninguno'));


-- Si destino_tipo no es 'ninguno', hace falta un destino al que ir.
ALTER TABLE public.anuncios
    DROP CONSTRAINT IF EXISTS anuncios_destino_requerido;

ALTER TABLE public.anuncios
    ADD CONSTRAINT anuncios_destino_requerido
    CHECK (
        destino_tipo = 'ninguno'
        OR (destino_url IS NOT NULL AND length(trim(destino_url)) > 0)
    );


-- Solo el modo 'imagen' necesita una imagen obligatoriamente: sin ella la
-- tarjeta sería un hueco vacío. Los modos 'texto' y 'mixto' funcionan igual
-- sin imagen (el render omite el bloque si no hay imagen_url).
--
-- OJO: la primera versión de esta restricción estaba invertida —
--   CHECK (modo = 'imagen' OR imagen_url IS NOT NULL)
-- — y rechazaba todos los anuncios de texto, que son la mayoría. Se detectó al
-- migrar data/anuncios.json (error 23514).
ALTER TABLE public.anuncios
    DROP CONSTRAINT IF EXISTS Announces_modo_imagen_requerida;

ALTER TABLE public.anuncios
    ADD CONSTRAINT Announces_modo_imagen_requerida
    CHECK (
        modo <> 'imagen'
        OR (imagen_url IS NOT NULL AND length(trim(imagen_url)) > 0)
    );


-- La tabla ya traía `anuncios_texto_check`, aplicado durante la auditoría del
-- 14/10/2026:
--
--     CHECK (length(trim(texto)) >= 1)
--
-- Ese CHECK choca con el modo 'imagen', que por definición va sin texto: hace
-- imposible crear la tarjeta "solo imagen" que describe el README y dibuja
-- js/comunidad.js. Se reemplaza por una versión que solo exige texto cuando la
-- tarjeta efectivamente lo lleva.
ALTER TABLE public.anuncios
    DROP CONSTRAINT IF EXISTS anuncios_texto_check;

ALTER TABLE public.anuncios
    ADD CONSTRAINT anuncios_texto_check
    CHECK (
        modo = 'imagen'
        OR length(trim(texto)) >= 1
    );


COMMIT;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN (ejecutar después del COMMIT)
-- Debe devolver 6 filas: 4 de este script + anuncios_fechas_check y
-- anuncios_texto_check, que ya existían.
-- -----------------------------------------------------------------------------
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.anuncios'::regclass AND contype = 'c'
-- ORDER BY conname;


-- -----------------------------------------------------------------------------
-- MIGRACIÓN DE LOS ANUNCIOS DEL JSON HISTÓRICO
-- data/anuncios.json tiene 4 tarjetas. Este INSERT las trae a Postgres.
-- Ejecutar solo después de aplicar los ALTER de arriba.
--
-- OJO: el JSON traía un campo `autor` con texto libre ("Prof. Ramírez · Redes").
-- Esa columna NO existe en la tabla: el autor se deriva con un JOIN a
-- perfiles_admin, igual que en el resto del portal. Aquí solo se guarda
-- `autor_id`, y el matiz del rol va dentro del propio texto.
--
-- Reemplaza <TU_UUID> por el id de tu perfil. Para obtenerlo:
--   SELECT id, nombre, rol, estado FROM public.perfiles_admin;
-- -----------------------------------------------------------------------------
-- INSERT INTO public.anuncios
--     (titulo, tipo, modo, texto, imagen_url,
--      destino_url, destino_tipo, destino_label, autor_id)
-- VALUES
--     ('Cambio de horario: Laboratorio de Redes', 'urgente', 'texto',
--      '⚠️ Cambio de horario: Laboratorio de Redes — Lunes pasa a las 3:00 PM desde esta semana. Prof. Ramírez · Redes y Telecomunicaciones.',
--      NULL, NULL, 'ninguno', NULL, '<TU_UUID>'),
--
--     ('Convocatoria: Proyecto de Investigación IoT', 'info', 'mixto',
--      'Se buscan alumnos para proyecto de investigación IoT. Requisito: haber cursado 5to ciclo+. Inscribirse hasta el viernes. Dev Team UDH · Innovación.',
--      NULL, 'https://forms.google.com', 'form', 'Inscribirme ahora', '<TU_UUID>'),
--
--     ('El equipo Nexo busca colaboradores', 'social', 'texto',
--      '¿Tienes talento para el diseño gráfico o edición de video? El equipo Nexo busca colaboradores. Escríbenos por WhatsApp.',
--      NULL, 'https://wa.me/51999999999', 'whatsapp', 'Escribir por WhatsApp', '<TU_UUID>'),
--
--     ('Bolsa Laboral: practicante de desarrollo web', 'venta', 'texto',
--      'Empresa local solicita practicante de desarrollo web. Horario flexible. Bolsa Laboral FISI.',
--      NULL, 'mailto:rrhh@empresa.pe', 'email', 'Enviar CV', '<TU_UUID>');
--
-- Tras insertarlas hay que ponerles fecha_inicio (si no, la política de
-- vigencia las oculta) y publicarlas:
--
-- UPDATE public.anuncios
--    SET fecha_inicio = now(),
--        estado       = 'PUBLICADO'
--  WHERE autor_id = '<TU_UUID>';
-- =============================================================================
