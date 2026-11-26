import {
  faceMark,
  faceMarkKinds,
  faceMarkKindTable,
  faceMarkLimit,
  faceMarkSides,
  type FaceMark,
  type HumanAdultParams,
} from "@irudd/character/human";
import { choices, field } from "./garment-fields.js";
import { seed, type Fields, type Edit } from "./surface-fields.js";

export function markControls(
  f: Fields,
  params: HumanAdultParams,
  index: number,
  choose: (i: number) => void,
  edit: Edit,
) {
  const marks = params.faceMarks ?? [];
  function save(next: readonly FaceMark[]) {
    return [{ op: "generation.steer", params: { ...params, faceMarks: next } }];
  }
  const kind = f.choose("New face mark", faceMarkKinds, "Freckles");
  f.action(
    "Add face mark",
    () =>
      edit("Add face mark", () => {
        choose(marks.length);
        return save([...marks, faceMark(kind(), seed())]);
      }),
    marks.length < faceMarkLimit,
  );
  const i = Math.min(index, marks.length - 1),
    mark = marks[i];
  if (!mark) return;
  const list = choices(
    marks.map((_, n) => String(n)),
    String(i),
    (n) => String(Number(n) + 1) + " · " + marks[Number(n)]?.kind,
  );
  list.input.onchange = () => choose(Number(list.read()));
  f.rows.append(field("Face mark", list.input));
  const type = choices(faceMarkKinds, mark.kind);
  type.input.onchange = () =>
    edit("Change face mark kind", () => {
      const next = type.read(),
        options: readonly string[] = faceMarkKindTable[next].places;
      const { place, turn: _turn, across: _across, up: _up, ...rest } = mark;
      return change({
        ...rest,
        kind: next,
        place: options.includes(place) ? place : faceMarkKindTable[next].places[0],
      });
    });
  f.rows.append(field("Mark kind", type.input));
  const place = f.choose("Placement", faceMarkKindTable[mark.kind].places, mark.place);
  const side = f.choose("Side", faceMarkSides, mark.side),
    strength = f.numeric("Strength", mark.strength, 0, 1),
    size = f.numeric("Mark size", mark.size, 0, 1);
  const moves = mark.kind !== "Eyeliner",
    turns = mark.kind === "Scar" || mark.kind.startsWith("Paint ");
  const across = moves && f.numeric("Move outwards", mark.across ?? 0, -1, 1),
    up = moves && f.numeric("Move up", mark.up ?? 0, -1, 1),
    turn = turns && f.numeric("Turn mark (degrees)", mark.turn ?? 0, -90, 90, 1);
  const custom = f.check("Use custom tone", !!mark.tone),
    tone = f.color("Mark tone", mark.tone ?? params.skin);
  const change = (next: FaceMark) => save(marks.map((m, n) => (n === i ? next : m)));
  f.action("Apply face mark", () =>
    edit("Adjust " + mark.kind, () => {
      const { tone: _tone, ...previous } = mark;
      return change({
        ...previous,
        place: place(),
        side: side(),
        strength: strength(),
        size: size(),
        ...(up && across ? { up: up(), across: across() } : {}),
        ...(turn ? { turn: turn() } : {}),
        ...(custom() ? { tone: tone() } : {}),
      });
    }),
  );
  f.action("Redraw face mark", () =>
    edit("Redraw " + mark.kind, () => change({ ...mark, seed: seed() })),
  );
  f.action("Remove face mark", () =>
    edit("Remove " + mark.kind, () => save(marks.filter((_, n) => n !== i))),
  );
}
