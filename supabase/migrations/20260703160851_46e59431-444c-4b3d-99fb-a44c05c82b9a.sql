
CREATE OR REPLACE FUNCTION public.join_room_by_code(
  _code text,
  _display_name text,
  _pct numeric,
  _badge text,
  _streak int,
  _coins int
) RETURNS public.attendance_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.attendance_rooms;
BEGIN
  SELECT * INTO r FROM public.attendance_rooms WHERE invite_code = upper(_code);
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Room code not found';
  END IF;
  INSERT INTO public.room_members (room_id, user_id, display_name, attendance_pct, status_badge, active_streak, bunk_coins, last_seen_at)
    VALUES (r.id, auth.uid(), _display_name, _pct, _badge, _streak, _coins, now())
    ON CONFLICT (room_id, user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      attendance_pct = EXCLUDED.attendance_pct,
      status_badge = EXCLUDED.status_badge,
      active_streak = EXCLUDED.active_streak,
      bunk_coins = EXCLUDED.bunk_coins,
      last_seen_at = now();
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_room_by_code(text, text, numeric, text, int, int) TO authenticated;
