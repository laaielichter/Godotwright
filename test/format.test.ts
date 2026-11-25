import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { formatCommand } from "../src/commands/format.js";
import { unifiedDiff } from "../src/format/diff.js";
import { formatScript, guardFormat } from "../src/format/format.js";
import { formatFormatReport, formatProject } from "../src/format/project.js";
import { tokenize } from "../src/format/tokenizer.js";
import { makeProject } from "./helpers.js";

/** Formats, and checks on the way that the result is stable and nothing was skipped. */
function fmt(source: string): string {
  const result = formatScript(source);
  expect(result.skipped).toBeUndefined();
  expect(result.changed).toBe(result.text !== source);
  const again = formatScript(result.text);
  expect(again.text).toBe(result.text);
  expect(again.changed).toBe(false);
  return result.text;
}

/** One line in, one line out. */
const line = (source: string): string => fmt(`${source}\n`).replace(/\n$/, "");

describe("tokenizer", () => {
  const kinds = (source: string) => tokenize(source).filter((t) => t.kind !== "ws" && t.kind !== "newline").map((t) => `${t.kind}:${t.text}`);

  it("keeps every byte", () => {
    const source = 'var a := $A/B.x % 3 # c\n\tprint(&"n", ^"p", r"\\d", """a\n"b" """)\n';
    expect(tokenize(source).map((t) => t.text).join("")).toBe(source);
  });

  it("reads strings of every kind as one token", () => {
    expect(kinds(`"a # b" 'c\\'d' """e "f" g""" '''h''' r"\\d\\"x" &"name" ^"A/B" r'x'`)).toEqual([
      'string:"a # b"', "string:'c\\'d'", 'string:"""e "f" g"""', "string:'''h'''", 'string:r"\\d\\"x"', 'string:&"name"', 'string:^"A/B"', "string:r'x'",
    ]);
    expect(kinds('"""a\nb"""')).toEqual(['string:"""a\nb"""']);
  });

  it("reads node paths as one token, and tells them from division and modulo", () => {
    expect(kinds("$A/B.x / 2")).toEqual(["nodepath:$A/B", "op:.", "name:x", "op:/", "number:2"]);
    expect(kinds('$"A B/C" $A/"B C"/D $%U $../Up $/root/Main')).toEqual(['nodepath:$"A B/C"', 'nodepath:$A/"B C"/D', "nodepath:$%U", "nodepath:$../Up", "nodepath:$/root/Main"]);
    expect(kinds("x = %Unique")).toEqual(["name:x", "op:=", "nodepath:%Unique"]);
    expect(kinds("x %Unique")).toEqual(["name:x", "op:%", "name:Unique"]);
    expect(kinds('"%s" %x')).toEqual(['string:"%s"', "op:%", "name:x"]);
    expect(kinds("return %A/B")).toEqual(["name:return", "nodepath:%A/B"]);
    expect(kinds('f(%"Quoted Name")')).toEqual(["name:f", "op:(", 'nodepath:%"Quoted Name"', "op:)"]);
    expect(kinds("a %= 2")).toEqual(["name:a", "op:%=", "number:2"]);
  });

  it("reads numbers", () => {
    expect(kinds("0xFF_FF 0b1010 1_000 1.5e-3 2E+4 3. 1e10 .5")).toEqual(["number:0xFF_FF", "number:0b1010", "number:1_000", "number:1.5e-3", "number:2E+4", "number:3.", "number:1e10", "number:.5"]);
    expect(kinds("f(1,.5)")).toEqual(["name:f", "op:(", "number:1", "op:,", "number:.5", "op:)"]);
    expect(kinds("a.x")).toEqual(["name:a", "op:.", "name:x"]);
  });

  it("reads annotations, operators, comments and continuations", () => {
    expect(kinds("@export_range(0, 1) var a")).toEqual(["annotation:@export_range", "op:(", "number:0", "op:,", "number:1", "op:)", "name:var", "name:a"]);
    expect(kinds("a ** b := c -> d .. ... **= <<= >>=")).toEqual(["name:a", "op:**", "name:b", "op::", "op:=", "name:c", "op:->", "name:d", "op:..", "op:...", "op:**=", "op:<<=", "op:>>="]);
    expect(kinds("a # b  \nc")).toEqual(["name:a", "comment:# b", "name:c"]);
    expect(kinds("a \\\n\tb")).toEqual(["name:a", "continuation:\\", "name:b"]);
  });

  it("refuses what Godot refuses", () => {
    expect(() => tokenize('a = "x')).toThrow(/unterminated string/);
    expect(() => tokenize("a = (1")).toThrow(/never closed/);
    expect(() => tokenize("a = 1)")).toThrow(/opening bracket/);
    expect(() => tokenize("a = b ? c : d")).toThrow(/unexpected character/);
    expect(() => tokenize("a = 1 \\ \nb")).toThrow(/backslash/);
  });
});

describe("spacing", () => {
  it("puts one space around binary operators and assignments", () => {
    expect(line("a=b+c*d")).toBe("a = b + c * d");
    expect(line("a  =  b  -  c")).toBe("a = b - c");
    expect(line("a+=1")).toBe("a += 1");
    expect(line("x=a**b<<2>>1")).toBe("x = a ** b << 2 >> 1");
    expect(line("ok=a==b and c!=d or e<=f&&g>=h||i<j")).toBe("ok = a == b and c != d or e <= f && g >= h || i < j");
    expect(line("m=a&b|c^d")).toBe("m = a & b | c ^ d");
  });

  it("tells unary from binary minus", () => {
    expect(line("a=-x")).toBe("a = -x");
    expect(line("a = - x")).toBe("a = -x");
    expect(line("a = b-c")).toBe("a = b - c");
    expect(line("a = b -c")).toBe("a = b - c");
    expect(line("a = b*-c")).toBe("a = b * -c");
    expect(line("a = b - -c")).toBe("a = b - -c");
    expect(line("f( -1,-2 )")).toBe("f(-1, -2)");
    expect(line("a = x[-1]-1")).toBe("a = x[-1] - 1");
    expect(line("a = (b)-c")).toBe("a = (b) - c");
    expect(line("return -x")).toBe("return -x");
    expect(line("a = b if c else -d")).toBe("a = b if c else -d");
    expect(line("a = b in -c")).toBe("a = b in -c");
    expect(line("a = {k:-1}")).toBe("a = {k: -1}");
    expect(line("a = 2**-1")).toBe("a = 2 ** -1");
    expect(line("a = self.x-1")).toBe("a = self.x - 1");
    expect(line('a = "x".length()-1')).toBe('a = "x".length() - 1');
  });

  it("handles not, ! and ~", () => {
    expect(line("a = not  b")).toBe("a = not b");
    expect(line("a = ! b")).toBe("a = !b");
    expect(line("a = b&~ c")).toBe("a = b & ~c");
    expect(line("if not(a): pass")).toBe("if not (a): pass");
    expect(line("a = b  not  in  c")).toBe("a = b not in c");
    expect(line("a = b  is  not  Node")).toBe("a = b is not Node");
    expect(line("a = b  as  Node")).toBe("a = b as Node");
  });

  it("puts a space after commas and none before commas and colons", () => {
    expect(line("f(a,b ,c)")).toBe("f(a, b, c)");
    expect(line("var a : int = 1")).toBe("var a: int = 1");
    expect(line("var a:int=1")).toBe("var a: int = 1");
    expect(line("var a:=1")).toBe("var a := 1");
    expect(line("var a : = 1")).toBe("var a := 1");
    expect(line("const A: = 1")).toBe("const A := 1");
    expect(line("if a :")).toBe("if a:");
    expect(line("if a:return")).toBe("if a: return");
    expect(line("a = 1;b = 2")).toBe("a = 1; b = 2");
  });

  it("removes spaces inside brackets and before call and index brackets", () => {
    expect(line("f( a )")).toBe("f(a)");
    expect(line("f ( a )")).toBe("f(a)");
    expect(line("a = [ 1, 2 ]")).toBe("a = [1, 2]");
    expect(line("a = { 1: 2 }")).toBe("a = {1: 2}");
    expect(line("a = b [ 0 ] [ 1 ]")).toBe("a = b[0][1]");
    expect(line("a = ( )")).toBe("a = ()");
    expect(line("a = f( g( 1 ) )( 2 )")).toBe("a = f(g(1))(2)");
    expect(line("for i in [1,2]: pass")).toBe("for i in [1, 2]: pass");
    expect(line("return (a)")).toBe("return (a)");
    expect(line("return[a]")).toBe("return [a]");
    expect(line("a = -(b)")).toBe("a = -(b)");
    expect(line("a = b . c . d ( )")).toBe("a = b.c.d()");
  });

  it("formats functions, defaults, type hints and return types", () => {
    expect(line("func f( a , b:int , c=1 , d:=2 , e : float=3.0 )->void :")).toBe("func f(a, b: int, c = 1, d := 2, e: float = 3.0) -> void:");
    expect(line("func f ()->Array[int]:")).toBe("func f() -> Array[int]:");
    expect(line("static func f()  ->  void: pass")).toBe("static func f() -> void: pass");
    expect(line("signal hit( amount:int,by )")).toBe("signal hit(amount: int, by)");
    expect(line("func f(...args)->void:")).toBe("func f(...args) -> void:");
  });

  it("formats typed arrays and dictionaries", () => {
    expect(line("var a:Array[int]=[ ]")).toBe("var a: Array[int] = []");
    expect(line("var d : Dictionary[ String,int ] = { }")).toBe("var d: Dictionary[String, int] = {}");
    expect(line("var n: Array [Array [int]]")).toBe("var n: Array[Array[int]]");
    expect(line("for i:int in 3: pass")).toBe("for i: int in 3: pass");
  });

  it("formats dictionaries and enums", () => {
    expect(line('var d = {"a":1,"b" : [1,2],c=3}')).toBe('var d = {"a": 1, "b": [1, 2], c = 3}');
    expect(line("enum State{ IDLE,RUN=2 , JUMP }")).toBe("enum State {IDLE, RUN = 2, JUMP}");
    expect(line("enum { A,B }")).toBe("enum {A, B}");
  });

  it("formats lambdas", () => {
    expect(line("var f = func ( a,b ) : return a+b")).toBe("var f = func(a, b): return a + b");
    expect(line("var f = func(a:int)->int:return -a")).toBe("var f = func(a: int) -> int: return -a");
    expect(line("list.sort_custom( func(a,b):return a<b )")).toBe("list.sort_custom(func(a, b): return a < b)");
    expect(line("var f = func named ( x ) : pass")).toBe("var f = func named(x): pass");
  });

  it("formats annotations", () => {
    expect(line("@export_range( 0,1,0.1 ) var x:=0.5")).toBe("@export_range(0, 1, 0.1) var x := 0.5");
    expect(line("@export_range (0, 1) var x := 0.5")).toBe("@export_range(0, 1) var x := 0.5");
    expect(line('@export_enum( "A","B" )  var  kind : int')).toBe('@export_enum("A", "B") var kind: int');
    expect(line("@onready  var  n = $A/B")).toBe("@onready var n = $A/B");
    expect(line('@warning_ignore( "unused_variable" )')).toBe('@warning_ignore("unused_variable")');
  });

  it("formats await, ternaries and keywords before brackets", () => {
    expect(line("await  get_tree().create_timer( 1.0 ).timeout")).toBe("await get_tree().create_timer(1.0).timeout");
    expect(line("await(f())")).toBe("await (f())");
    expect(line("var a=b  if  c>0  else  d")).toBe("var a = b if c > 0 else d");
    expect(line("var a = b if c else(d)")).toBe("var a = b if c else (d)");
    expect(line("if(a): pass")).toBe("if (a): pass");
    expect(line("while (a) : pass")).toBe("while (a): pass");
    expect(line("assert (a , b)")).toBe("assert(a, b)");
    expect(line("var a = preload ( \"res://a.gd\" )")).toBe('var a = preload("res://a.gd")');
  });

  it("formats match patterns", () => {
    const source = ["match  x :", "\t1 , 2 :", "\t\tpass", "\t[ var a , .. ] :", "\t\tpass", '\t{ "k" : var v , .. }  when  v>1 :', "\t\tpass", "\t-1:", "\t\tpass", "\t_ :", "\t\tpass", ""].join("\n");
    expect(fmt(source)).toBe(["match x:", "\t1, 2:", "\t\tpass", "\t[var a, ..]:", "\t\tpass", '\t{"k": var v, ..} when v > 1:', "\t\tpass", "\t-1:", "\t\tpass", "\t_:", "\t\tpass", ""].join("\n"));
    expect(line("match(x):")).toBe("match (x):");
    expect(line("var m = match(x)")).toBe("var m = match(x)");
  });

  it("tells % formatting and modulo from a %Unique node", () => {
    expect(line('var s = "%d of %d"%[ a,b ]')).toBe('var s = "%d of %d" % [a, b]');
    expect(line("var m = a%b")).toBe("var m = a % b");
    expect(line("var m = a %b")).toBe("var m = a % b");
    expect(line("var n = %Unique")).toBe("var n = %Unique");
    expect(line("var n=%Unique.get_child( 0 )")).toBe("var n = %Unique.get_child(0)");
    expect(line("f( %A,%B )")).toBe("f(%A, %B)");
    expect(line("var m = f(x)%2")).toBe("var m = f(x) % 2");
    expect(line("var m = %A.size%2")).toBe("var m = %A.size % 2");
    expect(line("%Label.text = str( 1 )")).toBe("%Label.text = str(1)");
  });

  it("tells a $Path/To from division", () => {
    expect(line("var n=$Path/To")).toBe("var n = $Path/To");
    expect(line("var w = $Path/To.size.x/2")).toBe("var w = $Path/To.size.x / 2");
    expect(line("var w = a/b/c")).toBe("var w = a / b / c");
    expect(line('var n = $"Quoted Path/To"')).toBe('var n = $"Quoted Path/To"');
    expect(line("$A/B.visible=false")).toBe("$A/B.visible = false");
    expect(line("var w = $A.x/$B.x")).toBe("var w = $A.x / $B.x");
  });

  it("never changes a string, a comment or a node path", () => {
    const untouched = [
      'var a = "a=b+c  ,d( x )"',
      "var b = 'a=b+c  ,d'",
      'var c = """a=b\n\t  c ,d   \n"""',
      "var d = '''a=b\n  c'''",
      'var e = r"a=b\\d+  ,"',
      'var f = &"a=b  ,c"',
      'var g = ^"A/B:c  ,d"',
      'var h = $"A  B/C,D"',
      "var i = $A/B/C",
      "var j = %Unique",
      "var k = 1 #no space  ,a=b",
      "#region  Name",
      "##  doc comment a=b",
      "#var old=1+2",
      "#endregion",
    ];
    const source = `${untouched.join("\n")}\n`;
    expect(formatScript(source)).toEqual({ text: source, changed: false });
    // And they stay as they are when the code around them changes.
    const messy = 'var a="a=b ,c"+\'d ,e\'#c=d ,e\nvar g=^"A/B:c"if x else&"n ,m"\nvar h=r"\\d ,"+$A/B.name#x\n';
    expect(fmt(messy)).toBe('var a = "a=b ,c" + \'d ,e\'#c=d ,e\nvar g = ^"A/B:c"if x else&"n ,m"\nvar h = r"\\d ," + $A/B.name#x\n');
  });

  it("keeps the spacing before a comment and before a line continuation", () => {
    expect(line("var a=1   # aligned")).toBe("var a = 1   # aligned");
    expect(fmt("var a=1+ \\\n\t\t2\n")).toBe("var a = 1 + \\\n\t\t2\n");
  });

  it("keeps the lines of a bracketed expression, and their indentation", () => {
    const source = ["var d={", '\t"a":1 ,', '\t   "b" : [ 1,', "\t\t\t2 ],", "", "  # comment", "}", "func f( a,", "\t\tb )->void:", "\tpass", ""].join("\n");
    expect(fmt(source)).toBe(["var d = {", '\t"a": 1,', '\t   "b": [1,', "\t\t\t2],", "", "  # comment", "}", "", "", "func f(a,", "\t\tb) -> void:", "\tpass", ""].join("\n"));
  });

  it("formats a multi-line lambda inside a call without touching its lines", () => {
    const source = ["func f():", "\tbutton.pressed.connect( func( ):", "\t\tprint( 1 )", "\t\tprint( 2 )", "\t )", ""].join("\n");
    expect(fmt(source)).toBe(["func f():", "\tbutton.pressed.connect(func():", "\t\tprint(1)", "\t\tprint(2)", "\t )", ""].join("\n"));
  });
});

describe("whitespace and blank lines", () => {
  it("removes trailing whitespace and ends the file with one newline", () => {
    expect(fmt("var a = 1  \n\t\nvar b = 2\t\n\n\n")).toBe("var a = 1\n\nvar b = 2\n");
    expect(fmt("var a = 1")).toBe("var a = 1\n");
    expect(fmt("var a = 1 # c  ")).toBe("var a = 1 # c\n");
    expect(fmt("")).toBe("");
    expect(fmt("\n\n")).toBe("");
  });

  it("puts two blank lines around functions and inner classes", () => {
    const source = ["extends Node", "var a = 1", "func f():", "\tpass", "func g():", "\tpass", "", "", "", "", "class Inner:", "\tvar x = 1", "\tfunc h():", "\t\tpass", "\tfunc i():", "\t\tpass", "var b = 2", ""].join("\n");
    expect(fmt(source)).toBe(
      ["extends Node", "var a = 1", "", "", "func f():", "\tpass", "", "", "func g():", "\tpass", "", "", "class Inner:", "\tvar x = 1", "", "", "\tfunc h():", "\t\tpass", "", "", "\tfunc i():", "\t\tpass", "", "", "var b = 2", ""].join("\n"),
    );
  });

  it("keeps comments and annotations with their function", () => {
    const source = ["var a = 1", "## Doc.", "# More.", '@rpc("any_peer")', "func f():", "\tpass", "\t# in the body", "# about g", "func g(): pass", ""].join("\n");
    expect(fmt(source)).toBe(["var a = 1", "", "", "## Doc.", "# More.", '@rpc("any_peer")', "func f():", "\tpass", "\t# in the body", "", "", "# about g", "func g(): pass", ""].join("\n"));
  });

  it("does not push the first member of a class away from its header, or the first function from the top", () => {
    const source = ["class A:", "\tfunc f():", "\t\tpass", ""].join("\n");
    expect(fmt(source)).toBe(source);
    const top = ["# header", "func f():", "\tpass", ""].join("\n");
    expect(fmt(top)).toBe(top);
  });

  it("leaves regions around functions alone", () => {
    const source = ["var a = 1", "", "#region Stuff", "func f():", "\tpass", "#endregion", "", "var b = 1", ""].join("\n");
    expect(fmt(source)).toBe(["var a = 1", "", "", "#region Stuff", "func f():", "\tpass", "#endregion", "", "var b = 1", ""].join("\n"));
  });

  it("allows at most two blank lines elsewhere", () => {
    expect(fmt("var a = 1\n\n\n\n\nvar b = 2\n")).toBe("var a = 1\n\n\nvar b = 2\n");
    expect(fmt("func f():\n\tvar a = 1\n\n\n\n\tvar b = 2\n")).toBe("func f():\n\tvar a = 1\n\n\n\tvar b = 2\n");
    expect(fmt("var a = 1\n\nvar b = 2\n")).toBe("var a = 1\n\nvar b = 2\n");
  });

  it("keeps Windows line endings and a byte order mark", () => {
    expect(fmt("var a=1\r\nfunc f():\r\n\tpass\r\n")).toBe("var a = 1\r\n\r\n\r\nfunc f():\r\n\tpass\r\n");
    expect(fmt("\uFEFFvar a=1\n")).toBe("\uFEFFvar a = 1\n");
  });
});

describe("indentation", () => {
  it("turns a steady number of spaces into tabs", () => {
    const source = ["func f():", "    if a:", "        return [", "            1,", "        ]", "    # comment", "    return 0", ""].join("\n");
    expect(fmt(source)).toBe(["func f():", "\tif a:", "\t\treturn [", "\t\t\t1,", "\t\t]", "\t# comment", "\treturn 0", ""].join("\n"));
    expect(fmt("func f():\n  if a:\n    pass\n")).toBe("func f():\n\tif a:\n\t\tpass\n");
  });

  it("leaves aligned continuation lines of a space-indented file alone", () => {
    const source = ["func f():", "    var a = g(1,", "              2)", ""].join("\n");
    expect(fmt(source)).toBe(["func f():", "\tvar a = g(1,", "              2)", ""].join("\n"));
  });

  it("skips a file that mixes tabs and spaces", () => {
    const mixed = "func f():\n\tpass\nfunc g():\n    pass\n";
    expect(formatScript(mixed)).toEqual({ text: mixed, changed: false, skipped: "some lines are indented with tabs and some with spaces (lines 2 and 4)" });
    const inOne = "func f():\n\t  pass\n";
    expect(formatScript(inOne).skipped).toMatch(/mixed in the indentation of one line \(line 2\)/);
  });

  it("skips a file with unsteady or broken space indentation", () => {
    expect(formatScript("func f():\n    if a:\n      pass\n").skipped).toMatch(/not a steady 4 spaces per level \(line 3\)/);
    expect(formatScript("func f():\n\t\tif a:\n\t\t\tpass\n\tpass\n").skipped).toMatch(/does not match an outer level \(line 4\)/);
  });

  it("skips a space-indented file where a lambda in brackets has aligned lines", () => {
    const source = ["func f():", "    a.connect(func():", "        pass", "    )", "    var b = g(1,", "              2)", ""].join("\n");
    expect(formatScript(source).skipped).toMatch(/lambda inside brackets/);
  });

  it("skips a script with merge conflict markers", () => {
    const source = "var a=1\n<<<<<<< ours\nvar b=1\n=======\nvar b=2\n>>>>>>> theirs\n";
    expect(formatScript(source)).toEqual({ text: source, changed: false, skipped: 'cannot read the script: a statement starts with "<<" (line 2)' });
    expect(fmt("var a = [\n\t1\n\t+ 2,\n\t-3,\n]\n-a\n")).toBe("var a = [\n\t1\n\t+ 2,\n\t-3,\n]\n-a\n");
  });

  it("skips a script it cannot read", () => {
    const broken = 'var a = "never closed\n';
    expect(formatScript(broken)).toEqual({ text: broken, changed: false, skipped: "cannot read the script: unterminated string (line 1)" });
  });
});

describe("guard", () => {
  it("accepts what the formatter does", () => {
    expect(guardFormat("var a=1\n", "var a = 1\n")).toBeUndefined();
    expect(guardFormat("func f():\n    pass\n", "func f():\n\tpass\n")).toBeUndefined();
    expect(guardFormat("a = 1\nb = 2\n", "a = 1\n\n\nb = 2\n")).toBeUndefined();
  });

  it("refuses a changed token, string, comment or node path", () => {
    expect(guardFormat("var a = b - c\n", "var a = b + c\n")).toMatch(/tokens differ at line 1/);
    expect(guardFormat('var a = "x  y"\n', 'var a = "x y"\n')).toMatch(/tokens differ/);
    expect(guardFormat("var a = 1 #c\n", "var a = 1 # c\n")).toMatch(/tokens differ/);
    expect(guardFormat("var a = $A/B\n", "var a = $A / B\n")).toMatch(/tokens differ/);
    expect(guardFormat("var a = b %c\n", "var a = b %c # x\n")).toMatch(/tokens differ/);
    expect(guardFormat("var a = x % Y\n", "var a = x %Y\n")).toBeUndefined();
    expect(guardFormat("var a = - - b\n", "var a = --b\n")).toBeUndefined();
    expect(guardFormat("var a = b * * c\n", "var a = b ** c\n")).toMatch(/tokens differ/);
    expect(guardFormat("var a = 1\n", "var a = 1\nvar b = 2\n")).toMatch(/tokens differ/);
  });

  it("refuses a changed line structure or indent level", () => {
    expect(guardFormat("a = 1\nb = 2\n", "a = 1; b = 2\n")).toMatch(/tokens differ/);
    expect(guardFormat("a = f(1,\n\t2)\n", "a = f(1, 2)\n")).toMatch(/tokens differ/);
    expect(guardFormat("if a:\n\tb()\nc()\n", "if a:\n\tb()\n\tc()\n")).toMatch(/indent level changed at line 3/);
    expect(guardFormat("if a:\n\tb()\n", "if a:\nb()\n")).toMatch(/indent level changed at line 2/);
    expect(guardFormat("a = f(1,\n\t2)\n", "a = f(1,\n\t\t2)\n")).toMatch(/indentation changed at line 2/);
    expect(guardFormat("if a:\n    b()\n    if c:\n        d()\n", "if a:\n\tb()\n\tif c:\n\t\t\td()\n")).toMatch(/unevenly|indentation changed/);
  });

  it("returns the original text when a transformation breaks the code", () => {
    const source = "func f(a,b):\n\treturn a-b\n";
    expect(formatScript(source).text).toBe("func f(a, b):\n\treturn a - b\n");
    const broken = formatScript(source, { transform: (text) => text.replace("a - b", "a + b") });
    expect(broken.text).toBe(source);
    expect(broken.changed).toBe(false);
    expect(broken.skipped).toMatch(/^formatter guard: the tokens differ at line 2/);
    const dedent = formatScript(source, { transform: (text) => text.replace("\treturn", "return") });
    expect(dedent).toMatchObject({ text: source, changed: false });
    expect(dedent.skipped).toMatch(/^formatter guard: /);
    const joined = formatScript(source, { transform: (text) => text.replace("):\n\t", "): ") });
    expect(joined.skipped).toMatch(/^formatter guard: /);
    const unstable = formatScript(source, { transform: (text) => `${text}\n` });
    expect(unstable).toMatchObject({ text: source, changed: false });
    expect(unstable.skipped).toMatch(/^formatter guard: /);
  });
});

describe("idempotence", () => {
  it("formats a whole script once and for all", () => {
    const source = [
      "@tool",
      "class_name  Thing  extends  Node2D",
      "signal  done( value:int )",
      "enum Kind{ A,B=3 }",
      'const NAMES:Array[String]=[ "a","b" ]',
      "@export_range( 0,10 ) var speed:float=2.5",
      "@onready var label:Label=%Label",
      "var _map : Dictionary[String,int] = { }",
      "func _ready()->void:",
      "    var f=func( x ):return x*2",
      "    for i in range( 0,10 ):",
      "        _map[ str( i ) ]=f.call( i )%3",
      "    label.text=\"%d items\"%_map.size( )",
      "    await get_tree( ).process_frame",
      "    done.emit( -1 if _map.is_empty( ) else _map.size( ) )",
      "func _process( delta:float )->void:",
      "    position.x+=speed*delta ; rotation=-rotation",
      "    match Kind.A:",
      "        Kind.A,Kind.B:pass",
      "        _:pass",
      "",
    ].join("\n");
    const once = fmt(source);
    expect(once).toBe(
      [
        "@tool",
        "class_name Thing extends Node2D",
        "signal done(value: int)",
        "enum Kind {A, B = 3}",
        'const NAMES: Array[String] = ["a", "b"]',
        "@export_range(0, 10) var speed: float = 2.5",
        "@onready var label: Label = %Label",
        "var _map: Dictionary[String, int] = {}",
        "",
        "",
        "func _ready() -> void:",
        "\tvar f = func(x): return x * 2",
        "\tfor i in range(0, 10):",
        "\t\t_map[str(i)] = f.call(i) % 3",
        '\tlabel.text = "%d items" % _map.size()',
        "\tawait get_tree().process_frame",
        "\tdone.emit(-1 if _map.is_empty() else _map.size())",
        "",
        "",
        "func _process(delta: float) -> void:",
        "\tposition.x += speed * delta; rotation = -rotation",
        "\tmatch Kind.A:",
        "\t\tKind.A, Kind.B: pass",
        "\t\t_: pass",
        "",
      ].join("\n"),
    );
    expect(formatScript(once)).toEqual({ text: once, changed: false });
  });
});

describe("unified diff", () => {
  it("shows the changed lines with context", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const after = "a\nb\nc\nD\ne\nf\ng\nh\nI\n";
    expect(unifiedDiff("x.gd", before, after)).toBe(["--- a/x.gd", "+++ b/x.gd", "@@ -1,8 +1,9 @@", " a", " b", " c", "-d", "+D", " e", " f", " g", " h", "+I", ""].join("\n"));
    expect(unifiedDiff("x.gd", before, before)).toBe("");
    expect(unifiedDiff("x.gd", "a\nb\n", "a\n\n\nb\n")).toBe(["--- a/x.gd", "+++ b/x.gd", "@@ -1,2 +1,4 @@", " a", "+", "+", " b", ""].join("\n"));
  });
});

describe("formatProject and the command", () => {
  const files = {
    "project.godot": 'config_version=5\n\n[application]\nconfig/name="t"\n',
    "main.gd": "extends Node\nvar a=1\n",
    "clean.gd": "extends Node\nvar a = 1\n",
    "broken.gd": 'var a = "never closed\n',
    "addons/plugin/plugin.gd": "var a=1\n",
    "sub/other.gd": "var b=[ 1,2 ]\n",
  };

  async function run(args: string[]): Promise<{ output: string; exitCode: number }> {
    let output = "";
    const program = new Command().exitOverride().configureOutput({ writeOut: (t) => (output += t), writeErr: (t) => (output += t) });
    program.addCommand(formatCommand());
    process.exitCode = undefined;
    await program.parseAsync(["format", ...args], { from: "user" });
    const exitCode = process.exitCode === undefined ? 0 : Number(process.exitCode);
    process.exitCode = undefined;
    return { output, exitCode };
  }

  it("reports without writing, and skips addons and unreadable scripts", () => {
    const root = makeProject(files);
    const report = formatProject(root);
    expect(report.written).toBe(false);
    expect(report.files).toBe(4);
    expect(report.changed.map((c) => c.file)).toEqual(["res://main.gd", "res://sub/other.gd"]);
    expect(report.unchanged).toBe(1);
    expect(report.skipped).toEqual([{ file: "res://broken.gd", reason: "cannot read the script: unterminated string (line 1)" }]);
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe(files["main.gd"]);
    const text = formatFormatReport(report);
    expect(text).toContain("format: would format 2 of 4 scripts, 1 skipped");
    expect(text).toContain("  res://main.gd (1 line)");
    expect(text).toContain("  res://broken.gd: cannot read the script");
    expect(formatFormatReport(report, 1)).toContain("... 1 more");
  });

  it("writes with write, through the journal, and is clean afterwards", () => {
    const root = makeProject(files);
    const report = formatProject(root, { write: true, includeAddons: true, diff: true });
    expect(report.written).toBe(true);
    expect(report.journal).toBeTypeOf("number");
    expect(report.changed.map((c) => c.file)).toEqual(["res://addons/plugin/plugin.gd", "res://main.gd", "res://sub/other.gd"]);
    expect(report.changed[1]!.diff).toBe("--- a/main.gd\n+++ b/main.gd\n@@ -1,2 +1,2 @@\n extends Node\n-var a=1\n+var a = 1\n");
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe("extends Node\nvar a = 1\n");
    expect(readFileSync(join(root, "broken.gd"), "utf8")).toBe(files["broken.gd"]);
    const again = formatProject(root, { write: true, includeAddons: true });
    expect(again.changed).toEqual([]);
    expect(again.journal).toBeUndefined();
    expect(formatFormatReport(again)).toContain("all formatted already");
  });

  it("formats only the named files and folders", () => {
    const root = makeProject(files);
    expect(formatProject(root, { files: ["res://sub"] }).changed.map((c) => c.file)).toEqual(["res://sub/other.gd"]);
    expect(formatProject(root, { files: [join(root, "main.gd"), "res://addons/plugin/plugin.gd"] }).changed.map((c) => c.file)).toEqual(["res://addons/plugin/plugin.gd", "res://main.gd"]);
    expect(() => formatProject(root, { files: ["res://missing.gd"] })).toThrow(/does not exist in the project/);
    expect(() => formatProject(root, { files: ["res://project.godot"] })).toThrow(/not a GDScript or C# file/);
  });

  it("the command checks, diffs, writes and prints JSON", async () => {
    const root = makeProject(files);
    const check = await run(["--path", root, "--check"]);
    expect(check.exitCode).toBe(1);
    expect(check.output).toContain("res://main.gd");
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe(files["main.gd"]);

    const dry = await run(["--path", root, "--diff"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("-var a=1\n+var a = 1");
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe(files["main.gd"]);

    const json = await run([join(root, "sub", "other.gd"), "--json"]);
    expect(JSON.parse(json.output)).toMatchObject({ written: false, files: 1, changed: [{ file: "res://sub/other.gd", lines: 1 }] });

    const write = await run(["--path", root, "--write"]);
    expect(write.exitCode).toBe(0);
    expect(write.output).toContain("format: formatted 2 of 4 scripts, 1 skipped");
    expect(readFileSync(join(root, "sub", "other.gd"), "utf8")).toBe("var b = [1, 2]\n");
    expect(readFileSync(join(root, "addons", "plugin", "plugin.gd"), "utf8")).toBe(files["addons/plugin/plugin.gd"]);

    const clean = await run(["--path", root, "--check"]);
    expect(clean.exitCode).toBe(0);

    const both = await run(["--path", root, "--check", "--write"]);
    expect(both.exitCode).toBe(1);
  });
});
