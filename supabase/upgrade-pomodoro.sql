-- Run once in the Supabase SQL editor. No service-role key belongs in the app.
-- Additive migration: existing task/routine tables are unchanged.
CREATE TABLE IF NOT EXISTS public.focus_entries (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    id text NOT NULL,
    focused_on date NOT NULL,
    milliseconds bigint NOT NULL CHECK (milliseconds > 0 AND milliseconds <= 86400000),
    task_title text NOT NULL DEFAULT '',
    ended_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS focus_entries_user_day ON public.focus_entries(user_id, focused_on);
CREATE TABLE IF NOT EXISTS public.focus_goals (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    goal_on date NOT NULL,
    hours numeric NOT NULL CHECK (hours >= 0.25 AND hours <= 24),
    PRIMARY KEY (user_id, goal_on)
);
ALTER TABLE public.focus_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_goals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'focus_entries' AND policyname = 'focus_entries_owner') THEN
        CREATE POLICY focus_entries_owner ON public.focus_entries FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'focus_goals' AND policyname = 'focus_goals_owner') THEN
        CREATE POLICY focus_goals_owner ON public.focus_goals FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
    END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.focus_entries, public.focus_goals TO authenticated;
