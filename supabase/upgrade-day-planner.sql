-- Additive migration for task scheduling. Run in the Supabase SQL editor.
-- Existing owner RLS, optimistic concurrency and realtime policies remain in place.
BEGIN;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS duration_minutes integer;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS time_kind text NOT NULL DEFAULT 'start';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_rigid boolean NOT NULL DEFAULT true;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS day_order jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_duration_valid') THEN
        ALTER TABLE public.tasks ADD CONSTRAINT tasks_duration_valid CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_time_kind_valid') THEN
        ALTER TABLE public.tasks ADD CONSTRAINT tasks_time_kind_valid CHECK (time_kind IN ('start', 'deadline'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_day_order_object') THEN
        ALTER TABLE public.tasks ADD CONSTRAINT tasks_day_order_object CHECK (jsonb_typeof(day_order) = 'object');
    END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
