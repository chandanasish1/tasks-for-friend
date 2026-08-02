-- Upgrade for EXISTING databases moving to v1.12.0 (routine heatmap).
-- Fresh installs don't need this — setup.sql already includes it.
-- Paste into the Supabase SQL editor and run once. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.routine_days (
    user_id uuid NOT NULL REFERENCES auth.users(id),
    done_on date NOT NULL,
    completed integer NOT NULL DEFAULT 0,
    total integer NOT NULL DEFAULT 0,
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, done_on)
);

ALTER TABLE public.routine_days ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'routine_days'
          AND policyname = 'routine_days_authenticated_owner'
    ) THEN
        CREATE POLICY routine_days_authenticated_owner
        ON public.routine_days
        FOR ALL
        TO authenticated
        USING ((SELECT auth.uid()) = user_id)
        WITH CHECK ((SELECT auth.uid()) = user_id);
    END IF;
END $$;
