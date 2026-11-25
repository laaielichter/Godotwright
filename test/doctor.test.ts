import { describe, expect, it } from "vitest";

describe("the lesson doctor names for a finding", () => {
  it("picks the lesson of the rule that fits the message, not the first one", async () => {
    const { closestLesson } = await import("../src/doctor/doctor.js");
    const { lessonsForRule } = await import("../src/lessons/search.js");
    const hits = lessonsForRule("api/infer-variant", { limit: 10 });
    expect(hits.length).toBeGreaterThan(1);
    expect(closestLesson(hits, 'Cannot infer the type of "source_weak": weakref() returns Variant. Give it a type.')?.lesson.id).toBe("gdscript/variant-returning-calls-need-a-type");
    expect(closestLesson(hits, 'Cannot infer the type of "p": the loop variable over an untyped array is a Variant.')?.lesson.id).toBe("gdscript/variant-loop-inference");
  });
});
