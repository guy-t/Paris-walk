// @vitest-environment jsdom
//
// The calculator is one HTML file with no build, so this test loads that
// file into a DOM, runs its script, and drives the Calc class and the
// terrain generator directly. It is what stops a change to calculator.html
// breaking the arithmetic silently — the browser-driven checks live in the
// PR's history, not in CI.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest runs from the repository root, in CI as locally; under jsdom
// import.meta.url is an http URL, so the file is found from there.
const html = readFileSync(resolve(process.cwd(), "calculator.html"), "utf8");

type Calc = {
  display: { text: string; kind: string };
  expression: string;
  tokens: unknown[];
  cur: number;
  deg: boolean;
  clear(): void;
  digit(d: string): void;
  point(): void;
  ee(): void;
  negate(): void;
  op(v: string): void;
  fn(v: string): void;
  constant(v: string): void;
  ansKey(): void;
  random(): void;
  lparen(): void;
  rparen(): void;
  post(v: string): void;
  backspace(): void;
  equals(): string | null;
  moveCaret(d: number): void;
  setCaret(i: number): void;
  use(n: number): void;
};
type Api = { Calc: new (deg: boolean) => Calc; fmt: (n: number) => string; seeded: (s: number) => () => number };
type Widget = { reset(seed: number): void; extend(): void; cols: { h: number | null; spike: boolean }[]; speed: number };

let api: Api;
let widget: Widget;

beforeAll(() => {
  // jsdom has no canvas; the runner guards against that and draws nothing.
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script>"));
  const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  api = new Function(`${src}\n;return { Calc, fmt, seeded };`)() as Api;
  widget = document.querySelector("dash-widget") as unknown as Widget;
});

const THIN = " ";

// Keys as a space-separated script: digits and . ( ) + - * / ^ = as themselves,
// words for the rest.
const run = (seq: string, deg = true): Calc => {
  const c = new api.Calc(deg);
  for (const k of seq.trim().split(/\s+/)) {
    if (/^[0-9]$/.test(k)) c.digit(k);
    else if (k === ".") c.point();
    else if ("+-*/^".includes(k) && k.length === 1) c.op(k);
    else if (k === "mod" || k === "root") c.op(k);
    else if (k === "(") c.lparen();
    else if (k === ")") c.rparen();
    else if (k === "=") c.equals();
    else if (k === "neg") c.negate();
    else if (k === "bs") c.backspace();
    else if (k === "ee") c.ee();
    else if (k === "ans") c.ansKey();
    else if (k === "pi") c.constant("π");
    else if (k === "e") c.constant("e");
    else if (k === "left") c.moveCaret(-1);
    else if (k === "right") c.moveCaret(1);
    else if (k === "home") c.setCaret(0);
    else if (k === "end") c.setCaret(c.tokens.length);
    else if (k === "sq") c.post("²");
    else if (k === "cube") c.post("³");
    else if (k === "inv") c.post("⁻¹");
    else if (k === "fact") c.post("!");
    else if (k === "%") c.post("%");
    else c.fn(k);
  }
  return c;
};

describe("the calculator's arithmetic", () => {
  const cases: [string, string, string?][] = [
    ["2 + 3 * 4 =", "14", "2 + 3 × 4 ="],
    ["( 2 + 3 ) * 4 =", "20"],
    ["2 * ( 3 + 4 =", "14", "2 × (3 + 4) ="],
    ["0 . 1 + 0 . 2 =", "0.3"],
    ["7 / 0 =", "Can't divide by 0"],
    ["2 ^ 3 ^ 2 =", "512"],
    ["neg 3 sq =", "−9", "−3² ="],
    ["( neg 3 ) sq =", "9"],
    ["2 pi =", "6.28318530717959"],
    ["1 / 2 pi =", "0.159154943091895"],
    ["6 / 2 ( 1 + 2 ) =", "1"],
    ["3 ( 4 + 5 ) =", "27"],
    ["sin 3 0 ) =", "0.5", "sin(30) ="],
    ["sin 1 8 0 =", "0"],
    ["cos 9 0 =", "0"],
    ["tan 9 0 =", "Invalid input"],
    ["asin 1 =", "90"],
    ["asin 2 =", "Invalid input"],
    ["ln e =", "1"],
    ["ln 0 =", "Invalid input"],
    ["log 1 0 0 0 =", "3"],
    ["sqrt 2 =", "1.4142135623731"],
    ["3 root 2 7 =", "3"],
    ["5 fact =", "120"],
    ["1 7 1 fact =", "Too large"],
    ["2 . 5 fact =", "Invalid input"],
    ["0 inv =", "Invalid input"],
    ["1 7 mod 5 =", "2"],
    ["neg 7 mod 3 =", "2"],
    ["5 0 % =", "0.5"],
    ["1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7", `123${THIN}456${THIN}789${THIN}012${THIN}345`],
    ["9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 + 1 =", "1ᴇ15"],
    ["1 / 3 =", "0.333333333333333"],
    ["1 0 ^ 4 0 0 =", "Too large"],
    ["1 . 5 ee 3 neg =", "0.0015", "1.5ᴇ−3 ="],
    ["2 + 3 = * 4 =", "20", "Ans × 4 ="],
    ["2 + 3 = 7 =", "7", "7 ="],
    ["2 + * 3 =", "6"],
    ["2 * - 3 =", "−6"],
    ["2 + =", "Syntax error"],
    [") 2 =", "2"],
    ["2 + 3 left left 4", "27", "24 + 3"],
    ["3 home 9 1", "913", "913"],
    ["2 + 3 = left end bs", "", "2 +"],
  ];
  for (const [seq, want, wantExpr] of cases) {
    it(`${seq} → ${want}`, () => {
      const c = run(seq);
      expect(c.display.text).toBe(want);
      if (wantExpr !== undefined) expect(c.expression).toBe(wantExpr);
    });
  }

  it("works in radians too", () => {
    expect(run("sin pi =", false).display.text).toBe("0");
    expect(run("cos pi =", false).display.text).toBe("−1");
  });

  it("recalls a tape result as an answer: an operator continues, a digit starts fresh", () => {
    const c = new api.Calc(true);
    c.use(20); c.op("+"); c.digit("1"); c.equals();
    expect(c.display.text).toBe("21");
    c.use(20); c.digit("5");
    expect(c.display.text).toBe("5");
  });

  it("formats numbers honestly", () => {
    expect(api.fmt(0.1 + 0.2)).toBe("0.3");
    expect(api.fmt(1234567)).toBe(`1${THIN}234${THIN}567`);
    expect(api.fmt(9999)).toBe("9999");
    expect(api.fmt(-0.5)).toBe("−0.5");
    expect(api.fmt(1e21)).toBe("1ᴇ21");
    expect(api.fmt(Infinity)).toBe("Error");
  });
});

describe("the runner's terrain", () => {
  const sample = (seed: number, cells: number) => {
    widget.reset(seed);
    while (widget.cols.length < cells) widget.extend();
    return widget.cols;
  };

  it("is reproducible from its seed and differs between seeds", () => {
    const a = JSON.stringify(sample(42, 300));
    expect(JSON.stringify(sample(42, 300))).toBe(a);
    expect(JSON.stringify(sample(43, 300))).not.toBe(a);
  });

  it("is fair: pits of at most three cells, steps of one level, a jump's worth of flat after every feature", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const cols = sample(seed, 2000);
      const F = Math.ceil((widget.speed * 0.46 + 8) / 10);   // the generator's own rule, at the starting speed
      let run = 0, prev: number | null = 0;
      cols.forEach((col, i) => {
        if (col.h === null) { run++; expect(run).toBeLessThanOrEqual(3); } else run = 0;
        if (col.h !== null && prev !== null) expect(col.h - prev).toBeLessThanOrEqual(1);
        const feature = col.spike || col.h === null || (prev !== null && col.h !== null && col.h !== prev);
        if (feature) {
          // the end of this feature, then F cells of plain ground at one level
          let j = i + 1;
          while (j < cols.length && (cols[j].spike === col.spike && cols[j].h === col.h) && col.h === null) j++;
          if (col.spike) while (j < cols.length && cols[j].spike) j++;
          for (let k = j; k < Math.min(cols.length, j + F); k++) {
            expect(cols[k].spike).toBe(false);
            expect(cols[k].h).toBe(cols[j].h);
          }
        }
        prev = col.h;
      });
      expect(cols.some((c) => c.h === null)).toBe(true);
      expect(cols.some((c) => c.spike)).toBe(true);
      expect(new Set(cols.map((c) => c.h).filter((h) => h !== null)).size).toBe(3);
    }
  });
});
