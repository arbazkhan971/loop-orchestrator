import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEAM,
  getSmeRole,
  listSmeDisciplines,
  SME_LIBRARY
} from "../src/sme.js";

describe("sme library", () => {
  it("SME_LIBRARY has an entry for every listed discipline", () => {
    const disciplines = listSmeDisciplines();
    expect(disciplines.length).toBeGreaterThan(0);
    for (const discipline of disciplines) {
      expect(SME_LIBRARY[discipline]).toBeDefined();
      // The key should match the entry's own discipline field.
      expect(SME_LIBRARY[discipline].discipline).toBe(discipline);
    }
  });

  it("every role has non-empty identity, operatingLoop, and definitionOfDone", () => {
    for (const role of Object.values(SME_LIBRARY)) {
      expect(role.identity.trim().length).toBeGreaterThan(0);
      expect(role.operatingLoop.length).toBeGreaterThan(0);
      expect(role.definitionOfDone.length).toBeGreaterThan(0);
      expect(role.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("backend prefers the codex provider", () => {
    expect(getSmeRole("backend").preferredProvider).toBe("codex");
  });

  it("DEFAULT_TEAM is non-empty and every member exists in the library", () => {
    expect(DEFAULT_TEAM.length).toBeGreaterThan(0);
    for (const member of DEFAULT_TEAM) {
      expect(SME_LIBRARY[member]).toBeDefined();
    }
  });

  it("unknown discipline falls back to the engineer role", () => {
    // The signature is typed to SmeDiscipline, but the fallback exists for runtime safety.
    const role = getSmeRole("not-a-real-discipline" as never);
    expect(role).toBe(SME_LIBRARY.engineer);
    expect(role.discipline).toBe("engineer");
  });
});
