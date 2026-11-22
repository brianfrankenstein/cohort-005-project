import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  MAX_NOTE_LENGTH,
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./saved.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 12, 0, 0);
const LATEST = new Date(2026, 9, 8, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let otherStudentId: number;
let lessonId: number;
let secondLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  otherStudentId = db
    .insert(schema.users)
    .values({
      name: "Other Student",
      email: "other@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get().id;

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  secondLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson that was not bookmarked", () => {
    toggleBookmark(db, base.user.id, lessonId, NOW);

    expect(isBookmarked(db, base.user.id, lessonId)).toBe(true);
  });

  it("removes the Bookmark when toggled again", () => {
    toggleBookmark(db, base.user.id, lessonId, NOW);
    toggleBookmark(db, base.user.id, lessonId, LATER);

    expect(isBookmarked(db, base.user.id, lessonId)).toBe(false);
  });

  it("leaves another Student's Bookmark on the same Lesson alone", () => {
    toggleBookmark(db, otherStudentId, lessonId, NOW);
    toggleBookmark(db, base.user.id, lessonId, NOW);
    toggleBookmark(db, base.user.id, lessonId, LATER);

    expect(isBookmarked(db, otherStudentId, lessonId)).toBe(true);
  });

  it("fails on a Lesson that does not exist", () => {
    expect(() => toggleBookmark(db, base.user.id, 9999, NOW)).toThrow();
  });
});

describe("saving a Note", () => {
  it("creates the Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonId, "  Read twice.  ", NOW);

    expect(result).toMatchObject({
      ok: true,
      note: {
        userId: base.user.id,
        lessonId,
        body: "Read twice.",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    });
  });

  it("updates the same Note rather than adding a second one", () => {
    saveNote(db, base.user.id, lessonId, "First draft", NOW);
    saveNote(db, base.user.id, lessonId, "Second draft", LATER);

    expect(listNotes(db, base.user.id)).toHaveLength(1);
    expect(getNote(db, base.user.id, lessonId)).toMatchObject({
      body: "Second draft",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it("deletes the Note when the body is cleared", () => {
    saveNote(db, base.user.id, lessonId, "Something", NOW);

    const result = saveNote(db, base.user.id, lessonId, "   ", LATER);

    expect(result).toEqual({ ok: true, note: null });
    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
  });

  it("clearing a Note that does not exist is a no-op", () => {
    expect(saveNote(db, base.user.id, lessonId, "", NOW)).toEqual({
      ok: true,
      note: null,
    });
  });

  it(`accepts a body of exactly ${MAX_NOTE_LENGTH} characters`, () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonId,
      "a".repeat(MAX_NOTE_LENGTH),
      NOW
    );

    expect(result.ok).toBe(true);
  });

  it(`refuses a body over ${MAX_NOTE_LENGTH} characters and keeps the old Note`, () => {
    saveNote(db, base.user.id, lessonId, "Keep me", NOW);

    const result = saveNote(
      db,
      base.user.id,
      lessonId,
      "a".repeat(MAX_NOTE_LENGTH + 1),
      LATER
    );

    expect(result).toEqual({
      ok: false,
      error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    });
    expect(getNote(db, base.user.id, lessonId)?.body).toBe("Keep me");
  });

  it("clearing a Note leaves another Student's Note on the same Lesson alone", () => {
    saveNote(db, otherStudentId, lessonId, "Mine", NOW);
    saveNote(db, base.user.id, lessonId, "Yours", NOW);

    saveNote(db, base.user.id, lessonId, "", LATER);

    expect(getNote(db, otherStudentId, lessonId)?.body).toBe("Mine");
  });
});

describe("the Saved lists", () => {
  it("lists Bookmarks newest first, with the Lesson's Module and Course", () => {
    toggleBookmark(db, base.user.id, lessonId, NOW);
    toggleBookmark(db, base.user.id, secondLessonId, LATER);

    expect(listBookmarks(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId: secondLessonId,
        lessonTitle: "Lesson 2",
        moduleTitle: "Basics",
        courseTitle: "Test Course",
        courseSlug: "test-course",
        createdAt: LATER.toISOString(),
      }),
      expect.objectContaining({ lessonId, createdAt: NOW.toISOString() }),
    ]);
  });

  it("lists Notes most recently edited first, not by creation", () => {
    saveNote(db, base.user.id, lessonId, "Older Note", NOW);
    saveNote(db, base.user.id, secondLessonId, "Newer Note", LATER);
    saveNote(db, base.user.id, lessonId, "Older Note, edited", LATEST);

    expect(listNotes(db, base.user.id).map((note) => note.body)).toEqual([
      "Older Note, edited",
      "Newer Note",
    ]);
  });

  it("shows a Student only their own Bookmarks and Notes", () => {
    toggleBookmark(db, otherStudentId, lessonId, NOW);
    saveNote(db, otherStudentId, lessonId, "Private", NOW);

    expect(listBookmarks(db, base.user.id)).toEqual([]);
    expect(listNotes(db, base.user.id)).toEqual([]);
  });
});
