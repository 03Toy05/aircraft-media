import { describe, expect, it } from "vitest";
import { clearStyles, forOtherApps, parseStyled, stripStyles, toggleMark, toggleUnderline } from "../src/domain/textStyle";

describe("Message styles", () => {
  it("wraps and unwraps the selection, keeping spaces outside the markers", () => {
    const t = "Price: USD 85,000 ";
    const b = toggleMark(t, 7, 18, "bold");
    expect(b.text).toBe("Price: *USD 85,000* ");
    expect(toggleMark(b.text, b.start, b.end, "bold").text).toBe(t);
    // selecting just the inside of an existing *word* also removes it
    expect(toggleMark("a *word* b", 3, 7, "bold").text).toBe("a word b");
  });

  it("styles each line separately, as WhatsApp only reads markers within a line", () => {
    expect(toggleMark("one\ntwo", 0, 7, "italic").text).toBe("_one_\n_two_");
  });

  it("uses the word under the cursor when nothing is selected", () => {
    expect(toggleMark("hello world", 8, 8, "bold").text).toBe("hello *world*");
  });

  it("underlines and removes the underline", () => {
    const u = toggleUnderline("ab", 0, 2);
    expect(u.text).toBe("a̲b̲");
    expect(toggleUnderline(u.text, 0, u.text.length).text).toBe("ab");
  });

  it("reads the markers like WhatsApp", () => {
    expect(parseStyled("Hi *there* _you_ ~old~ a*b*c")).toEqual([
      { text: "Hi " }, { text: "there", bold: true }, { text: " " }, { text: "you", italic: true }, { text: " " }, { text: "old", strike: true }, { text: " a*b*c" },
    ]);
    expect(parseStyled("* not bold *")).toEqual([{ text: "* not bold *" }]);
  });

  it("clears styles and converts for other apps", () => {
    expect(stripStyles("*Bold* _it_ x̲")).toBe("Bold it x");
    expect(clearStyles("*a* *b*", 0, 3).text).toBe("a *b*");
    expect(forOtherApps("*Hi 9* 中文 _ok_")).toBe("𝗛𝗶 𝟵 中文 𝘰𝘬");
  });
});
