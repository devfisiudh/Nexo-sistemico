-- =============================================================================
-- 03_anuncios_autor_texto.sql
--
-- Por qué hace falta.
--
-- El tablón de Comunidad muestra debajo del texto quién publica el anuncio.
-- El histórico (data/anuncios.json) lo traía como texto libre:
--
--   "Prof. Ramírez · Redes y Telecomunicaciones"
--   "Dev Team UDH · Innovación"
--
-- La tabla `anuncios` solo tiene `autor_id`, que apunta a perfiles_admin.
-- Pero perfiles_admin NO es legible por el anónimo: sus únicas políticas son
--
--   administrador_perfiles_select → USING (es_administrador())
--   perfil_propio_select         → USING (id = auth.uid())
--
-- Es decir, el visitante anónimo no puede resolver el nombre del autor. Un
-- join desde el portal devolvería vacío siempre.
--
-- Solución: dos columnas con papeles distintos.
--   autor_id     → quiénmêmeTekstenpublicó desde el panel (auditoría, RLS)
--   autor_texto  → qué se muestra en el tablón (texto libre, p. ej. "Prof. Ramírez · Redes")
--
-- Si se prefiriera no duplicar el dato, la alternativa sería una vista
-- SECURITY DEFINER que expusiera solo `nombre` — pero eso abre la tabla a
-- enumeración de cuentas de administración. Una columna de texto en la tabla
-- de contenido es más simple y no expone nada.
--
-- Seguro de reejecutar. No modifica ni borra filas existentes.
-- =============================================================================

BEGIN;

ALTER TABLE public.anuncios
    ADD COLUMN IF NOT EXISTS autor_texto text;

COMMENT ON COLUMN public.anuncios.autor_texto IS
    'Atribución visible en el tablón público (texto libre). autor_id queda como rastro de auditoría.';

COMMIT;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN
-- -----------------------------------------------------------------------------
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'anuncios'
--   AND column_name = 'autor_texto';


-- -----------------------------------------------------------------------------
-- ATENCIÓN AL MIGRAR LOS ANUNCIOS HISTÓRICOS
--
-- de data/anuncios.json a public.anuncios, el campo "autor" del JSON va a
-- autor_texto (NO a autor_id):
--
--   'Prof. Ramírez · Redes y Telecomunicaciones' → autor_texto
--   'Dev Team UDH · Innovación'                 → autor_texto
--   'Equipo Nexo Sistémico'                     → autor_texto
--   'Bolsa Laboral FISI'                        → autor_texto
--
-- mientras autor_id lleva el UUID de la cuenta del panel.
-- =============================================================================
