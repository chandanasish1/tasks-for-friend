-- ============================================================
-- TASKS app — fresh-install schema (one-shot setup)
-- ============================================================
-- Paste this whole file into the Supabase SQL editor of a brand-new
-- project and run it once. It creates everything the app needs:
-- tables, versioning triggers, row-level security, and realtime.
--
-- This is the CURRENT schema the app expects (v1.10.1+), consolidated
-- from the historical migrations in supabase/migrations. Do not run
-- those migrations on a fresh project — the chain includes a cleanup
-- that drops tasks.completed_at, which the app has required again
-- since v1.9.0 (it was re-added on the original live database).
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Tables ----------

CREATE TABLE IF NOT EXISTS public.lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    position double precision,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    version integer NOT NULL DEFAULT 0,
    user_id uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
    title text NOT NULL,
    notes text DEFAULT '',
    due_date date,
    due_time time,
    position double precision NOT NULL,
    today_position double precision,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    version integer NOT NULL DEFAULT 0,
    user_id uuid REFERENCES auth.users(id)
);

-- ---------- Indexes ----------

CREATE INDEX IF NOT EXISTS idx_lists_user_created_at
    ON public.lists USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_list_id
    ON public.tasks USING btree (list_id);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date
    ON public.tasks USING btree (due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_user_list_position
    ON public.tasks USING btree (user_id, list_id, position ASC);

-- ---------- Optimistic-concurrency versioning ----------
-- Every UPDATE bumps version and touches updated_at. The app sends
-- "expected version" with each write; a mismatch means another device
-- changed the row first, and the server's state wins.

CREATE OR REPLACE FUNCTION public.touch_row_and_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
    NEW.updated_at = now();
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lists_touch ON public.lists;
CREATE TRIGGER trg_lists_touch
BEFORE UPDATE ON public.lists
FOR EACH ROW EXECUTE FUNCTION public.touch_row_and_bump_version();

DROP TRIGGER IF EXISTS trg_tasks_touch ON public.tasks;
CREATE TRIGGER trg_tasks_touch
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_row_and_bump_version();

-- ---------- Row-level security ----------
-- Each signed-in user can only ever see and touch their own rows.

ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'lists'
          AND policyname = 'lists_authenticated_owner'
    ) THEN
        CREATE POLICY lists_authenticated_owner
        ON public.lists
        FOR ALL
        TO authenticated
        USING ((SELECT auth.uid()) = user_id)
        WITH CHECK ((SELECT auth.uid()) = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tasks'
          AND policyname = 'tasks_authenticated_owner'
    ) THEN
        CREATE POLICY tasks_authenticated_owner
        ON public.tasks
        FOR ALL
        TO authenticated
        USING ((SELECT auth.uid()) = user_id)
        WITH CHECK ((SELECT auth.uid()) = user_id);
    END IF;
END $$;

-- ---------- Realtime (live cross-device sync) ----------

ALTER TABLE public.lists REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public' AND tablename = 'lists'
        ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.lists';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public' AND tablename = 'tasks'
        ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks';
        END IF;
    END IF;
END $$;

COMMIT;
