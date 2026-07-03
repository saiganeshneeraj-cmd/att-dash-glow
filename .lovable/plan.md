## Goal
Ship all four workstreams from the brief in one pass: local-first performance, premium palette/motion, sticky nav, and grid-style bulk edit with undo.

## 1. Local-first performance (IndexedDB + optimistic sync)

- Add `idb` (~1KB wrapper) via `bun add idb`.
- New `src/lib/local-store.ts`:
  - Open DB `attendance-cache` with stores `state` (whole `AppState` snapshot, keyed by user id) and `pending` (queued deltas: `{id, userId, subjectId, dateISO, index, status, ts}`).
  - `loadCached(userId)`, `saveCached(userId, state)`, `enqueueDelta(delta)`, `drainPending()`.
- New `src/lib/sync.ts`:
  - `scheduleSync(userId, state, deltas)`: debounced (400ms) + `navigator.onLine` gated background push to Supabase `user_data`. Retries on failure with exponential backoff, marks failed deltas so UI can render a retry badge.
  - Emits a `syncStatus` event ("idle"/"syncing"/"error"/"offline") consumed by a tiny header pill.
- Refactor `AttendancePage` load path:
  - On mount, hydrate from IndexedDB synchronously (via `useSyncExternalStore` w/ suspense fallback) → paint instantly.
  - Kick off remote fetch; reconcile by `updated_at` (server wins if newer, else push local).
- Refactor mutation path (`toggleClassStatus`, day summary edits, bulk apply):
  - Update React state immediately (already optimistic today).
  - Also call `saveCached()` + `enqueueDelta()`.
  - `scheduleSync()` fires in background. Remove the current per-change `supabase.upsert` blocking path.
- Track `pendingByKey: Set<string>` in state; if a delta errors, tag the class cell with a red dot + tooltip "Retry" that re-enqueues on click.

## 2. Premium palette + micro-animations

- Update `src/styles.css` tokens toward soft/sophisticated:
  - `--success` → sage `oklch(0.78 0.09 150)` (present)
  - `--danger` → terracotta `oklch(0.68 0.14 30)` (absent)
  - `--warning` → warm amber `oklch(0.82 0.13 75)` (half/holiday)
  - Keep neon accents for hero/gradients only; tone down default surfaces (`--card` slightly warmer).
- Global 200ms transitions: extend `.smooth-colors` to include `transform`; add `transition-[background,color,border,box-shadow,transform] duration-200 ease-out` defaults on Card / Button variants used in the log.
- Skeleton loaders: use existing `<Skeleton>` for the DayCard list until IndexedDB hydration resolves. Shell (header, tabs, day carousel) always renders instantly.
- Fade/slide utilities already exist (`animate-fade-in`, `animate-toast-in`) — apply to the new floating action bar and status pill.

## 3. Sticky navigation

- Day carousel wrapper: `sticky top-0 z-30 backdrop-blur bg-background/75 border-b border-border/40`.
- Inside the History table: `TableHeader` gets `sticky top-0`; first column (subject name) gets `sticky left-0` with matching background so it stays put on horizontal scroll.
- Ensure parent scroll container has `overflow-auto` and no `transform` (breaks sticky).

## 4. Grid-style Bulk Edit

- New view mode toggle on the Log tab: **"Bulk Edit"** switch. When on:
  - Render a new `<BulkGrid>` component: rows = days (chronological), columns = subjects. Cells show current status color chips.
  - Column header + row header get checkboxes; clicking selects entire col/row.
  - Cell selection: pointer-down + drag paints a rectangle (`onPointerDown/Move/Up` with a `selectionRect` in state; convert to `Set<cellKey>` on pointerup).
  - Shift-click extends, Ctrl/Cmd-click toggles individual cells.
- **Floating Action Bar** (`fixed bottom-4 inset-x-4 md:inset-x-auto md:right-6 md:left-auto`):
  - Shows count "{n} cells selected".
  - Buttons: Present, Absent, Cancelled/Holiday, Clear. Slide-up via `animate-toast-in`.
- **Apply flow**:
  1. Compute batch of deltas from selected cells.
  2. Snapshot previous statuses for undo.
  3. Update React state + IndexedDB + enqueue single sync payload.
  4. Show undo toast (`sonner`) for 6s → on click, reverse deltas + enqueue reverse batch.

## Files touched / created

- Add: `src/lib/local-store.ts`, `src/lib/sync.ts`, `src/components/BulkGrid.tsx`, `src/components/BulkActionBar.tsx`, `src/components/SyncStatusPill.tsx`.
- Edit: `src/routes/index.tsx` (integrate cache/sync, bulk mode toggle, sticky carousel, palette-aware chips, skeletons), `src/styles.css` (tokens + transitions), `package.json` (`idb`).

## Out of scope

- No new server-side batching endpoint — Supabase upsert of the whole `data` blob remains the transport; the perf win comes from IndexedDB-first paint, debounced background sync, and dropped await-on-every-toggle. If you later want true per-delta rows in Postgres, that's a follow-up.
- Multi-user/manager roles — this stays a personal tracker; bulk edit is grid of your own days × subjects.
