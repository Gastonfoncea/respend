-- Bucket privado para las fotos de los tickets. Sin políticas: solo el servidor (clave secreta) lee y escribe.
-- Fuera de Supabase (PGlite en tests y desarrollo) no existe el esquema storage y no hace nada.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('tickets', 'tickets', false, 4194304, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
