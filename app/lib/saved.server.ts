import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

export const MAX_NOTE_LENGTH = 2000;

function getBookmark(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .get();
}

export function isBookmarked(db: Db, userId: number, lessonId: number) {
  return !!getBookmark(db, userId, lessonId);
}

/** Bookmarks the Lesson for the Student, or removes their Bookmark if it is there. */
export function toggleBookmark(
  db: Db,
  userId: number,
  lessonId: number,
  now: Date
) {
  const existing = getBookmark(db, userId, lessonId);

  if (existing) {
    db.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run();
    return;
  }

  db.insert(bookmarks)
    .values({ userId, lessonId, createdAt: now.toISOString() })
    .run();
}

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

export type SaveNoteResult =
  | { ok: true; note: Note | null }
  | { ok: false; error: string };

/**
 * Writes the Student's one Note on a Lesson. The body is trimmed; an empty
 * body deletes the Note, and `note` comes back null.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    };
  }

  const ownNote = and(eq(notes.userId, userId), eq(notes.lessonId, lessonId));

  if (trimmed.length === 0) {
    db.delete(notes).where(ownNote).run();
    return { ok: true, note: null };
  }

  const timestamp = now.toISOString();
  const existing = getNote(db, userId, lessonId);

  if (existing) {
    const note = db
      .update(notes)
      .set({ body: trimmed, updatedAt: timestamp })
      .where(eq(notes.id, existing.id))
      .returning()
      .get();
    return { ok: true, note };
  }

  const note = db
    .insert(notes)
    .values({
      userId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
  return { ok: true, note };
}

// The Lesson, Module and Course columns both Saved lists show beside each row.
const lessonRefColumns = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first. */
export function listBookmarks(db: Db, userId: number) {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      ...lessonRefColumns,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt))
    .all();
}

/** The Student's Notes, most recently edited first. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRefColumns,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt))
    .all();
}
