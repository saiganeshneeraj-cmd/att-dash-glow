import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeInviteCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)];
  return code;
}

const memberStatsSchema = z.object({
  attendancePct: z.number().min(0).max(100),
  statusBadge: z.enum(["Safe", "On the Edge", "In Danger"]),
  activeStreak: z.number().int().min(0).max(9999),
  bunkCoins: z.number().int().min(0).max(9999),
});

export const listMyRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: memberships, error: memberError } = await supabase
      .from("room_members")
      .select("room_id, display_name")
      .order("updated_at", { ascending: false });
    if (memberError) throw memberError;

    const roomIds = Array.from(new Set((memberships ?? []).map((m) => m.room_id)));
    if (roomIds.length === 0) return [];

    const { data: rooms, error: roomError } = await supabase
      .from("attendance_rooms")
      .select("id, name, invite_code, owner_id, created_at")
      .in("id", roomIds);
    if (roomError) throw roomError;
    return (rooms ?? []).sort((a, b) => roomIds.indexOf(a.id) - roomIds.indexOf(b.id));
  });

export const createAttendanceRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    name: z.string().trim().min(2).max(48),
    displayName: z.string().trim().min(1).max(32),
    stats: memberStatsSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const inviteCode = makeInviteCode();
      const { data: room, error } = await supabase
        .from("attendance_rooms")
        .insert({ name: data.name, invite_code: inviteCode, owner_id: userId })
        .select("id, name, invite_code, owner_id, created_at")
        .single();
      if (error) {
        lastError = error;
        if (String(error.message).toLowerCase().includes("duplicate")) continue;
        throw error;
      }
      const { error: memberError } = await supabase.from("room_members").insert({
        room_id: room.id,
        user_id: userId,
        display_name: data.displayName,
        attendance_pct: data.stats.attendancePct,
        status_badge: data.stats.statusBadge,
        active_streak: data.stats.activeStreak,
        bunk_coins: data.stats.bunkCoins,
      });
      if (memberError) throw memberError;
      return room;
    }
    throw lastError ?? new Error("Could not create a unique room code");
  });

export const joinAttendanceRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    inviteCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/),
    displayName: z.string().trim().min(1).max(32),
    stats: memberStatsSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: room, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)("join_room_by_code", {
      _code: data.inviteCode,
      _display_name: data.displayName,
      _pct: data.stats.attendancePct,
      _badge: data.stats.statusBadge,
      _streak: data.stats.activeStreak,
      _coins: data.stats.bunkCoins,
    });
    if (error) throw new Error(error.message || "Room code not found");
    if (!room) throw new Error("Room code not found");
    return room as { id: string; name: string; invite_code: string; owner_id: string; created_at: string };
  });

export const deleteAttendanceRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ roomId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("attendance_rooms")
      .delete()
      .eq("id", data.roomId)
      .eq("owner_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const getRoomSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ roomId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [roomRes, memberRes, pollRes, sosRes] = await Promise.all([
      supabase.from("attendance_rooms").select("id, name, invite_code, owner_id, created_at").eq("id", data.roomId).single(),
      supabase.from("room_members").select("id, room_id, user_id, display_name, attendance_pct, status_badge, active_streak, bunk_coins, last_seen_at").eq("room_id", data.roomId).order("attendance_pct", { ascending: false }),
      supabase.from("mass_bunk_polls").select("id, room_id, creator_id, subject, class_slot, class_date, is_closed, created_at").eq("room_id", data.roomId).eq("is_closed", false).order("created_at", { ascending: false }).limit(3),
      supabase.from("sos_broadcasts").select("id, room_id, sender_id, sender_name, subject, class_slot, message, expires_at, created_at").eq("room_id", data.roomId).order("created_at", { ascending: false }).limit(5),
    ]);
    if (roomRes.error) throw roomRes.error;
    if (memberRes.error) throw memberRes.error;
    if (pollRes.error) throw pollRes.error;
    if (sosRes.error) throw sosRes.error;
    const pollIds = (pollRes.data ?? []).map((p) => p.id);
    const voteRes = pollIds.length
      ? await supabase.from("mass_bunk_votes").select("id, poll_id, user_id, intent, created_at").in("poll_id", pollIds)
      : { data: [], error: null };
    if (voteRes.error) throw voteRes.error;
    return {
      room: roomRes.data,
      members: memberRes.data ?? [],
      polls: pollRes.data ?? [],
      votes: voteRes.data ?? [],
      sos: sosRes.data ?? [],
    };
  });

export const syncRoomMemberStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    roomId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(32),
    stats: memberStatsSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("room_members").update({
      display_name: data.displayName,
      attendance_pct: data.stats.attendancePct,
      status_badge: data.stats.statusBadge,
      active_streak: data.stats.activeStreak,
      bunk_coins: data.stats.bunkCoins,
      last_seen_at: new Date().toISOString(),
    }).eq("room_id", data.roomId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const createMassBunkPoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    roomId: z.string().uuid(),
    subject: z.string().trim().min(1).max(64),
    classSlot: z.string().trim().min(1).max(64),
    classDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: poll, error } = await supabase.from("mass_bunk_polls").insert({
      room_id: data.roomId,
      creator_id: userId,
      subject: data.subject,
      class_slot: data.classSlot,
      class_date: data.classDate,
    }).select("id, room_id, creator_id, subject, class_slot, class_date, is_closed, created_at").single();
    if (error) throw error;
    return poll;
  });

export const voteMassBunkPoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    pollId: z.string().uuid(),
    intent: z.enum(["attending", "bunking"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("mass_bunk_votes").upsert({
      poll_id: data.pollId,
      user_id: userId,
      intent: data.intent,
    }, { onConflict: "poll_id,user_id" });
    if (error) throw error;
    return { ok: true };
  });

export const sendSosBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    roomId: z.string().uuid(),
    senderName: z.string().trim().min(1).max(32),
    subject: z.string().trim().min(1).max(64),
    classSlot: z.string().trim().min(1).max(64),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const message = `${data.senderName} is running late for this lecture! Keep an eye out for the roll call.`;
    const { data: sos, error } = await supabase.from("sos_broadcasts").insert({
      room_id: data.roomId,
      sender_id: userId,
      sender_name: data.senderName,
      subject: data.subject,
      class_slot: data.classSlot,
      message,
    }).select("id, room_id, sender_id, sender_name, subject, class_slot, message, expires_at, created_at").single();
    if (error) throw error;
    return sos;
  });