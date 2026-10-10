import { describe, expect, it } from "vitest";
import { registry } from "@/lib/protocols/registry";
import { createNames } from "./labels";

const A = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const TWIN = "dLm6yzRBcha48dokvEP9oNyZvFrt7p1syauDeBMf5Vo";
const label = { caseId: "c", address: A, name: "Suspect", tags: [] };

describe("name options", () => {
  it("shortens bare addresses to the preferred length, or shows them whole", () => {
    expect(createNames(new Map(), registry).of(A)).toBe("dLm6…f5Vo");
    expect(createNames(new Map(), registry, new Map(), new Map(), new Map(), { chars: 8 }).of(A)).toBe("dLm61Lvp…MrDdf5Vo");
    expect(createNames(new Map(), registry, new Map(), new Map(), new Map(), { chars: Infinity }).of(A)).toBe(A);
    // An explicit length from the caller still wins.
    expect(createNames(new Map(), registry, new Map(), new Map(), new Map(), { chars: 8 }).of(A, 4)).toBe("dLm6…f5Vo");
  });

  it("keeps look-alikes apart whatever the length", () => {
    const names = createNames(new Map(), registry, new Map([[A, [TWIN]], [TWIN, [A]]]));
    expect(names.of(A)).not.toBe(names.of(TWIN));
  });

  it("shows the address first when names aren't preferred, but still knows the name", () => {
    const names = createNames(new Map([[A, label]]), registry, new Map(), new Map(), new Map(), { preferNames: false });
    expect(names.of(A)).toBe("dLm6…f5Vo");
    expect(names.known(A)).toBe("Suspect");
  });

  it("skips .sol names when they're hidden", () => {
    const sns = new Map([[A, "kai.sol"]]);
    expect(createNames(new Map(), registry, new Map(), new Map(), sns).of(A)).toBe("kai.sol");
    expect(createNames(new Map(), registry, new Map(), new Map(), sns, { sns: false }).of(A)).toBe("dLm6…f5Vo");
  });
});
